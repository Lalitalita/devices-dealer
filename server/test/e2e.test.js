import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startEmulator } from './emulator.js';
import { buildApp } from '../src/index.js';

let emu, app, cookie;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-'));

async function api(method, url, body) {
  const res = await app.inject({ method, url, payload: body, headers: cookie ? { cookie } : {} });
  return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body, headers: res.headers };
}

before(async () => {
  emu = await startEmulator({ neighbors: [{ name: 'core-rtr.lan', ip: '10.0.0.1', local: 'GigabitEthernet0/1', remote: 'GigabitEthernet0/0' }] });
  ({ app } = await buildApp({ dataDir, secretKey: 'test', adminUser: 'admin', adminPassword: 'password123', webDir: '/nonexistent', port: 0 }));
});
after(async () => { await app.close(); emu.close(); });

test('auth obligatoire puis login', async () => {
  assert.equal((await api('GET', '/api/devices')).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { username: 'admin', password: 'nope' })).status, 401);
  const r = await api('POST', '/api/auth/login', { username: 'admin', password: 'password123' });
  assert.equal(r.status, 200);
  cookie = r.headers['set-cookie'].split(';')[0];
});

let dev;
test('CRUD appareil + machine vide + lien', async () => {
  const r = await api('POST', '/api/devices', { name: 'sw1', type: 'switch', vendor: 'cisco_ios', host: '127.0.0.1', port: emu.port, username: 'admin', password: 'admin' });
  assert.equal(r.status, 200);
  dev = r.body;
  assert.equal(dev.hasPassword, true);
  assert.equal(dev.password, undefined);
  const pc = (await api('POST', '/api/devices', { name: 'PC compta', type: 'pc', virtual: true, ip: '192.168.1.20' })).body;
  const l = await api('POST', '/api/links', { a: { deviceId: dev.id, iface: 'Gi0/3' }, b: { deviceId: pc.id, iface: 'eth0' } });
  assert.equal(l.status, 200);
  assert.equal((await api('GET', `/api/devices/${pc.id}/interfaces`)).status, 400);
});

test('lecture système / interfaces / vlans via SSH', async () => {
  const sys = (await api('GET', `/api/devices/${dev.id}/system`)).body;
  assert.equal(sys.hostname, 'SW1');
  assert.equal(sys.model, 'WS-C2960-24TT-L');
  const ifs = (await api('GET', `/api/devices/${dev.id}/interfaces`)).body;
  assert.equal(ifs.length, 3);
  assert.equal(ifs[0].linkUp, true);
  assert.equal(ifs[2].linkUp, false);
  const vlans = (await api('GET', `/api/devices/${dev.id}/vlans`)).body;
  assert.deepEqual(vlans.map((v) => v.id), [1, 10]);
});

test('écriture : interface, vlan, route, hostname', async () => {
  let r = await api('PUT', `/api/devices/${dev.id}/interfaces`, { name: 'GigabitEthernet0/3', description: 'PC compta', adminUp: false, mode: 'access', accessVlan: 10 });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(emu.state.ifaces[2].description, 'PC compta');
  assert.equal(emu.state.ifaces[2].shutdown, true);
  assert.equal(emu.state.ifaces[2].vlan, 10);
  r = await api('POST', `/api/devices/${dev.id}/vlans`, { id: 20, name: 'VOIP' });
  assert.equal(r.body.ok, true);
  assert.equal(emu.state.vlans.get(20), 'VOIP');
  r = await api('DELETE', `/api/devices/${dev.id}/vlans/20`);
  assert.equal(emu.state.vlans.has(20), false);
  r = await api('POST', `/api/devices/${dev.id}/routes`, { network: '10.9.0.0/16', nextHop: '10.0.0.1' });
  assert.equal(r.body.ok, true);
  const routes = (await api('GET', `/api/devices/${dev.id}/routes`)).body;
  assert.deepEqual(routes.map((x) => [x.network, x.prefix, x.nextHop]), [['10.9.0.0', 16, '10.0.0.1']]);
  await api('PUT', `/api/devices/${dev.id}/hostname`, { hostname: 'SW-CORE' });
  assert.equal(emu.state.hostname, 'SW-CORE');
});

test('les erreurs CLI sont remontées', async () => {
  const r = await api('PUT', `/api/devices/${dev.id}/interfaces`, { name: 'GigabitEthernet9/9', description: 'x' });
  assert.equal(r.body.ok, false);
  assert.match(r.body.errors[0].message, /Invalid input/);
});

test('injection de commande refusée', async () => {
  const r = await api('PUT', `/api/devices/${dev.id}/interfaces`, { name: 'GigabitEthernet0/1', description: 'a\nreload' });
  assert.equal(r.status, 400);
  assert.ok(!emu.state.log.some((l) => l.includes('reload')));
});

test('commandes libres, save, sauvegarde config', async () => {
  const r = await api('POST', `/api/devices/${dev.id}/exec`, { commands: 'show vlan brief\nshow version' });
  assert.match(r.body.output, /USERS/);
  await api('POST', `/api/devices/${dev.id}/save`);
  assert.equal(emu.state.saved, 1);
  const b = (await api('POST', `/api/devices/${dev.id}/backups`)).body;
  const list = (await api('GET', `/api/devices/${dev.id}/backups`)).body;
  assert.equal(list[0].name, b.name);
  assert.match((await api('GET', `/api/devices/${dev.id}/backups/${b.name}`)).body, /hostname SW-CORE/);
  assert.equal((await api('GET', `/api/devices/${dev.id}/backups/..%2f..%2fetc`)).status, 400);
});

test('découverte CDP → nouvel appareil + lien, sans doublon', async () => {
  const { neighbors } = (await api('POST', `/api/devices/${dev.id}/discover`)).body;
  assert.equal(neighbors.length, 1);
  assert.equal(neighbors[0].remoteName, 'core-rtr.lan');
  assert.equal(neighbors[0].remoteIp, '10.0.0.1');
  await api('POST', `/api/devices/${dev.id}/discover/apply`, { neighbors });
  const devices = (await api('GET', '/api/devices')).body;
  assert.ok(devices.some((d) => d.name === 'core-rtr'));
  const again = (await api('POST', `/api/devices/${dev.id}/discover`)).body.neighbors;
  assert.equal(again[0].existing, true);
  await api('POST', `/api/devices/${dev.id}/discover/apply`, { neighbors: again });
  const links = (await api('GET', '/api/links')).body;
  assert.equal(links.filter((l) => l.source === 'discovered').length, 1);
});

test('audit + suppression en cascade', async () => {
  assert.ok((await api('GET', '/api/audit')).body.length > 5);
  await api('DELETE', `/api/devices/${dev.id}`);
  assert.equal((await api('GET', '/api/links')).body.length, 0);
});

test('secrets chiffrés sur disque', async () => {
  const raw = fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8');
  assert.ok(!raw.includes('"admin"') || !/"password": "admin"/.test(raw));
  assert.ok(!raw.includes('password123'));
});

test('prompts : doublons, séquences d’échappement, saut de page HP', async () => {
  const { CliSession, clean } = await import('../src/cli.js');
  const { default: procurve } = await import('../src/drivers/hp_procurve.js');
  const { default: cisco } = await import('../src/drivers/cisco_ios.js');
  const last = (s) => clean(s).split('\n').pop();
  assert.match(last('\x1b[24;1H\x1b[1;1HAmoniSwitch# AmoniSwitch# '), procurve.prompt);
  assert.match(last('RT01-JPO(config-subif)#'), cisco.prompt);
  assert.match(last('RT01-JPO>'), cisco.prompt);
  assert.doesNotMatch(last('% Invalid input detected'), cisco.prompt);
  assert.ok(CliSession);
});

test('session persistante : une seule connexion pour plusieurs actions', async () => {
  const d = (await api('POST', '/api/devices', { name: 'sw-p', type: 'switch', vendor: 'cisco_ios', host: '127.0.0.1', port: emu.port, username: 'admin', password: 'admin' })).body;
  const before = emu.state.connections;
  assert.equal((await api('POST', `/api/devices/${d.id}/connect`)).status, 200);
  await api('GET', `/api/devices/${d.id}/system`);
  await api('GET', `/api/devices/${d.id}/vlans`);
  await api('PUT', `/api/devices/${d.id}/hostname`, { hostname: 'SW-P' });
  assert.equal(emu.state.connections - before, 1);
  assert.equal((await api('GET', '/api/sessions')).body.length, 1);
  await api('POST', `/api/devices/${d.id}/disconnect`);
  assert.equal((await api('GET', '/api/sessions')).body.length, 0);
  await api('GET', `/api/devices/${d.id}/system`); // sans session : connexion éphémère
  assert.equal(emu.state.connections - before, 2);
  await api('DELETE', `/api/devices/${d.id}`);
});

test('sauvegardes : notes, comparaison, réinjection', async () => {
  const d = (await api('POST', '/api/devices', { name: 'sw-b', type: 'switch', vendor: 'cisco_ios', host: '127.0.0.1', port: emu.port, username: 'admin', password: 'admin' })).body;
  const b1 = (await api('POST', `/api/devices/${d.id}/backups`, { note: 'avant changement' })).body;
  assert.equal((await api('GET', `/api/devices/${d.id}/backups`)).body[0].note, 'avant changement');
  await api('PUT', `/api/devices/${d.id}/backups/${b1.name}/note`, { note: 'ok' });
  assert.equal((await api('GET', `/api/devices/${d.id}/backups`)).body[0].note, 'ok');

  await api('PUT', `/api/devices/${d.id}/interfaces`, { name: 'GigabitEthernet0/1', description: 'MODIFIE' });
  const diff = (await api('GET', `/api/devices/${d.id}/backups-diff?a=${b1.name}&b=live`)).body;
  assert.ok(diff.changes.some((c) => c.t === '+' && c.s.includes('MODIFIE')));
  assert.ok(diff.added >= 1);

  const prev = (await api('POST', `/api/devices/${d.id}/backups/${b1.name}/restore`, { mode: 'preview', removeExtra: true })).body;
  assert.equal(prev.applied, false);
  assert.ok(prev.commands.some((c) => c.includes('MODIFIE')));
  const done = (await api('POST', `/api/devices/${d.id}/backups/${b1.name}/restore`, { mode: 'apply', removeExtra: true })).body;
  assert.equal(done.applied, true);
  assert.equal(emu.state.ifaces[0].description, '');
  assert.ok((await api('GET', `/api/devices/${d.id}/backups`)).body.some((b) => b.note.startsWith('Automatique')));
  await api('DELETE', `/api/devices/${d.id}`);
});

test('parseurs Cisco routeur : VLANs sous-interfaces, NAT, DHCP', async () => {
  const c = await import('../src/drivers/cisco_ios.js');
  const cfg = 'interface FastEthernet0/1.10\n description Invites\n encapsulation dot1Q 10\n ip address 192.168.10.1 255.255.255.0\n ip nat inside\ninterface FastEthernet0/0\n ip address dhcp\n ip nat outside\nip nat inside source list 30 interface FastEthernet0/0 overload\nip dhcp pool P\n network 192.168.10.0 255.255.255.0\n';
  const ifs = c.parseInterfaces(cfg, '');
  assert.deepEqual(c.vlansFromSubinterfaces(ifs).map((v) => [v.id, v.name]), [[10, 'Invites']]);
  const nat = c.parseNat(cfg, ifs);
  assert.equal(nat.rules[0].overload, true);
  assert.deepEqual(nat.interfaces.map((i) => i.role), ['inside', 'outside'].reverse().reverse());
  assert.equal(c.parseDhcp(cfg).pools[0].network, '192.168.10.0');
});
