import { EventEmitter } from 'node:events';

/** Console série locale (câble console USB → /dev/ttyUSB0 monté dans le conteneur). */
export async function openSerial(dev) {
  let SerialPort;
  try {
    ({ SerialPort } = await import('serialport'));
  } catch {
    throw new Error("Module 'serialport' indisponible dans cette image");
  }
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: dev.serialPath, baudRate: dev.baud || 9600, autoOpen: false });
    const t = new EventEmitter();
    t.write = (d) => port.write(d);
    t.resize = () => {};
    t.close = () => port.isOpen && port.close();
    port.on('data', (d) => t.emit('data', d));
    port.on('close', () => t.emit('close'));
    port.on('error', (e) => t.emit('error', e));
    port.open((err) => (err ? reject(err) : resolve(t)));
  });
}
