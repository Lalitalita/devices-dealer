import fs from 'node:fs';
import path from 'node:path';
import { HttpError, safe, redact } from '../util.js';
import { getDriver } from '../drivers/index.js';
import { withCli, secretsOf, hostKeyChecker } from '../sessions.js';
import { openTransport } from '../transports/index.js';
import { propose, apply } from '../discovery.js';

export function opsRoutes(app, store) {
  const data = store.data;
  const dev = (req) => {
    const d = data.devices.find((x) => x.id === req.params.id);
    if (!d) throw new HttpError(404, 'Appareil introuvable');
    return d;
  };
  const unsupported = () => new HttpError(501, 'Non pris en charge pour cette marque — utilisez « Commandes » ou « Console »');

  const read = (what) => async (req) => {
    const d = dev(req);
    if (d.virtual) throw new HttpError(400, 'Machine vide : aucune connexion');
    const fn = getDriver(d.vendor).read[what];
    if (!fn) throw unsupported();
    return withCli(store, d, fn);
  };

  /** Construit les commandes AVANT de se connecter (validation), puis les pousse et journalise. */
  async function push(req, action, build, { save = false } = {}) {
    const d = dev(req);
    if (d.virtual) throw new HttpError(400, 'Machine vide : aucune connexion');
    const drv = getDriver(d.vendor);
    const cmds = build(drv.write);
    if (!cmds) throw unsupported();
    let result;
    try {
      result = await withCli(store, d, async (cli) => {
        const r = await cli.configure(cmds);
        if (save && !r.errors.length) r.saved = await cli.save();
        return r;
      });
    } catch (e) {
      store.audit({ user: req.user, deviceId: d.id, device: d.name, action, commands: cmds.map(redact), ok: false, errors: [e.message] });
      throw e;
    }
    store.audit({ user: req.user, deviceId: d.id, device: d.name, action, commands: cmds.map(redact), ok: !result.errors.length, errors: result.errors.map((e) => e.message) });
    return { ok: !result.errors.length, commands: cmds, ...result };
  }

  const g = (p, what) => app.get(`/api/devices/:id/${p}`, read(what));
  g('system', 'system');
  g('interfaces', 'interfaces');
  g('vlans', 'vlans');
  g('routes', 'routes');
  g('routing-table', 'routingTable');
  g('neighbors', 'neighbors');

  app.put('/api/devices/:id/interfaces', async (req) => {
    const { name, ...patch } = req.body || {};
    return push(req, `interface ${name}`, (w) => w.interface?.(name, { ...patch, router: dev(req).type === 'router' }), { save: patch.save });
  });
  app.put('/api/devices/:id/hostname', async (req) => push(req, 'hostname', (w) => w.hostname?.(req.body?.hostname)));
  app.post('/api/devices/:id/vlans', async (req) => push(req, `vlan ${req.body?.id}`, (w) => w.vlanCreate?.(req.body?.id, req.body?.name)));
  app.delete('/api/devices/:id/vlans/:vid', async (req) => push(req, `suppression vlan ${req.params.vid}`, (w) => w.vlanDelete?.(req.params.vid)));
  app.post('/api/devices/:id/routes', async (req) => push(req, 'route statique +', (w) => w.routeAdd?.(req.body || {})));
  app.post('/api/devices/:id/routes/delete', async (req) => push(req, 'route statique −', (w) => w.routeDelete?.(req.body || {})));

  app.post('/api/devices/:id/save', async (req) => {
    const d = dev(req);
    const out = await withCli(store, d, (cli) => cli.save());
    store.audit({ user: req.user, deviceId: d.id, device: d.name, action: 'enregistrement config', commands: [getDriver(d.vendor).save], ok: true, errors: [] });
    return { ok: true, output: out };
  });

  app.post('/api/devices/:id/exec', async (req) => {
    const d = dev(req);
    const { commands, config = false, save = false } = req.body || {};
    const cmds = String(commands || '').split('\n').map((c) => safe(c, 'commande')).filter(Boolean);
    if (!cmds.length || cmds.length > 200) throw new HttpError(400, 'Entre 1 et 200 commandes');
    const drv = getDriver(d.vendor);
    const result = await withCli(store, d, async (cli) => {
      if (config) {
        const r = await cli.configure(cmds);
        if (save && !r.errors.length) await cli.save();
        return r;
      }
      const out = [];
      for (const c of cmds) out.push(`${drv.prompt ? '> ' : ''}${c}\n${await cli.run(c, { timeout: 60000 })}`);
      return { output: out.join('\n\n'), errors: [] };
    });
    store.audit({ user: req.user, deviceId: d.id, device: d.name, action: config ? 'commandes (config)' : 'commandes (lecture)', commands: cmds.map(redact), ok: !result.errors.length, errors: result.errors.map((e) => e.message) });
    return result;
  });

  // --- sauvegardes de configuration ---
  const bdir = (d) => path.join(store.dir, 'backups', d.id);
  const bfile = (d, name) => {
    if (!/^[\w.-]+$/.test(name)) throw new HttpError(400, 'Nom invalide');
    return path.join(bdir(d), name);
  };

  app.get('/api/devices/:id/backups', async (req) => {
    const d = dev(req);
    if (!fs.existsSync(bdir(d))) return [];
    return fs.readdirSync(bdir(d)).sort().reverse().map((f) => ({ name: f, size: fs.statSync(path.join(bdir(d), f)).size }));
  });

  app.post('/api/devices/:id/backups', async (req) => {
    const d = dev(req);
    const cfg = await withCli(store, d, (cli) => getDriver(d.vendor).read.config(cli));
    fs.mkdirSync(bdir(d), { recursive: true });
    const name = `${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.cfg`;
    fs.writeFileSync(bfile(d, name), cfg, { mode: 0o600 });
    store.audit({ user: req.user, deviceId: d.id, device: d.name, action: 'sauvegarde config', commands: [], ok: true, errors: [] });
    return { name, size: cfg.length };
  });

  app.get('/api/devices/:id/backups/:name', async (req, reply) => {
    const f = bfile(dev(req), req.params.name);
    if (!fs.existsSync(f)) throw new HttpError(404, 'Sauvegarde introuvable');
    reply.header('content-type', 'text/plain; charset=utf-8');
    if (req.query.download) reply.header('content-disposition', `attachment; filename="${req.params.name}"`);
    return fs.readFileSync(f, 'utf8');
  });

  app.delete('/api/devices/:id/backups/:name', async (req) => {
    fs.rmSync(bfile(dev(req), req.params.name), { force: true });
    return { ok: true };
  });

  // --- découverte LLDP/CDP ---
  app.post('/api/devices/:id/discover', async (req) => {
    const d = dev(req);
    const fn = getDriver(d.vendor).read.neighbors;
    if (!fn) throw unsupported();
    const neighbors = await withCli(store, d, fn);
    return { neighbors: propose(store, d, neighbors) };
  });

  app.post('/api/devices/:id/discover/apply', async (req) => {
    const d = dev(req);
    const picked = Array.isArray(req.body?.neighbors) ? req.body.neighbors : [];
    const r = apply(store, d, picked);
    store.audit({ user: req.user, deviceId: d.id, device: d.name, action: 'découverte', commands: [], ok: true, errors: [], detail: `${r.created.length} appareil(s), ${r.linked.length} lien(s)` });
    return r;
  });

  // --- terminal interactif (xterm.js) ---
  app.get('/api/devices/:id/terminal', { websocket: true }, async (socket, req) => {
    const d = data.devices.find((x) => x.id === req.params.id);
    const send = (m) => socket.readyState === 1 && socket.send(JSON.stringify(m));
    if (!d || d.virtual) {
      send({ type: 'error', data: 'Appareil sans connexion' });
      return socket.close();
    }
    let t;
    const pending = [];
    socket.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!t) return void (m.type === 'input' && pending.push(m));
      if (m.type === 'input') t.write(m.data);
      else if (m.type === 'resize') t.resize(m.cols, m.rows);
    });
    socket.on('close', () => t?.close());
    try {
      t = await openTransport(d, secretsOf(d), { onHostKey: hostKeyChecker(store, d) });
    } catch (e) {
      send({ type: 'error', data: `Connexion impossible : ${e.message}` });
      return socket.close();
    }
    t.on('data', (b) => send({ type: 'output', data: b.toString('utf8') }));
    t.on('close', () => { send({ type: 'closed' }); socket.close(); });
    t.on('error', (e) => send({ type: 'error', data: e.message }));
    pending.forEach((m) => t.write(m.data));
    store.audit({ user: req.user, deviceId: d.id, device: d.name, action: 'session terminal', commands: [], ok: true, errors: [] });
    send({ type: 'ready' });
  });
}
