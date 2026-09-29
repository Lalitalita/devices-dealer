import { randomUUID } from 'node:crypto';

export const uid = () => randomUUID().slice(0, 8);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Refuse toute valeur pouvant injecter une seconde commande dans une CLI. */
export function safe(value, label = 'valeur') {
  const s = String(value ?? '');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) throw new HttpError(400, `${label} : caractères de contrôle interdits`);
  return s.trim();
}

export function safeInt(value, label, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} invalide (${min}-${max})`);
  return n;
}

export function safeIp(value, label = 'IP') {
  const s = safe(value, label);
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m || m.slice(1).some((o) => Number(o) > 255)) throw new HttpError(400, `${label} invalide`);
  return s;
}

/** Accepte "10.0.0.0/8" ou "10.0.0.0 255.0.0.0" → { net, mask } */
export function parseNetwork(input) {
  const s = safe(input, 'réseau');
  let net, mask;
  if (s.includes('/')) {
    const [n, p] = s.split('/');
    net = safeIp(n, 'réseau');
    mask = prefixToMask(safeInt(p, 'préfixe', 0, 32));
  } else {
    [net, mask] = s.split(/\s+/);
    safeIp(net, 'réseau');
    safeIp(mask, 'masque');
  }
  return { net, mask };
}

export function prefixToMask(p) {
  const bits = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
  return [24, 16, 8, 0].map((sh) => (bits >>> sh) & 255).join('.');
}

export function maskToPrefix(mask) {
  return mask.split('.').reduce((n, o) => n + Number(o).toString(2).replace(/0/g, '').length, 0);
}

/** Masque les lignes sensibles avant journalisation. */
export function redact(line) {
  return /(password|secret|community|key|passphrase)/i.test(line) ? line.replace(/(\S+)\s*$/, '***') : line;
}
