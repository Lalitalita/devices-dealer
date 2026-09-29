import { uid } from './util.js';

const baseName = (n) => String(n || '').toLowerCase().split('.')[0];
const canon = (n) => String(n || '').toLowerCase().replace(/^([a-z]{2})[a-z\-]*?(\d)/, '$1$2');

/** Retrouve l'appareil connu correspondant à un voisin LLDP/CDP. */
export function matchDevice(devices, n) {
  return devices.find((d) => (n.remoteIp && d.host === n.remoteIp) || (n.remoteName && baseName(d.name) === baseName(n.remoteName)));
}

function guessType(n) {
  const c = `${n.capabilities} ${n.platform}`.toLowerCase();
  if (/router|\bR\b/.test(c) && !/switch/.test(c)) return 'router';
  if (/switch|bridge|\bB\b|\bS\b/.test(c)) return 'switch';
  if (/phone|\bH\b/.test(c)) return 'other';
  return /wlan|access point|\bW\b/.test(c) ? 'ap' : 'switch';
}

/** Transforme une liste de voisins en propositions (nouveaux appareils + liens). */
export function propose(store, source, neighbors) {
  const { devices, links } = store.data;
  const seen = new Set();
  const out = [];
  for (const n of neighbors) {
    const key = `${canon(n.localIf)}|${baseName(n.remoteName)}|${canon(n.remoteIf)}`;
    if (seen.has(key)) continue; // CDP + LLDP donnent le même voisin
    seen.add(key);
    const known = matchDevice(devices, n);
    const dup = known && links.some((l) => sameLink(l, { a: { deviceId: source.id, iface: n.localIf }, b: { deviceId: known.id, iface: n.remoteIf } }));
    out.push({ ...n, id: uid(), knownDeviceId: known?.id || null, existing: !!dup, suggestedType: known?.type || guessType(n) });
  }
  return out;
}

export function sameLink(l, m) {
  const k = (e) => `${e.deviceId}:${canon(e.iface)}`;
  return (k(l.a) === k(m.a) && k(l.b) === k(m.b)) || (k(l.a) === k(m.b) && k(l.b) === k(m.a));
}

/** Applique les propositions retenues : crée les appareils manquants puis les liens. */
export function apply(store, source, picked) {
  const created = [];
  const linked = [];
  for (const n of picked) {
    let dev = n.knownDeviceId && store.data.devices.find((d) => d.id === n.knownDeviceId);
    if (!dev) {
      dev = {
        id: uid(), name: baseName(n.remoteName) || n.remoteIp || 'inconnu', type: n.suggestedType || 'switch', vendor: 'generic',
        virtual: false, connection: 'ssh', host: n.remoteIp || '', port: 22, username: '', notes: `Découvert via ${n.protocol.toUpperCase()} depuis ${source.name}`,
        position: null, created: Date.now(),
      };
      store.data.devices.push(dev);
      created.push(dev.id);
    }
    const link = { id: uid(), a: { deviceId: source.id, iface: n.localIf }, b: { deviceId: dev.id, iface: n.remoteIf }, source: 'discovered' };
    if (!store.data.links.some((l) => sameLink(l, link))) {
      store.data.links.push(link);
      linked.push(link.id);
    }
  }
  store.save();
  return { created, linked };
}
