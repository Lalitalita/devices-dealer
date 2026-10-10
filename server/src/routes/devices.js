import { seal } from '../crypto.js';
import { HttpError, safe, uid } from '../util.js';
import { checkReachable, disconnect } from '../sessions.js';
import { driverList } from '../drivers/index.js';

const TYPES = ['router', 'switch', 'firewall', 'ap', 'server', 'pc', 'cloud', 'other'];
const CONNECTIONS = ['ssh', 'telnet', 'serial'];

export const publicDevice = (d) => {
  const { password, privateKey, enableSecret, hostKey, ...rest } = d;
  return { ...rest, hasPassword: !!password, hasKey: !!privateKey, hasEnable: !!enableSecret, hostKeyKnown: !!hostKey };
};

function build(input, existing = {}) {
  const b = { ...existing };
  const str = (k, label) => input[k] !== undefined && (b[k] = safe(input[k], label || k));
  str('name', 'nom');
  if (!b.name) throw new HttpError(400, 'Le nom est obligatoire');
  if (input.type !== undefined) {
    if (!TYPES.includes(input.type)) throw new HttpError(400, 'Type inconnu');
    b.type = input.type;
  }
  b.type ||= 'other';
  b.virtual = input.virtual !== undefined ? !!input.virtual : !!b.virtual;
  str('notes');
  str('ip');
  str('mac');
  if (!b.virtual) {
    if (input.connection !== undefined) {
      if (!CONNECTIONS.includes(input.connection)) throw new HttpError(400, 'Connexion inconnue');
      b.connection = input.connection;
    }
    b.connection ||= 'ssh';
    str('vendor');
    b.vendor ||= 'generic';
    str('host');
    str('username');
    str('serialPath');
    if (input.port !== undefined) b.port = Number(input.port) || (b.connection === 'ssh' ? 22 : 23);
    if (input.baud !== undefined) b.baud = Number(input.baud) || 9600;
    if (b.connection === 'serial' ? !b.serialPath : !b.host) throw new HttpError(400, b.connection === 'serial' ? 'Port série requis' : 'Adresse requise');
    // secrets : champ absent ou vide = inchangé
    for (const k of ['password', 'privateKey', 'enableSecret']) if (input[k]) b[k] = seal(input[k]);
    if (input.resetHostKey) delete b.hostKey;
  }
  return b;
}

export function devicesRoutes(app, store) {
  const data = store.data;
  const find = (id) => {
    const d = data.devices.find((x) => x.id === id);
    if (!d) throw new HttpError(404, 'Appareil introuvable');
    return d;
  };

  app.get('/api/meta', async () => ({ drivers: driverList, types: TYPES, settings: { ...data.settings, passwordHash: undefined } }));

  app.get('/api/devices', async () => data.devices.map(publicDevice));

  app.post('/api/devices', async (req) => {
    const d = { id: uid(), position: null, created: Date.now(), ...build(req.body || {}) };
    data.devices.push(d);
    store.save();
    return publicDevice(d);
  });

  app.put('/api/devices/:id', async (req) => {
    const d = find(req.params.id);
    Object.assign(d, build(req.body || {}, d));
    disconnect(d.id); // les paramètres de connexion ont pu changer
    store.save();
    return publicDevice(d);
  });

  app.delete('/api/devices/:id', async (req) => {
    const d = find(req.params.id);
    disconnect(d.id);
    data.devices = data.devices.filter((x) => x !== d);
    data.links = data.links.filter((l) => l.a.deviceId !== d.id && l.b.deviceId !== d.id);
    store.save();
    return { ok: true };
  });

  app.put('/api/positions', async (req) => {
    for (const [id, pos] of Object.entries(req.body || {})) {
      const d = data.devices.find((x) => x.id === id);
      if (d) d.position = pos ? { x: Math.round(pos.x), y: Math.round(pos.y) } : null;
    }
    store.save();
    return { ok: true };
  });

  app.get('/api/status', async () => {
    const res = await Promise.all(data.devices.map(async (d) => [d.id, await checkReachable(d)]));
    return Object.fromEntries(res);
  });

  // --- liens ---
  const endpoint = (e) => {
    if (!e || !data.devices.some((d) => d.id === e.deviceId)) throw new HttpError(400, 'Extrémité de lien invalide');
    return { deviceId: e.deviceId, iface: safe(e.iface || '', 'interface') };
  };

  app.get('/api/links', async () => data.links);

  app.post('/api/links', async (req) => {
    const b = req.body || {};
    const l = { id: uid(), a: endpoint(b.a), b: endpoint(b.b), label: safe(b.label || '', 'label'), source: 'manual' };
    if (l.a.deviceId === l.b.deviceId) throw new HttpError(400, 'Un lien relie deux appareils différents');
    data.links.push(l);
    store.save();
    return l;
  });

  app.put('/api/links/:id', async (req) => {
    const l = data.links.find((x) => x.id === req.params.id);
    if (!l) throw new HttpError(404, 'Lien introuvable');
    const b = req.body || {};
    if (b.a) l.a = endpoint(b.a);
    if (b.b) l.b = endpoint(b.b);
    if (b.label !== undefined) l.label = safe(b.label, 'label');
    store.save();
    return l;
  });

  app.delete('/api/links/:id', async (req) => {
    data.links = data.links.filter((l) => l.id !== req.params.id);
    store.save();
    return { ok: true };
  });
}
