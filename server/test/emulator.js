// Faux commutateur Cisco IOS en SSH : sert aux tests et à la démo (docker compose --profile demo).
import crypto from 'node:crypto';
import ssh2 from 'ssh2';

const { Server } = ssh2;

export function startEmulator({ port = 0, hostname = 'SW1', user = 'admin', pass = 'admin', neighbors = [] } = {}) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  const state = {
    hostname,
    vlans: new Map([[1, 'default'], [10, 'USERS']]),
    ifaces: ['GigabitEthernet0/1', 'GigabitEthernet0/2', 'GigabitEthernet0/3'].map((name, i) => ({ name, description: '', shutdown: false, mode: 'access', vlan: 1, up: i < 2 })),
    routes: [],
    saved: 0,
    log: [],
  };
  const short = (n) => n.replace('GigabitEthernet', 'Gi');

  const running = () =>
    [
      'Building configuration...', '', `hostname ${state.hostname}`, '!',
      ...state.ifaces.flatMap((i) => [
        `interface ${i.name}`,
        ...(i.description ? [` description ${i.description}`] : []),
        ` switchport mode ${i.mode}`,
        ...(i.mode === 'access' ? [` switchport access vlan ${i.vlan}`] : []),
        ...(i.shutdown ? [' shutdown'] : []), '!',
      ]),
      ...state.routes.map((r) => `ip route ${r}`), 'end',
    ].join('\n');

  const cdp = () =>
    neighbors.map((n) => `-------------------------\nDevice ID: ${n.name}\nEntry address(es): \n  IP address: ${n.ip}\nPlatform: cisco WS-C2960,  Capabilities: Switch IGMP \nInterface: ${n.local},  Port ID (outgoing port): ${n.remote}\nHoldtime : 150 sec\n`).join('\n');

  function exec(cmd, mode) {
    const c = cmd.trim();
    if (!c) return { out: '' };
    state.log.push(`${mode}:${c}`);
    if (mode.cfg) {
      let m;
      if (c === 'end' || c === 'exit') return { mode: { cfg: false }, out: '' };
      if ((m = /^hostname (\S+)/.exec(c))) state.hostname = m[1];
      else if ((m = /^interface (\S+)/.exec(c))) { const i = state.ifaces.find((x) => x.name === m[1]); if (!i) return { out: '% Invalid input detected at \'^\' marker.' }; return { mode: { cfg: true, iface: i }, out: '' }; }
      else if ((m = /^vlan (\d+)/.exec(c))) { if (!state.vlans.has(+m[1])) state.vlans.set(+m[1], `VLAN${String(m[1]).padStart(4, '0')}`); return { mode: { cfg: true, vlan: +m[1] }, out: '' }; }
      else if ((m = /^no vlan (\d+)/.exec(c))) state.vlans.delete(+m[1]);
      else if ((m = /^name (\S+)/.exec(c)) && mode.vlan) state.vlans.set(mode.vlan, m[1]);
      else if ((m = /^ip route (.+)/.exec(c))) state.routes.push(m[1]);
      else if ((m = /^no ip route (.+)/.exec(c))) state.routes = state.routes.filter((r) => !r.startsWith(m[1]));
      else if (mode.iface && (m = /^description (.*)/.exec(c))) mode.iface.description = m[1];
      else if (mode.iface && c === 'no description') mode.iface.description = '';
      else if (mode.iface && c === 'shutdown') mode.iface.shutdown = true;
      else if (mode.iface && c === 'no shutdown') mode.iface.shutdown = false;
      else if (mode.iface && (m = /^switchport mode (access|trunk)/.exec(c))) mode.iface.mode = m[1];
      else if (mode.iface && (m = /^switchport access vlan (\d+)/.exec(c))) mode.iface.vlan = +m[1];
      else return { out: `% Invalid input detected at '^' marker.` };
      return { out: '' };
    }
    if (c === 'configure terminal') return { mode: { cfg: true }, out: 'Enter configuration commands, one per line.  End with CNTL/Z.' };
    if (c.startsWith('terminal ')) return { out: '' };
    if (c === 'show running-config') return { out: running() };
    if (c.startsWith('show running-config | include ')) { const re = new RegExp(c.split('include ')[1]); return { out: running().split('\n').filter((l) => re.test(l)).join('\n') }; }
    if (c === 'show version') return { out: `Cisco IOS Software, C2960 Software, Version 15.2(7)E3\n${state.hostname} uptime is 2 weeks, 3 days\ncisco WS-C2960-24TT-L (PowerPC405) processor\nProcessor board ID FOC1234X0AB\nModel number : WS-C2960-24TT-L` };
    if (c === 'show ip interface brief') return { out: 'Interface              IP-Address      OK? Method Status                Protocol\n' + state.ifaces.map((i) => `${short(i.name).padEnd(22)} unassigned      YES unset  ${i.shutdown ? 'administratively down' : i.up ? 'up' : 'down'}   ${i.up && !i.shutdown ? 'up' : 'down'}`).join('\n') };
    if (c === 'show vlan brief') return { out: 'VLAN Name                             Status    Ports\n---- -------------------------------- --------- -------------------------------\n' + [...state.vlans].map(([id, n]) => `${String(id).padEnd(4)} ${n.padEnd(32)} active    ${id === 1 ? 'Gi0/1, Gi0/2' : ''}`).join('\n') };
    if (c === 'show cdp neighbors detail') return { out: cdp() };
    if (c === 'show lldp neighbors detail') return { out: '' };
    if (c === 'write memory') { state.saved++; return { out: 'Building configuration...\n[OK]' }; }
    if (c === 'enable' || c === 'exit') return { out: '' };
    return { out: `% Invalid input detected at '^' marker.` };
  }

  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    client.on('authentication', (ctx) => (ctx.method === 'password' && ctx.username === user && ctx.password === pass ? ctx.accept() : ctx.reject(['password'])));
    client.on('ready', () => {
      client.on('session', (accept) => {
        const sess = accept();
        sess.on('pty', (a) => a());
        sess.on('shell', (a) => {
          const stream = a();
          let mode = { cfg: false };
          let line = '';
          const prompt = () => stream.write(`${state.hostname}${mode.cfg ? (mode.iface ? '(config-if)' : mode.vlan ? '(config-vlan)' : '(config)') : ''}#`);
          prompt();
          stream.on('data', (d) => {
            for (const ch of d.toString()) {
              if (ch === '\r' || ch === '\n') {
                stream.write('\r\n');
                const r = exec(line, mode);
                line = '';
                if (r.mode) mode = r.mode;
                if (r.out) stream.write(r.out.replace(/\n/g, '\r\n') + '\r\n');
                prompt();
              } else {
                line += ch;
                stream.write(ch); // écho
              }
            }
          });
        });
      });
    });
    client.on('error', () => {});
  });

  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve({ port: server.address().port, state, close: () => server.close() })));
}
