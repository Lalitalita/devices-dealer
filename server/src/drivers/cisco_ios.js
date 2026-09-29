import { safe, safeInt, safeIp, parseNetwork, maskToPrefix } from '../util.js';


export function parseInterfaces(cfg, brief) {
  const map = new Map();
  let cur = null;
  for (const line of cfg.split('\n')) {
    const m = /^interface (\S.*)$/.exec(line);
    if (m) {
      cur = { name: m[1].trim(), description: '', adminUp: true, linkUp: false, ip: '', mask: '', mode: null, accessVlan: '', trunkVlans: '' };
      map.set(cur.name, cur);
      continue;
    }
    if (!cur) continue;
    if (!/^\s/.test(line)) {
      cur = null;
      continue;
    }
    const l = line.trim();
    let x;
    if ((x = /^description (.*)$/.exec(l))) cur.description = x[1];
    else if (l === 'shutdown') cur.adminUp = false;
    else if ((x = /^ip address (\S+) (\S+)/.exec(l))) [cur.ip, cur.mask] = [x[1], x[2]];
    else if ((x = /^switchport mode (access|trunk)/.exec(l))) cur.mode = x[1];
    else if ((x = /^switchport access vlan (\d+)/.exec(l))) cur.accessVlan = x[1];
    else if ((x = /^switchport trunk allowed vlan (?:add )?(.*)$/.exec(l))) cur.trunkVlans = x[1];
    else if (l === 'no switchport') cur.mode = 'routed';
  }
  for (const it of map.values()) if (!it.mode && it.ip) it.mode = 'routed';
  // état réel : show ip interface brief
  for (const line of brief.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\S+\s+\S+\s+(administratively down|up|down|deleted)\s+(up|down)/i.exec(line);
    if (!m) continue;
    const it = [...map.values()].find((i) => i.name === m[1] || i.name.replace(/^(\w{2})\w*?(\d)/, '$1$2') === m[1]);
    if (it) {
      it.linkUp = m[4].toLowerCase() === 'up';
      if (m[3].toLowerCase() === 'administratively down') it.adminUp = false;
    }
  }
  return [...map.values()];
}

export function parseVlans(out) {
  const vlans = [];
  for (const line of out.split('\n')) {
    let m;
    if ((m = /^(\d+)\s+(\S+)\s+(active|act\/\S+|sus\S*)\s*(.*)$/.exec(line))) {
      vlans.push({ id: Number(m[1]), name: m[2], status: m[3], ports: m[4] ? m[4].split(/,\s*/).filter(Boolean) : [] });
    } else if (vlans.length && /^\s{20,}\S/.test(line)) {
      vlans.at(-1).ports.push(...line.trim().split(/,\s*/).filter(Boolean));
    }
  }
  return vlans;
}

export function parseRoutes(cfg) {
  return cfg
    .split('\n')
    .map((l) => /^ip route (\d+\.\d+\.\d+\.\d+) (\d+\.\d+\.\d+\.\d+) (\S+)(?: (\d+))?/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => ({ network: m[1], mask: m[2], prefix: maskToPrefix(m[2]), nextHop: m[3], distance: m[4] ? Number(m[4]) : 1 }));
}

export function parseNeighbors(cdp, lldp) {
  const res = [];
  for (const block of cdp.split(/^-{5,}\s*$/m)) {
    const id = /Device ID:\s*(\S+)/.exec(block);
    const intf = /Interface:\s*([^,\n]+),\s*Port ID \(outgoing port\):\s*(\S+)/.exec(block);
    if (!id || !intf) continue;
    const plat = /Platform:\s*([^,\n]+)(?:,\s*Capabilities:\s*(.*))?/.exec(block);
    res.push({
      protocol: 'cdp',
      localIf: intf[1].trim(),
      remoteName: id[1],
      remoteIf: intf[2],
      remoteIp: /IP(?:v4)? [Aa]ddress:\s*(\d+\.\d+\.\d+\.\d+)/.exec(block)?.[1] || '',
      platform: plat?.[1].trim() || '',
      capabilities: plat?.[2]?.trim() || '',
    });
  }
  for (const block of lldp.split(/^-{5,}\s*$/m)) {
    const local = /Local Intf:\s*(\S+)/.exec(block);
    if (!local) continue;
    const name = /System Name:\s*(\S+)/.exec(block)?.[1] || /Chassis id:\s*(\S+)/.exec(block)?.[1] || '';
    const pid = /Port id:\s*(\S+)/.exec(block)?.[1] || '';
    const pdesc = /Port Description:\s*(.+)/.exec(block)?.[1]?.trim();
    res.push({
      protocol: 'lldp',
      localIf: local[1],
      remoteName: name,
      remoteIf: pdesc && pdesc !== 'not advertised' ? pdesc : pid,
      remoteIp: /(?:Management Addresses|IP):\s*\n?\s*(?:IP:\s*)?(\d+\.\d+\.\d+\.\d+)/.exec(block)?.[1] || '',
      platform: /System Description:\s*\n?([^\n]+)/.exec(block)?.[1]?.trim() || '',
      capabilities: /System Capabilities:\s*(.+)/.exec(block)?.[1]?.trim() || '',
    });
  }
  return res;
}

export default {
  id: 'cisco_ios',
  label: 'Cisco IOS / IOS-XE',
  prompt: /^[\w.\-/@:]+(\([\w\-/. ]+\))?[>#]\s*$/,
  enable: true,
  init: ['terminal length 0', 'terminal width 0'],
  configEnter: ['configure terminal'],
  configExit: ['end'],
  save: 'write memory',
  errorRe: /^% (Invalid|Incomplete|Ambiguous|Unknown)|^% .*not supported/im,

  read: {
    async config(cli) {
      return cli.run('show running-config', { timeout: 60000 });
    },
    async system(cli) {
      const ver = await cli.run('show version');
      const cfg = await cli.run('show running-config | include ^hostname');
      return {
        hostname: /^hostname (\S+)/m.exec(cfg)?.[1] || '',
        model: /[Mm]odel [Nn]umber\s*:\s*(\S+)/.exec(ver)?.[1] || /^cisco (\S+)/im.exec(ver)?.[1] || '',
        os: /Version ([^,\s]+)/.exec(ver)?.[1] || '',
        uptime: /uptime is (.*)/.exec(ver)?.[1] || '',
        serial: /[Pp]rocessor board ID (\S+)/.exec(ver)?.[1] || '',
        raw: ver.split('\n').slice(0, 30).join('\n'),
      };
    },
    async interfaces(cli) {
      const cfg = await cli.run('show running-config', { timeout: 60000 });
      const brief = await cli.run('show ip interface brief');
      return parseInterfaces(cfg, brief);
    },
    async vlans(cli) {
      return parseVlans(await cli.run('show vlan brief'));
    },
    async routes(cli) {
      const cfg = await cli.run('show running-config | include ^ip route');
      return parseRoutes(cfg);
    },
    async routingTable(cli) {
      return cli.run('show ip route');
    },
    async neighbors(cli) {
      const cdp = await cli.run('show cdp neighbors detail').catch(() => '');
      const lldp = await cli.run('show lldp neighbors detail').catch(() => '');
      return parseNeighbors(cdp, lldp);
    },
  },

  write: {
    hostname: (name) => [`hostname ${safe(name, 'hostname')}`],
    interface(name, p) {
      const c = [`interface ${safe(name, 'interface')}`];
      if (p.description !== undefined) c.push(p.description ? `description ${safe(p.description, 'description')}` : 'no description');
      if (p.adminUp !== undefined) c.push(p.adminUp ? 'no shutdown' : 'shutdown');
      if (p.mode === 'access') {
        c.push('switchport mode access');
        if (p.accessVlan) c.push(`switchport access vlan ${safeInt(p.accessVlan, 'VLAN', 1, 4094)}`);
      } else if (p.mode === 'trunk') {
        c.push('switchport mode trunk');
        if (p.trunkVlans) c.push(`switchport trunk allowed vlan ${safe(p.trunkVlans, 'VLANs').replace(/[^0-9,\-a-z ]/gi, '')}`);
      } else if (p.mode === 'routed' && p.ip) {
        c.push('no switchport', `ip address ${safeIp(p.ip)} ${safeIp(p.mask, 'masque')}`);
      }
      return c;
    },
    vlanCreate: (id, name) => [`vlan ${safeInt(id, 'VLAN', 1, 4094)}`, ...(name ? [`name ${safe(name, 'nom').replace(/\s+/g, '_')}`] : [])],
    vlanDelete: (id) => [`no vlan ${safeInt(id, 'VLAN', 1, 4094)}`],
    routeAdd(r) {
      const { net, mask } = parseNetwork(r.network);
      return [`ip route ${net} ${mask} ${safeIp(r.nextHop, 'next-hop')}${r.distance > 1 ? ' ' + safeInt(r.distance, 'distance', 1, 255) : ''}`];
    },
    routeDelete(r) {
      const { net, mask } = parseNetwork(r.network);
      return [`no ip route ${net} ${mask} ${safeIp(r.nextHop, 'next-hop')}`];
    },
  },
};
