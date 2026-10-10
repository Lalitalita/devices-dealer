import { safe, safeInt, safeIp, parseNetwork, maskToPrefix } from '../util.js';

const ABBR = [
  [/^Ten-GigabitEthernet/, 'XGE'],
  [/^GigabitEthernet/, 'GE'],
  [/^FortyGigE/, 'FGE'],
  [/^Vlan-interface/, 'Vlan-int'],
  [/^Bridge-Aggregation/, 'BAGG'],
];
const short = (n) => ABBR.reduce((s, [re, r]) => s.replace(re, r), n);

export function parseInterfaces(cfg, brief) {
  const list = [];
  let cur = null;
  for (const line of cfg.split('\n')) {
    let m;
    if ((m = /^interface (\S+)/.exec(line))) {
      cur = { name: m[1], description: '', adminUp: true, linkUp: false, ip: '', mask: '', mode: null, accessVlan: '', trunkVlans: '' };
      list.push(cur);
    } else if (/^#/.test(line)) cur = null;
    else if (cur) {
      const l = line.trim();
      if ((m = /^description (.*)$/.exec(l))) cur.description = m[1];
      else if (l === 'shutdown') cur.adminUp = false;
      else if ((m = /^port link-type (access|trunk)/.exec(l))) cur.mode = m[1];
      else if ((m = /^port access vlan (\d+)/.exec(l))) cur.accessVlan = m[1];
      else if ((m = /^port trunk permit vlan (.*)$/.exec(l))) cur.trunkVlans = m[1].replace(/\s+/g, ',');
      else if ((m = /^ip address (\S+) (\S+)/.exec(l))) [cur.ip, cur.mask, cur.mode] = [m[1], m[2], 'routed'];
    }
  }
  for (const line of brief.split('\n')) {
    const m = /^(\S+)\s+(UP|DOWN|ADM|Stby)\s+/i.exec(line);
    if (!m) continue;
    const it = list.find((i) => short(i.name) === m[1]);
    if (it) {
      it.linkUp = m[2].toUpperCase() === 'UP';
      if (m[2].toUpperCase() === 'ADM') it.adminUp = false;
    }
  }
  return list;
}

export function parseNeighbors(out) {
  const res = [];
  for (const block of out.split(/^LLDP neighbor-information of port/m).slice(1)) {
    const local = /^\s*\d+\[(\S+)\]/.exec(block)?.[1] || /^\s*(\S+):/.exec(block)?.[1] || '';
    const get = (k) => new RegExp(`^\\s*${k}\\s*:\\s*(.*)$`, 'mi').exec(block)?.[1]?.trim() || '';
    res.push({
      protocol: 'lldp',
      localIf: local,
      remoteName: get('System name'),
      remoteIf: get('Port description') || get('Port ID'),
      remoteIp: /Management address\s*:\s*(\d+\.\d+\.\d+\.\d+)/i.exec(block)?.[1] || '',
      platform: get('System description'),
      capabilities: get('System capabilities supported'),
    });
  }
  return res;
}

export default {
  id: 'hp_comware',
  label: 'HPE Comware / H3C',
  prompt: /^[<[][\w.\-/@]+(-[\w\-/]+)?[>\]]\s*$/,
  enable: false,
  init: ['screen-length disable'],
  configEnter: ['system-view'],
  configExit: ['return'],
  save: 'save force',
  errorRe: /^\s*(% |Error:|Wrong parameter|Unrecognized command|Incomplete command|Too many parameters)/im,

  read: {
    async config(cli) {
      return cli.run('display current-configuration', { timeout: 60000 });
    },
    async system(cli) {
      const ver = await cli.run('display version');
      const cfg = await cli.run('display current-configuration | include sysname');
      return {
        hostname: /sysname (\S+)/.exec(cfg)?.[1] || '',
        model: /^(?:HPE?|H3C)\s+(\S+)/im.exec(ver)?.[1] || '',
        os: /Version ([^,\s]+)/.exec(ver)?.[1] || '',
        uptime: /uptime is (.*)/i.exec(ver)?.[1] || '',
        serial: '',
        raw: ver.split('\n').slice(0, 30).join('\n'),
      };
    },
    async interfaces(cli) {
      const cfg = await cli.run('display current-configuration interface', { timeout: 60000 });
      const brief = await cli.run('display interface brief');
      return parseInterfaces(cfg, brief);
    },
    async vlans(cli) {
      const out = await cli.run('display vlan brief');
      return out
        .split('\n')
        .map((l) => /^\s*(\d+)\s+(\S+)\s*(.*)$/.exec(l))
        .filter((m) => m && Number(m[1]) <= 4094 && !/^-/.test(m[2]))
        .map((m) => ({ id: Number(m[1]), name: m[2], status: 'active', ports: m[3] ? m[3].split(/\s+/) : [] }));
    },
    async routes(cli) {
      const cfg = await cli.run('display current-configuration | include ip route-static');
      return cfg
        .split('\n')
        .map((l) => /^ip route-static (\d+\.\d+\.\d+\.\d+) (\d+\.\d+\.\d+\.\d+|\d+) (\d+\.\d+\.\d+\.\d+)(?: preference (\d+))?/.exec(l.trim()))
        .filter(Boolean)
        .map((m) => {
          const mask = m[2].includes('.') ? m[2] : parseNetwork(`0.0.0.0/${m[2]}`).mask;
          return { network: m[1], mask, prefix: maskToPrefix(mask), nextHop: m[3], distance: m[4] ? Number(m[4]) : 60 };
        });
    },
    async routingTable(cli) {
      return cli.run('display ip routing-table');
    },
    async neighbors(cli) {
      return parseNeighbors(await cli.run('display lldp neighbor-information verbose'));
    },
  },

  write: {
    negate: (line) => (line.startsWith('undo ') ? line.slice(5) : `undo ${line}`),
    hostname: (name) => [`sysname ${safe(name, 'hostname')}`],
    interface(name, p) {
      const c = [`interface ${safe(name, 'interface')}`];
      if (p.description !== undefined) c.push(p.description ? `description ${safe(p.description, 'description')}` : 'undo description');
      if (p.adminUp !== undefined) c.push(p.adminUp ? 'undo shutdown' : 'shutdown');
      if (p.mode === 'access') {
        c.push('port link-type access');
        if (p.accessVlan) c.push(`port access vlan ${safeInt(p.accessVlan, 'VLAN', 1, 4094)}`);
      } else if (p.mode === 'trunk') {
        c.push('port link-type trunk');
        if (p.trunkVlans) c.push(`port trunk permit vlan ${safe(p.trunkVlans, 'VLANs').replace(/[^0-9, \-]/g, '').replace(/,/g, ' ').replace(/-/g, ' to ')}`);
      } else if (p.mode === 'routed' && p.ip) c.push(`ip address ${safeIp(p.ip)} ${safeIp(p.mask, 'masque')}`);
      return c;
    },
    vlanCreate: (id, name) => [`vlan ${safeInt(id, 'VLAN', 1, 4094)}`, ...(name ? [`name ${safe(name, 'nom').replace(/\s+/g, '_')}`] : []), 'quit'],
    vlanDelete: (id) => [`undo vlan ${safeInt(id, 'VLAN', 1, 4094)}`],
    routeAdd(r) {
      const { net, mask } = parseNetwork(r.network);
      return [`ip route-static ${net} ${mask} ${safeIp(r.nextHop, 'next-hop')}${r.distance > 1 ? ' preference ' + safeInt(r.distance, 'distance', 1, 255) : ''}`];
    },
    routeDelete(r) {
      const { net, mask } = parseNetwork(r.network);
      return [`undo ip route-static ${net} ${mask} ${safeIp(r.nextHop, 'next-hop')}`];
    },
  },
};
