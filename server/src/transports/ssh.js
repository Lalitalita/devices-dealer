import { EventEmitter } from 'node:events';
import { Client } from 'ssh2';

// Les vieux Cisco/HP n'annoncent souvent que des algos dépréciés : on les ajoute en dernier recours.
const LEGACY = {
  kex: {
    append: ['diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group1-sha1'],
  },
  cipher: { append: ['aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc'] },
  serverHostKey: { append: ['ssh-rsa', 'ssh-dss'] },
  hmac: { append: ['hmac-sha1'] },
};

/**
 * Ouvre un shell SSH interactif.
 * `onHostKey(fingerprint)` renvoie true si l'empreinte est acceptée (TOFU).
 */
export function openSsh(dev, secrets, { cols = 200, rows = 50, onHostKey } = {}) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const t = new EventEmitter();
    let done = false;

    t.write = (d) => t.stream?.write(d);
    t.resize = (c, r) => t.stream?.setWindow(r, c, 0, 0);
    t.close = () => client.end();

    client
      .on('ready', () => {
        client.shell({ term: 'vt100', cols, rows }, (err, stream) => {
          if (err) return reject(err);
          t.stream = stream;
          stream.on('data', (d) => t.emit('data', d));
          stream.stderr?.on('data', (d) => t.emit('data', d));
          stream.on('close', () => {
            client.end();
            t.emit('close');
          });
          done = true;
          resolve(t);
        });
      })
      .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => secrets.password || '')))
      .on('error', (e) => {
        if (!done) reject(e);
        else t.emit('error', e);
      })
      .on('close', () => t.emit('close'))
      .connect({
        host: dev.host,
        port: dev.port || 22,
        username: dev.username,
        password: secrets.password || undefined,
        privateKey: secrets.privateKey || undefined,
        tryKeyboard: true,
        readyTimeout: 12000,
        keepaliveInterval: 15000,
        algorithms: LEGACY,
        hostHash: 'sha256',
        hostVerifier: (hash) => (onHostKey ? onHostKey(hash) : true),
      });
  });
}
