import fs from 'node:fs';
import path from 'node:path';
import { HttpError, safe, redact } from '../util.js';
import { getDriver } from '../drivers/index.js';
import { withCli, secretsOf, hostKeyChecker, connect, disconnect, listSessions, getPersistent } from '../sessions.js';
import { normalize, diffLines, diffStats, restorePlan } from '../configdiff.js';
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
  async function push(req, action, build, { save = false, dynamic = false } = {}) {
    const d = dev(req);
    if (d.virtual) throw new HttpError(400, 'Machine vide : aucune connexion');
    const drv = getDriver(d.vendor);
    let cmds = dynamic ? null : build(drv.write);
    if (!dynamic && !cmds) throw unsupported();
    let result;
    try {
      result = await withCli(store, d, async (cli) => {
        if (dynamic) {
          cmds = await build(drv.write, cli);
          if (!cmds) throw unsupported();
        }
        const r = await cli.configure(cmds);
        if (save && !r.errors.length) r.saved = await cli.save();
        return r;
      });
    } catch (e) {
      store.audit({ user: req.user, deviceId: d.id, device: d.name, action, commands: (cmds || []).map(redact), ok: false, errors: [e.message] });
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
  g('nat', 'nat');
  g('nat-translations', 'natTranslations');
  g('dhcp', 'dhcp');
  g('dhcp-bindings', 'dhcpBindings');

  // --- sessions persistantes ---
  app.get('/api/sessions', async () => listSessions());
  app.post('/api/devices/:id/connect', async (req) => {
    const d = dev(req);
    await connect(store, d);
    store.audit({ user: req.user, deviceId: d.id, device: d.name, action: 'connexion', commands: [], ok: true, errors: [] });
    return { connected: true };
  });
  app.post('/api/devices/:id/disconnect', async (req) => {
    const d = dev(req);
    const was = disconnect(d.id);
    if (was) store.audit({ user: req.user, deviceId: d.id, device: d.name, action: 'déconnexion', commands: [], ok: true, errors: [] });
    return { connected: false };
  });

  app.put('/api/devices/:id/interfaces', async (req) => {
    const { name, ...patch } = req.body || {};
    return push(req, `interface ${name}`, (w) => w.interface?.(name, { ...patch, router: dev(req).type === 'router' }), { save: patch.save });
  });
  app.put('/api/devices/:id/hostname', async (req) => push(req, 'hostname', (w) => w.hostname?.(req.body?.hostname)));
  app.post('/api/devices/:id/vlans', async (req) => push(req, `vlan ${req.body?.id}`, (w) => w.vlanCreate?.(req.body?.id, req.body?.name)));
  app.delete('/api/devices/:id/vlans/:vid', async (req) => push(req, `suppression vlan ${req.params.vid}`, (w) => w.vlanDelete?.(req.params.vid)));
  app.post('/api/devices/:id/routes', async (req) => push(req, 'route statique +', (w) => w.routeAdd?.(req.body || {})));
  app.post('/api/devices/:id/routes/delete', async (req) => push(req, 'route statique −', (w) => w.routeDelete?.(req.body || {})));

  app.post('/api/devices/:id/subinterfaces', async (req) => push(req, 'sous-interface +', (w) => w.subinterface?.(req.body || {})));
  app.post('/api/devices/:id/subinterfaces/delete', async (req) => push(req, 'sous-interface −', (w) => w.subinterfaceDelete?.(req.body?.name)));

  // NAT
  app.put('/api/devices/:id/nat/interface', async (req) => push(req, `nat ${req.body?.role} ${req.body?.name}`, (w) => w.natInterface?.(req.body?.name, req.body?.role)));
  app.post('/api/devices/:id/nat/pat', async (req) =>
    push(req, 'nat : partage de connexion (PAT)', async (w, cli) => {
      if (!w.natPat) return null;
      const nat = await getDriver(dev(req).vendor).read.nat(cli);
      const names = new Set(req.body?.inside || []);
      const inside = nat.interfaces.filter((i) => names.has(i.name) && /^\d/.test(i.ip));
      if (inside.length !== names.size) throw new HttpError(400, 'Chaque interface interne doit avoir une adresse IP fixe');
      return w.natPat({ outside: req.body?.outside, inside, acl: req.body?.acl });
    }, { dynamic: true }));
  app.post('/api/devices/:id/nat/static', async (req) => push(req, 'nat : règle statique', (w) => w.natStatic?.(req.body || {})));
  app.post('/api/devices/:id/nat/delete', async (req) => push(req, 'nat : suppression règle', (w) => w.natRuleDelete?.(req.body?.raw)));

  // DHCP
  app.post('/api/devices/:id/dhcp/pools', async (req) => push(req, `dhcp pool ${req.body?.name}`, (w) => w.dhcpPoolSet?.(req.body || {})));
  app.post('/api/devices/:id/dhcp/pools/delete', async (req) => push(req, `dhcp pool − ${req.body?.name}`, (w) => w.dhcpPoolDelete?.(req.body?.name)));
  app.post('/api/devices/:id/dhcp/excluded', async (req) => push(req, 'dhcp exclusion +', (w) => w.dhcpExcludeAdd?.(req.body || {})));
  app.post('/api/devices/:id/dhcp/excluded/delete', async (req) => push(req, 'dhcp exclusion −', (w) => w.dhcpExcludeDelete?.(req.body || {})));

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

  // --- sauvegardes de configuration (avec notes, comparaison, réinjection) ---
  const bdir = (d) => path.join(store.dir, 'backups', d.id);
  const bfile = (d, name) => {
    if (!/^[\w.-]+\.cfg$/.test(name)) throw new HttpError(400, 'Nom invalide');
    return path.join(bdir(d), name);
  };
  const metaFile = (d) => path.join(bdir(d), 'meta.json');
  const readMeta = (d) => {
    try { return JSON.parse(fs.readFileSync(metaFile(d), 'utf8')); } catch { return {}; }
  };
  const writeMeta = (d, m) => {
    fs.mkdirSync(bdir(d), { recursive: true });
    fs.writeFileSync(metaFile(d), JSON.stringify(m, null, 2), { mode: 0o600 });
  };
  const readBackup = (d, name) => {
    const f = bfile(d, name);
    if (!fs.existsSync(f)) throw new HttpError(404, 'Sauvegarde introuvable');
    return fs.readFileSync(f, 'utf8');
  };
  const saveBackup = (d, cfg, note = '') => {
    fs.mkdirSync(bdir(d), { recursive: true });
    let name = `${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.cfg`;
    for (let i = 2; fs.existsSync(bfile(d, name)); i++) name = name.replace(/(-\d+)?\.cfg$/, `-${i}.cfg`);
    fs.writeFileSync(bfile(d, name), cfg, { mode: 0o600 });
    if (note) writeMeta(d, { ...readMeta(d), [name]: { note } });
    return name;
  };

  app.get('/api/devices/:id/backups', async (req) => {
    const d = dev(req);
    if (!fs.existsSync(bdir(d))) return [];
    const meta = readMeta(d);
    return fs.readdirSync(bdir(d)).filter((f) => f.endsWith('.cfg')).sort().reverse()
      .map((f) => ({ name: f, size: fs.statSync(path.join(bdir(d), f)).size, note: meta[f]?.note || '' }));
  });

  app.post('/api/devices/:id/backups', async (req) => {
    const d = dev(req);
    const note = safe(req.body?.note || '', 'note').slice(0, 500);
    const cfg = await withCli(store, d, (cli) => getDriver(d.vendor).read.config(cli));
    const name = saveBackup(d, cfg, note);
    store.audit({ user: req.user, deviceId: d.id, device: d.name, action: 'sauvegarde config', commands: [], ok: true, errors: [] });
    return { name, size: cfg.length };
  });

  app.put('/api/devices/:id/backups/:name/note', async (req) => {
    const d = dev(req);
    readBackup(d, req.params.name);
    const note = String(req.body?.note || '').replace(/[\x00-\x08\x0b-\x1f]/g, '').slice(0, 2000);
    const m = readMeta(d);
    if (note) m[req.params.name] = { note }; else delete m[req.params.name];
    writeMeta(d, m);
    return { ok: true };
  });

  app.get('/api/devices/:id/backups/:name', async (req, reply) => {
    const text = readBackup(dev(req), req.params.name);
    reply.header('content-type', 'text/plain; charset=utf-8');
    if (req.query.download) reply.header('content-disposition', `attachment; filename="${req.params.name}"`);
    return text;
  });

  app.delete('/api/devices/:id/backups/:name', async (req) => {
    const d = dev(req);
    fs.rmSync(bfile(d, req.params.name), { force: true });
    const m = readMeta(d);
    delete m[req.params.name];
    writeMeta(d, m);
    return { ok: true };
  });

  const liveConfig = (d) => withCli(store, d, (cli) => getDriver(d.vendor).read.config(cli));

  // comparaison : a = sauvegarde, b = sauvegarde ou "live" (config actuelle de l'équipement)
  app.get('/api/devices/:id/backups-diff', async (req) => {
    const d = dev(req);
    const { a, b, noise } = req.query;
    const load = async (n) => (n === 'live' ? liveConfig(d) : readBackup(d, n));
    const [ta, tb] = [await load(a), await load(b)];
    const opts = { ignoreNoise: noise !== '0' };
    const changes = diffLines(normalize(ta, opts), normalize(tb, opts));
    return { changes, ...diffStats(changes) };
  });

  // réinjection : aperçu (preview) ou application (apply), toujours en mode fusion
  app.post('/api/devices/:id/backups/:name/restore', async (req) => {
    const d = dev(req);
    const drv = getDriver(d.vendor);
    if (!drv.write.negate) throw unsupported();
    const { mode = 'preview', removeExtra = false, save = false } = req.body || {};
    const backup = readBackup(d, req.params.name);
    const result = await withCli(store, d, async (cli) => {
      const live = await drv.read.config(cli);
      const plan = restorePlan(backup, live, { removeExtra: !!removeExtra, negate: drv.write.negate });
      if (mode !== 'apply') return { ...plan, applied: false };
      if (!plan.commands.length) return { ...plan, applied: false, errors: [], output: '' };
      const safety = saveBackup(d, live, `Automatique : avant réinjection de ${req.params.name}`);
      const r = await cli.configure(plan.commands);
      if (save && !r.errors.length) r.saved = await cli.save();
      return { ...plan, applied: true, safetyBackup: safety, ...r };
    });
    if (result.applied) {
      store.audit({ user: req.user, deviceId: d.id, device: d.name, action: `réinjection ${req.params.name}`, commands: result.commands.map(redact), ok: !result.errors.length, errors: result.errors.map((e) => e.message) });
    }
    return result;
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
    let onData;
    socket.on('close', () => (shared ? onData && t.off('data', onData) : t?.close()));
    let shared = false;
    try {
      if (d.connection === 'serial') {
        // un port série n'accepte qu'un seul client : on se branche sur la session ouverte
        const p = getPersistent(d.id);
        if (!p) throw new Error('Connectez d’abord l’appareil (port série exclusif)');
        t = p.cli.t;
        shared = true;
      } else t = await openTransport(d, secretsOf(d), { onHostKey: hostKeyChecker(store, d) });
    } catch (e) {
      send({ type: 'error', data: `Connexion impossible : ${e.message}` });
      return socket.close();
    }
    onData = (b) => send({ type: 'output', data: b.toString('utf8') });
    t.on('data', onData);
    t.on('close', () => { send({ type: 'closed' }); socket.close(); });
    t.on('error', (e) => send({ type: 'error', data: e.message }));
    pending.forEach((m) => t.write(m.data));
    store.audit({ user: req.user, deviceId: d.id, device: d.name, action: 'session terminal', commands: [], ok: true, errors: [] });
    send({ type: 'ready' });
  });
}
