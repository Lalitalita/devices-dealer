import { startEmulator } from './emulator.js';

const port = Number(process.env.EMU_PORT) || 2222;
const name = process.env.EMU_NAME || 'SW-DEMO';
const { port: p } = await startEmulator({
  port,
  hostname: name,
  neighbors: [
    { name: 'core-rtr.lan', ip: '10.0.0.1', local: 'GigabitEthernet0/1', remote: 'GigabitEthernet0/0' },
    { name: 'sw-etage2.lan', ip: '10.0.0.3', local: 'GigabitEthernet0/2', remote: 'GigabitEthernet0/24' },
  ],
});
console.log(`Émulateur Cisco « ${name} » sur :${p} (admin / admin)`);
