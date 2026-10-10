// Comparaison et réinjection de configurations (syntaxe « blocs indentés » : Cisco, HP, Comware).

const NOISE = [
  /^Building configuration/i,
  /^Current configuration\s*:/i,
  /^!\s*(Last configuration change|NVRAM config last updated|No configuration change since)/i,
  /^ntp clock-period/i,
  /^;.*(Running configuration|Created on|Last configuration|Saved)/i,
  /^!Time:/i,
  /^Using \d+ out of/i,
];

export function normalize(text, { ignoreNoise = true } = {}) {
  return String(text)
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l && !/^\s*[!#]\s*$/.test(l) && !(ignoreNoise && NOISE.some((re) => re.test(l))));
}

/** Diff ligne à ligne → [{ t: ' ' | '+' | '-', s }] (a = ancien, b = nouveau). */
export function diffLines(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb);
  const out = a.slice(0, s).map((x) => ({ t: ' ', s: x }));
  const n = A.length, m = B.length;
  if (n * m > 9_000_000) {
    out.push(...A.map((x) => ({ t: '-', s: x })), ...B.map((x) => ({ t: '+', s: x })));
  } else {
    const w = m + 1;
    const L = new Int32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ t: ' ', s: A[i] }); i++; j++; }
      else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) out.push({ t: '-', s: A[i++] });
      else out.push({ t: '+', s: B[j++] });
    }
    while (i < n) out.push({ t: '-', s: A[i++] });
    while (j < m) out.push({ t: '+', s: B[j++] });
  }
  out.push(...a.slice(ea).map((x) => ({ t: ' ', s: x })));
  return out;
}

export const diffStats = (d) => ({ added: d.filter((x) => x.t === '+').length, removed: d.filter((x) => x.t === '-').length });

/** Découpe en blocs { header, children[] } (les bannières multi-lignes sont ignorées). */
export function parseBlocks(text) {
  const blocks = [];
  let cur = null;
  let banner = null;
  for (const line of normalize(text)) {
    if (banner) {
      if (line.includes(banner)) banner = null;
      continue;
    }
    const b = /^banner\s+\S+\s+(\^C|\S)(.*)$/.exec(line);
    if (b) {
      if (!b[2].includes(b[1])) banner = b[1];
      continue;
    }
    if (/^(end|exit|return|quit)$/i.test(line.trim())) continue;
    if (/^\s/.test(line)) cur?.children.push(line);
    else {
      cur = { header: line.trim(), children: [] };
      blocks.push(cur);
    }
  }
  return blocks;
}

const PROTECTED = /^(version|hostname|sysname|enable|username|line |boot|service|license|control-plane|ip ssh|crypto|ip domain|aaa|password|banner|transport|login|access-class|logging synchronous|exec-timeout|local-user|ssh |user-interface|telnet)/i;

const removableHeader = (h) => {
  if (PROTECTED.test(h) || /^no /.test(h)) return false;
  if (/^interface /i.test(h)) return /\.\d+$|loopback|vlan|tunnel/i.test(h); // on ne « supprime » pas un port physique
  return true;
};

/**
 * Commandes à envoyer pour amener `live` vers `backup` (mode fusion).
 * Les suppressions (`no …`) passent en premier, puis les ajouts.
 */
export function restorePlan(backupText, liveText, { removeExtra = false, negate }) {
  const bk = parseBlocks(backupText);
  const lv = parseBlocks(liveText);
  const key = (l) => l.trim();
  const index = (blocks) => {
    const m = new Map();
    for (const b of blocks) {
      const e = m.get(b.header) || { header: b.header, children: [] };
      e.children.push(...b.children);
      m.set(b.header, e);
    }
    return m;
  };
  const B = index(bk), L = index(lv);
  const removals = [], additions = [];

  if (removeExtra && negate) {
    for (const [h, l] of L) {
      const b = B.get(h);
      if (!b) {
        if (removableHeader(h)) removals.push(negate(h));
        continue;
      }
      const have = new Set(b.children.map(key));
      const extra = l.children.filter((c) => !have.has(key(c)) && !PROTECTED.test(key(c)) && !/^no /.test(key(c)));
      if (extra.length) removals.push(h, ...extra.map((c) => negate(key(c))));
    }
  }
  for (const [h, b] of B) {
    const l = L.get(h);
    if (!l) { additions.push(h, ...b.children.map(key)); continue; }
    const have = new Set(l.children.map(key));
    const missing = b.children.filter((c) => !have.has(key(c)));
    if (missing.length) additions.push(h, ...missing.map(key));
  }
  return { commands: [...removals, ...additions], removals: removals.length, additions: additions.length };
}
