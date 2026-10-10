import net from 'node:net';
import fs from 'node:fs';
import { openTransport } from './transports/index.js';
import { CliSession } from './cli.js';
import { getDriver } from './drivers/index.js';
import { unseal } from './crypto.js';
import { HttpError } from './util.js';

export const secretsOf = (dev) => ({
  password: unseal(dev.password),
  privateKey: unseal(dev.privateKey),
  enableSecret: unseal(dev.enableSecret),
});

// Une seule session CLI à la fois par équipement (obligatoire pour une console série).
const locks = new Map();
async function lock(id) {
  const prev = locks.get(id) || Promise.resolve();
  let release;
  locks.set(id, new Promise((r) => (release = r)));
  await prev;
  return release;
}

export function hostKeyChecker(store, dev) {
  return (fingerprint) => {
    if (!dev.hostKey) {
      dev.hostKey = fingerprint; // TOFU : on mémorise à la première connexion
      store.save();
      return true;
    }
    return dev.hostKey === fingerprint;
  };
}

// --- sessions persistantes : l'utilisateur se connecte une fois, on garde la connexion ouverte ---
const IDLE_MS = (Number(process.env.SESSION_IDLE_MIN) || 30) * 60000;
const persistent = new Map(); // deviceId -> { cli, since, lastUsed, timer }

export const getPersistent = (id) => persistent.get(id);
export const listSessions = () => [...persistent].map(([id, p]) => ({ id, since: p.since, lastUsed: p.lastUsed, idleMs: IDLE_MS }));

async function openCli(store, dev) {
  const secrets = secretsOf(dev);
  const t = await openTransport(dev, secrets, { onHostKey: hostKeyChecker(store, dev) }).catch((e) => {
    if (/host key|hostkey|verif/i.test(e.message)) throw new HttpError(502, 'Empreinte SSH modifiée — réinitialisez-la dans la fiche de l’appareil');
    throw new HttpError(502, `Connexion impossible : ${e.message}`);
  });
  const cli = new CliSession(t, getDriver(dev.vendor), secrets, dev.username);
  try {
    await cli.init();
  } catch (e) {
    cli.close();
    throw e;
  }
  return cli;
}

function arm(id) {
  const p = persistent.get(id);
  if (!p) return;
  p.lastUsed = Date.now();
  clearTimeout(p.timer);
  p.timer = setTimeout(() => disconnect(id), IDLE_MS);
}

export async function connect(store, dev) {
  if (dev.virtual) throw new HttpError(400, 'Cet appareil est une machine vide (aucune connexion)');
  if (persistent.has(dev.id)) return persistent.get(dev.id);
  const release = await lock(dev.id);
  try {
    if (persistent.has(dev.id)) return persistent.get(dev.id);
    const cli = await openCli(store, dev);
    const p = { cli, since: Date.now(), lastUsed: Date.now(), timer: null };
    persistent.set(dev.id, p);
    cli.t.on('close', () => persistent.get(dev.id) === p && disconnect(dev.id));
    arm(dev.id);
    return p;
  } finally {
    release();
  }
}

export function disconnect(id) {
  const p = persistent.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  persistent.delete(id);
  p.cli.close();
  return true;
}

/** Utilise la session persistante si elle existe, sinon ouvre une connexion éphémère. */
export async function withCli(store, dev, fn) {
  if (dev.virtual) throw new HttpError(400, 'Cet appareil est une machine vide (aucune connexion)');
  const release = await lock(dev.id);
  const p = persistent.get(dev.id);
  let cli = p?.cli;
  try {
    if (!cli) cli = await openCli(store, dev);
    const out = await fn(cli);
    if (p) arm(dev.id);
    return out;
  } catch (e) {
    // une commande qui n'a jamais rendu la main laisse la session dans un état incertain : on la ferme
    if (p && (e.status === 504 || cli.closed)) disconnect(dev.id);
    throw e;
  } finally {
    if (!p) cli?.close();
    release();
  }
}

export function checkReachable(dev, timeout = 2000) {
  if (dev.virtual) return Promise.resolve(null);
  if (dev.connection === 'serial') return Promise.resolve(fs.existsSync(dev.serialPath || ''));
  return new Promise((resolve) => {
    const s = net.connect({ host: dev.host, port: dev.port || (dev.connection === 'ssh' ? 22 : 23) });
    const end = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
}
