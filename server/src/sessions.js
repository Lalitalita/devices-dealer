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

export async function withCli(store, dev, fn) {
  if (dev.virtual) throw new HttpError(400, 'Cet appareil est une machine vide (aucune connexion)');
  const release = await lock(dev.id);
  let cli;
  try {
    const secrets = secretsOf(dev);
    const t = await openTransport(dev, secrets, { onHostKey: hostKeyChecker(store, dev) }).catch((e) => {
      if (/host key|hostkey|verif/i.test(e.message)) throw new HttpError(502, 'Empreinte SSH modifiée — réinitialisez-la dans la fiche de l’appareil');
      throw new HttpError(502, `Connexion impossible : ${e.message}`);
    });
    cli = new CliSession(t, getDriver(dev.vendor), secrets, dev.username);
    await cli.init();
    return await fn(cli);
  } finally {
    cli?.close();
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
