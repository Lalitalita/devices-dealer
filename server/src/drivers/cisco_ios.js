import { safe, safeInt, safeIp, parseNetwork, maskToPrefix, networkOf, HttpError } from '../util.js';


export function parseInterfaces(cfg, brief) {
  const map = new Map();
  let cur = null;
  for (const line of cfg.split('\n')) {
    const m = /^interface (\S.*)$/.exec(line);
    if (m) {
      cur = { name: m[1].trim(), description: '', adminUp: true, linkUp: false, ip: '', mask: '', mode: null, accessVlan: '', trunkVlans: '', nat: '' };
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
    else if (l === 'ip address dhcp') [cur.ip, cur.mask] = ['dhcp', ''];
    else if ((x = /^ip address (\d\S+) (\S+)/.exec(l))) [cur.ip, cur.mask] = [x[1], x[2]];
    else if ((x = /^switchport mode (access|trunk)/.exec(l))) cur.mode = x[1];
    else if ((x = /^switchport access vlan (\d+)/.exec(l))) cur.accessVlan = x[1];
    else if ((x = /^switchport trunk allowed vlan (?:add )?(.*)$/.exec(l))) cur.trunkVlans = x[1];
    else if (l === 'no switchport') cur.mode = 'routed';
    else if ((x = /^encapsulation dot1q (\d+)/i.exec(l))) cur.accessVlan = x[1];
    else if ((x = /^ip nat (inside|outside)$/.exec(l))) cur.nat = x[1];
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

/** VLANs « déduits » des sous-interfaces dot1Q d'un routeur (router-on-a-stick). */
export function vlansFromSubinterfaces(ifaces) {
  const m = new Map();
  for (const i of ifaces) {
    if (!/\.\d+$/.test(i.name) || !i.accessVlan) continue;
    const id = Number(i.accessVlan);
    const v = m.get(id) || { id, name: '', status: 'sous-interface', ports: [], source: 'subinterface', subs: [] };
    v.ports.push(i.name);
    v.subs.push(i.name);
    v.name ||= i.description || '';
    if (i.ip) v.ip = `${i.ip} ${i.mask}`;
    m.set(id, v);
  }
  return [...m.values()];
}

export function parseNat(cfg, ifaces) {
  const rules = [], pools = [], acls = {};
  const lines = cfg.split('\n');
  let named = null;
  for (const raw of lines) {
    const l = raw.trim();
    let m;
    if ((m = /^ip nat inside source list (\S+) (?:interface (\S+)|pool (\S+))( overload)?/.exec(l)))
      rules.push({ kind: 'dynamic', acl: m[1], interface: m[2] || '', pool: m[3] || '', overload: !!m[4], raw: l });
    else if ((m = /^ip nat inside source static (?:(tcp|udp) )?(\d+\.\d+\.\d+\.\d+)(?: (\d+))? (?:interface (\S+)|(\d+\.\d+\.\d+\.\d+))(?: (\d+))?/.exec(l)))
      rules.push({ kind: 'static', proto: m[1] || '', inside: m[2], insidePort: m[3] || '', outside: m[4] ? `interface ${m[4]}` : m[5], outsidePort: m[6] || '', raw: l });
    else if ((m = /^ip nat pool (\S+) (\S+) (\S+) netmask (\S+)/.exec(l))) pools.push({ name: m[1], start: m[2], end: m[3], mask: m[4] });
    else if ((m = /^access-list (\d+) (permit|deny) (.*)$/.exec(l))) (acls[m[1]] ||= []).push(`${m[2]} ${m[3]}`);
    else if ((m = /^ip access-list (?:standard|extended) (\S+)/.exec(raw))) { named = m[1]; acls[named] ||= []; }
    else if (named && /^\s/.test(raw)) acls[named].push(l);
    else if (!/^\s/.test(raw)) named = null;
  }
  return {
    interfaces: ifaces.filter((i) => i.ip || i.nat).map((i) => ({ name: i.name, ip: i.ip, mask: i.mask, role: i.nat || '' })),
    rules, pools, acls,
  };
}

export function parseDhcp(cfg) {
  const pools = [], excluded = [];
  let cur = null;
  for (const raw of cfg.split('\n')) {
    const l = raw.trim();
    let m;
    if ((m = /^ip dhcp pool (\S+)/.exec(l))) { cur = { name: m[1], network: '', mask: '', router: '', dns: [], domain: '', lease: '' }; pools.push(cur); continue; }
    if ((m = /^ip dhcp excluded-address (\S+)(?: (\S+))?/.exec(l))) { excluded.push({ from: m[1], to: m[2] || m[1] }); cur = null; continue; }
    if (cur && /^\s/.test(raw)) {
      if ((m = /^network (\S+) (\S+)/.exec(l))) [cur.network, cur.mask] = [m[1], m[2]];
      else if ((m = /^default-router (\S+)/.exec(l))) cur.router = m[1];
      else if ((m = /^dns-server (.+)$/.exec(l))) cur.dns = m[1].trim().split(/\s+/);
      else if ((m = /^domain-name (\S+)/.exec(l))) cur.domain = m[1];
      else if ((m = /^lease (.+)$/.exec(l))) cur.lease = m[1];
    } else if (!/^\s/.test(raw)) cur = null;
  }
  return { pools, excluded };
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
  prompt: /[\w.\-/@:]+(\([\w\-/. ]+\))?[>#]\s*$/,
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
      let out = await cli.run('show vlan brief');
      if (/^% /m.test(out)) out = await cli.run('show vlan-switch brief'); // routeur avec module switch
      const vlans = /^% /m.test(out) ? [] : parseVlans(out);
      // routeur : les VLANs vivent dans les sous-interfaces dot1Q
      const cfg = await cli.run('show running-config', { timeout: 60000 });
      for (const sv of vlansFromSubinterfaces(parseInterfaces(cfg, ''))) {
        const ex = vlans.find((v) => v.id === sv.id);
        if (ex) { ex.ports.push(...sv.ports); ex.subs = sv.subs; ex.ip = sv.ip; } else vlans.push(sv);
      }
      return vlans.sort((a, b) => a.id - b.id);
    },
    async nat(cli) {
      const cfg = await cli.run('show running-config', { timeout: 60000 });
      return parseNat(cfg, parseInterfaces(cfg, ''));
    },
    async natTranslations(cli) {
      return cli.run('show ip nat translations');
    },
    async dhcp(cli) {
      return parseDhcp(await cli.run('show running-config', { timeout: 60000 }));
    },
    async dhcpBindings(cli) {
      return cli.run('show ip dhcp binding');
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
        if (!p.router) c.push('no switchport'); // une interface de routeur n'a pas de switchport
        c.push(p.ip === 'dhcp' ? 'ip address dhcp' : `ip address ${safeIp(p.ip)} ${safeIp(p.mask, 'masque')}`);
      }
      return c;
    },
    negate: (line) => (line.startsWith('no ') ? line.slice(3) : `no ${line}`),
    subinterface(p) {
      const id = safeInt(p.vlan, 'VLAN', 1, 4094);
      const c = [`interface ${safe(p.parent, 'interface parente')}.${id}`, `encapsulation dot1Q ${id}`];
      if (p.description) c.push(`description ${safe(p.description, 'description')}`);
      if (p.ip) c.push(`ip address ${safeIp(p.ip)} ${safeIp(p.mask, 'masque')}`);
      return c;
    },
    subinterfaceDelete(name) {
      if (!/\.\d+$/.test(safe(name, 'interface'))) throw new HttpError(400, 'Seules les sous-interfaces peuvent être supprimées');
      return [`no interface ${name}`];
    },
    natInterface(name, role) {
      const c = [`interface ${safe(name, 'interface')}`];
      if (role === 'inside') c.push('no ip nat outside', 'ip nat inside');
      else if (role === 'outside') c.push('no ip nat inside', 'ip nat outside');
      else c.push('no ip nat inside', 'no ip nat outside');
      return c;
    },
    /** Partage de connexion (PAT) : outside = interface WAN, inside = [{ name, ip, mask }] */
    natPat({ outside, inside, acl }) {
      const n = safeInt(acl, 'ACL', 1, 99);
      if (!inside?.length) throw new HttpError(400, 'Choisissez au moins une interface interne');
      const c = [`no access-list ${n}`];
      for (const i of inside) {
        const { net, wildcard } = networkOf(safeIp(i.ip), safeIp(i.mask, 'masque'));
        c.push(`access-list ${n} permit ${net} ${wildcard}`);
      }
      c.push(`interface ${safe(outside, 'interface externe')}`, 'no ip nat inside', 'ip nat outside');
      for (const i of inside) c.push(`interface ${safe(i.name, 'interface')}`, 'no ip nat outside', 'ip nat inside');
      c.push(`ip nat inside source list ${n} interface ${outside} overload`);
      return c;
    },
    natStatic(r) {
      const proto = r.proto === 'tcp' || r.proto === 'udp' ? r.proto + ' ' : '';
      const ip = safeIp(r.inside, 'IP interne');
      const ip_port = proto ? ` ${safeInt(r.insidePort, 'port interne', 1, 65535)}` : '';
      const out = r.outside.startsWith('interface ') ? `interface ${safe(r.outside.slice(10), 'interface')}` : safeIp(r.outside, 'IP externe');
      const out_port = proto ? ` ${safeInt(r.outsidePort || r.insidePort, 'port externe', 1, 65535)}` : '';
      return [`ip nat inside source static ${proto}${ip}${ip_port} ${out}${out_port}`];
    },
    natRuleDelete(raw) {
      const l = safe(raw, 'règle');
      if (!/^ip nat (inside|outside) source /.test(l)) throw new HttpError(400, 'Règle NAT invalide');
      return [`no ${l}`];
    },
    dhcpPoolSet(p) {
      const c = [`ip dhcp pool ${safe(p.name, 'nom').replace(/\s+/g, '_')}`, `network ${safeIp(p.network, 'réseau')} ${safeIp(p.mask, 'masque')}`];
      if (p.router) c.push(`default-router ${safeIp(p.router, 'passerelle')}`);
      const dns = String(p.dns || '').split(/[\s,]+/).filter(Boolean).map((d) => safeIp(d, 'DNS'));
      if (dns.length) c.push(`dns-server ${dns.join(' ')}`);
      if (p.domain) c.push(`domain-name ${safe(p.domain, 'domaine')}`);
      return c;
    },
    dhcpPoolDelete: (name) => [`no ip dhcp pool ${safe(name, 'nom')}`],
    dhcpExcludeAdd: (r) => [`ip dhcp excluded-address ${safeIp(r.from, 'début')}${r.to && r.to !== r.from ? ' ' + safeIp(r.to, 'fin') : ''}`],
    dhcpExcludeDelete: (r) => [`no ip dhcp excluded-address ${safeIp(r.from, 'début')}${r.to && r.to !== r.from ? ' ' + safeIp(r.to, 'fin') : ''}`],
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
