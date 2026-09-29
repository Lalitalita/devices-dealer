import { openSsh } from './ssh.js';
import { openTelnet } from './telnet.js';
import { openSerial } from './serial.js';

export function openTransport(dev, secrets, opts) {
  switch (dev.connection) {
    case 'ssh':
      return openSsh(dev, secrets, opts);
    case 'telnet':
      return openTelnet(dev, secrets, opts);
    case 'serial':
      return openSerial(dev, secrets, opts);
    default:
      throw new Error(`Type de connexion inconnu : ${dev.connection}`);
  }
}
