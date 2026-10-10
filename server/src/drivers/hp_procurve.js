import { safe, safeInt, safeIp, parseNetwork, maskToPrefix } from '../util.js';

/** "1-3,5,A1-A2" → ["1","2","3","5","A1","A2"] */
export function expandPorts(spec) {
  const out = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^([A-Za-z]*)(\d+)-([A-Za-z]*)(\d+)$/.exec(part);
    if (m) for (let i = Number(m[2]); i <= Number(m[4]); i++) out.push(m[1] + i);
    else out.push(part);
  }
  return out;
}

export function parseConfig(cfg) {
  const ifaces = new Map();
  const vlans = new Map();
  let blk = null;
  for (const line of cfg.split('\n')) {
    let m;
    if ((m = /^interface (\S+)/.exec(line))) {
      blk = { kind: 'if', ref: ifaces.get(m[1]) || { name: m[1], description: '', adminUp: true } };
      ifaces.set(m[1], blk.ref);
    } else if ((m = /^vlan (\d+)/.exec(line))) {
      blk = { kind: 'vlan', ref: vlans.get(m[1]) || { id: Number(m[1]), name: '', tagged: [], untagged: [], ip: '', mask: '' } };
      vlans.set(m[1], blk.ref);
    } else if (!/^\s/.test(line)) blk = null;
    else if (blk) {
      const l = line.trim();
      if (blk.kind === 'if') {
        if ((m = /^name "?(.*?)"?$/.exec(l))) blk.ref.description = m[1];
        else if (l === 'disable') blk.ref.adminUp = false;
      } else {
        if ((m = /^name "?(.*?)"?$/.exec(l))) blk.ref.name = m[1];
        else if ((m = /^untagged (.+)$/.exec(l))) blk.ref.untagged.push(...expandPorts(m[1]));
        else if ((m = /^tagged (.+)$/.exec(l))) blk.ref.tagged.push(...expandPorts(m[1]));
        else if ((m = /^ip address (\S+) (\S+)/.exec(l))) [blk.ref.ip, blk.ref.mask] = [m[1], m[2]];
      }
    }
  }
  return { ifaces: [...ifaces.values()], vlans: [...vlans.values()] };
}

/** Liste des VLANs avec leurs ports : `show vlans` puis `show vlans <id>` pour chaque VLAN. */
export async function membership(cli) {
  const list = await cli.run('show vlans');
  const res = [];
  for (const line of list.split('\n')) {
    const m = /^\s*(\d+)\s+(.+?)\s+\|\s+(\S+)/.exec(line);
    if (m) res.push({ id: Number(m[1]), name: m[2].trim(), status: m[3], tagged: [], untagged: [] });
  }
  for (const v of res) {
    const d = await cli.run(`show vlans ${v.id}`);
    for (const line of d.split('\n')) {
      const m = /^\s*(\S+)\s+(Untagged|Tagged)\b/i.exec(line);
      if (m) (m[2].toLowerCase() === 'tagged' ? v.tagged : v.untagged).push(m[1]);
    }
  }
  return res;
}

export function parseBrief(out) {
  const rows = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\S+)\s+.*?\|.*?\b(Yes|No)\s+(Up|Down)\b/i.exec(line);
    if (m) rows.push({ name: m[1], enabled: /yes/i.test(m[2]), up: /up/i.test(m[3]) });
  }
  return rows;
}

export function parseNeighborDetail(out) {
  const get = (k) => new RegExp(`^\\s*${k}\\s*:\\s*(.*)$`, 'mi').exec(out)?.[1]?.trim() || '';
  return {
    protocol: 'lldp',
    localIf: get('Local Port'),
    remoteName: get('SysName'),
    remoteIf: get('PortDescr') || get('PortId'),
    remoteIp: /Address\s*:\s*(\d+\.\d+\.\d+\.\d+)/i.exec(out)?.[1] || '',
    platform: get('System Descr'),
    capabilities: get('System Capabilities Supported'),
  };
}

export default {
  id: 'hp_procurve',
  label: 'HP ProCurve / Aruba OS-Switch',
  prompt: /[\w.\-/@:]+(\([\w\-/. ]+\))?[>#]\s*$/,
  enable: true,
  init: ['no page'],
  configEnter: ['configure'],
  configExit: ['end'],
  save: 'write memory',
  errorRe: /^(Invalid input|Incomplete input|Ambiguous input|Unknown|Cannot|Error)/im,

  read: {
    async config(cli) {
      return cli.run('show running-config', { timeout: 60000 });
    },
    async system(cli) {
      const cfg = await cli.run('show running-config');
      const ver = await cli.run('show system');
      return {
        hostname: /^hostname "?([^"\n]+)"?/m.exec(cfg)?.[1] || '',
        model: /Product Name\s*:\s*(.+)/i.exec(ver)?.[1]?.trim() || '',
        os: /Software revision\s*:\s*(\S+)/i.exec(ver)?.[1] || /Firmware revision\s*:\s*(\S+)/i.exec(ver)?.[1] || '',
        uptime: /Up Time\s*:\s*(.+)/i.exec(ver)?.[1]?.trim() || '',
        serial: /Serial Number\s*:\s*(\S+)/i.exec(ver)?.[1] || '',
        raw: ver,
      };
    },
    async interfaces(cli) {
      const brief = parseBrief(await cli.run('show interfaces brief'));
      const cfg = await cli.run('show running-config', { timeout: 60000 });
      const conf = parseConfig(cfg);
      let vlans = await membership(cli);
      if (!vlans.some((v) => v.tagged.length || v.untagged.length)) vlans = conf.vlans; // repli : running-config
      const byName = new Map(conf.ifaces.map((i) => [i.name, i]));
      return brief.map((b) => {
        const c = byName.get(b.name) || { description: '' };
        const untagged = vlans.find((v) => v.untagged.includes(b.name));
        const tagged = vlans.filter((v) => v.tagged.includes(b.name)).map((v) => v.id);
        return {
          name: b.name, description: c.description, adminUp: b.enabled && c.adminUp !== false, linkUp: b.up,
          ip: '', mask: '', mode: tagged.length ? 'trunk' : untagged ? 'access' : null,
          accessVlan: untagged ? String(untagged.id) : '', trunkVlans: tagged.join(','),
        };
      });
    },
    async vlans(cli) {
      let vlans = await membership(cli);
      if (!vlans.some((v) => v.tagged.length || v.untagged.length)) {
        const conf = parseConfig(await cli.run('show running-config'));
        for (const v of vlans) {
          const c = conf.vlans.find((x) => x.id === v.id);
          if (c) Object.assign(v, { tagged: c.tagged, untagged: c.untagged });
        }
      }
      return vlans.map((v) => ({ id: v.id, name: v.name, status: v.status, ports: [...v.untagged, ...v.tagged.map((p) => `${p}(T)`)] }));
    },
    async routes(cli) {
      const cfg = await cli.run('show running-config');
      return cfg
        .split('\n')
        .map((l) => /^ip route (\d+\.\d+\.\d+\.\d+)(?:\/(\d+)| (\d+\.\d+\.\d+\.\d+)) (\S+)(?: distance (\d+))?/.exec(l.trim()))
        .filter(Boolean)
        .map((m) => {
          const mask = m[3] || parseNetwork(`0.0.0.0/${m[2]}`).mask;
          return { network: m[1], mask, prefix: maskToPrefix(mask), nextHop: m[4], distance: m[5] ? Number(m[5]) : 1 };
        });
    },
    async routingTable(cli) {
      return cli.run('show ip route');
    },
    async neighbors(cli) {
      const list = await cli.run('show lldp info remote-device');
      const ports = [...list.matchAll(/^\s*(\S+)\s+\|\s+[0-9a-f]{2}/gim)].map((m) => m[1]);
      const res = [];
      for (const p of ports) {
        const d = await cli.run(`show lldp info remote-device ${safe(p)}`);
        const n = parseNeighborDetail(d);
        if (!n.localIf) n.localIf = p;
        res.push(n);
      }
      return res;
    },
  },

  write: {
    negate: (line) => (line.startsWith('no ') ? line.slice(3) : `no ${line}`),
    hostname: (name) => [`hostname "${safe(name, 'hostname').replace(/"/g, '')}"`],
    interface(name, p) {
      const n = safe(name, 'interface');
      const c = [`interface ${n}`];
      if (p.description !== undefined) c.push(p.description ? `name "${safe(p.description, 'description').replace(/"/g, '')}"` : 'no name');
      if (p.adminUp !== undefined) c.push(p.adminUp ? 'enable' : 'disable');
      c.push('exit');
      if (p.mode === 'access' && p.accessVlan) c.push(`vlan ${safeInt(p.accessVlan, 'VLAN', 1, 4094)}`, `untagged ${n}`, 'exit');
      if (p.mode === 'trunk' && p.trunkVlans) {
        for (const v of String(p.trunkVlans).split(',').map((s) => safeInt(s.trim(), 'VLAN', 1, 4094))) c.push(`vlan ${v}`, `tagged ${n}`, 'exit');
      }
      return c;
    },
    vlanCreate: (id, name) => [`vlan ${safeInt(id, 'VLAN', 1, 4094)}`, ...(name ? [`name "${safe(name, 'nom').replace(/"/g, '')}"`] : []), 'exit'],
    vlanDelete: (id) => [`no vlan ${safeInt(id, 'VLAN', 1, 4094)}`],
    routeAdd(r) {
      const { net, mask } = parseNetwork(r.network);
      return [`ip route ${net} ${mask} ${safeIp(r.nextHop, 'next-hop')}${r.distance > 1 ? ' distance ' + safeInt(r.distance, 'distance', 1, 255) : ''}`];
    },
    routeDelete(r) {
      const { net, mask } = parseNetwork(r.network);
      return [`no ip route ${net} ${mask} ${safeIp(r.nextHop, 'next-hop')}`];
    },
  },
};
