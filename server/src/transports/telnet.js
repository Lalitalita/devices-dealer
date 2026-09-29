import net from 'node:net';
import { EventEmitter } from 'node:events';

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;

/**
 * Connexion TCP brute / telnet — typique d'un serveur console (ser2net, Digi, Opengear…)
 * qui expose le port série d'un équipement.
 */
export function openTelnet(dev) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: dev.host, port: dev.port || 23 });
    const t = new EventEmitter();
    sock.setTimeout(12000, () => sock.destroy(new Error('Délai de connexion dépassé')));
    t.write = (d) => sock.write(d);
    t.resize = () => {};
    t.close = () => sock.end();

    sock.once('connect', () => {
      sock.setTimeout(0);
      resolve(t);
    });
    sock.on('error', (e) => (t.listenerCount('error') ? t.emit('error', e) : reject(e)));
    sock.on('close', () => t.emit('close'));

    // Filtre minimal des négociations telnet : on refuse toutes les options.
    sock.on('data', (buf) => {
      const out = [];
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== IAC) {
          out.push(buf[i]);
          continue;
        }
        const cmd = buf[i + 1];
        if (cmd === IAC) {
          out.push(IAC);
          i++;
        } else if (cmd === DO || cmd === DONT) {
          sock.write(Buffer.from([IAC, WONT, buf[i + 2]]));
          i += 2;
        } else if (cmd === WILL || cmd === WONT) {
          sock.write(Buffer.from([IAC, DONT, buf[i + 2]]));
          i += 2;
        } else if (cmd === SB) {
          while (i < buf.length && !(buf[i] === IAC && buf[i + 1] === SE)) i++;
          i++;
        } else i++;
      }
      if (out.length) t.emit('data', Buffer.from(out));
    });
  });
}
