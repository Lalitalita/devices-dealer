import { useState } from 'react';
import { Plus, Trash2, Pencil, RefreshCw, Wand2 } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Modal, Field, Empty, PushResult } from '../ui.jsx';
import { DevicePage } from './Gate.jsx';
import { usePush } from './Config.jsx';

const Refresh = ({ r }) => <button onClick={r.reload} disabled={r.loading}><RefreshCw size={14} className={r.loading ? 'spin' : ''} /> Actualiser</button>;

function Raw({ endpoint, label }) {
  const { active } = useApp();
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setOut(await api.get(`/api/devices/${active.id}/${endpoint}`)); } catch (e) { setOut(e.message); }
    setBusy(false);
  };
  return (
    <div style={{ marginTop: 16 }}>
      <button onClick={load} disabled={busy}>{label}</button>
      {out != null && <pre className="term" style={{ marginTop: 10 }}>{out || '(vide)'}</pre>}
    </div>
  );
}

/* ================= NAT ================= */
export function NatPage() {
  return (
    <DevicePage title="NAT" subtitle="Partage de connexion Internet et redirections" endpoint="nat" supports="nat" actions={(r) => <Refresh r={r} />}>
      {(nat) => <NatBody nat={nat} />}
    </DevicePage>
  );
}

function NatBody({ nat }) {
  const { active } = useApp();
  const p = usePush();
  const post = (path, body, msg) => p.push(() => api.post(`/api/devices/${active.id}/nat/${path}`, body), msg);

  /* assistant PAT */
  const freeAcl = (() => { for (let n = 30; n < 100; n++) if (!nat.acls[n]) return n; return 99; })();
  const [outside, setOutside] = useState(nat.interfaces.find((i) => i.role === 'outside')?.name || nat.interfaces.find((i) => i.ip === 'dhcp')?.name || '');
  const [inside, setInside] = useState(() => new Set(nat.interfaces.filter((i) => i.role === 'inside').map((i) => i.name)));
  const [acl, setAcl] = useState(freeAcl);
  const lan = nat.interfaces.filter((i) => /^\d/.test(i.ip) && i.name !== outside);
  const toggle = (n) => setInside((s) => { const c = new Set(s); c.has(n) ? c.delete(n) : c.add(n); return c; });
  const aclUsed = !!nat.acls[acl];

  /* règle statique */
  const [st, setSt] = useState({ proto: 'tcp', inside: '', insidePort: '', outsideKind: 'interface', outsideIf: outside, outsideIp: '', outsidePort: '' });
  const addStatic = async () => {
    const body = { proto: st.proto === 'any' ? '' : st.proto, inside: st.inside, insidePort: st.insidePort, outsidePort: st.outsidePort, outside: st.outsideKind === 'interface' ? `interface ${st.outsideIf || outside}` : st.outsideIp };
    if (await post('static', body, 'Règle ajoutée')) setSt({ ...st, inside: '', insidePort: '', outsidePort: '' });
  };

  return (
    <>
      <div className="card pad" style={{ marginBottom: 14 }}>
        <h3 style={{ marginBottom: 4 }}><Wand2 size={15} style={{ verticalAlign: -2 }} /> Partage de connexion (PAT)</h3>
        <p className="muted small" style={{ marginBottom: 14 }}>Fait sortir vos réseaux internes sur Internet avec l’adresse de l’interface externe. C’est ce qui manque quand « le routeur ping mais pas les PC ».</p>
        <div className="row">
          <Field label="Interface externe (vers Internet)">
            <select value={outside} onChange={(e) => setOutside(e.target.value)}>
              <option value="">— choisir —</option>
              {nat.interfaces.map((i) => <option key={i.name} value={i.name}>{i.name} {i.ip ? `(${i.ip})` : ''}</option>)}
            </select>
          </Field>
          <Field label="N° d’ACL (réseaux autorisés)" hint={aclUsed ? '⚠ existe déjà : sera recréée (ne pas utiliser celle du SSH)' : 'libre'}>
            <input type="number" min="1" max="99" value={acl} onChange={(e) => setAcl(Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Réseaux internes à faire sortir" hint="Interfaces avec une IP fixe — les réseaux sont calculés automatiquement">
          {!lan.length ? <span className="muted">Aucune interface interne avec IP fixe.</span> : lan.map((i) => (
            <label key={i.name} className="check" style={{ margin: '4px 0' }}>
              <input type="checkbox" checked={inside.has(i.name)} onChange={() => toggle(i.name)} />
              <span className="mono">{i.name}</span> <span className="muted">{i.ip} {i.mask}</span>
            </label>
          ))}
        </Field>
        <button className="primary" disabled={p.busy || !outside || !inside.size} onClick={() => confirm('Appliquer le partage de connexion ?') && post('pat', { outside, inside: [...inside].filter((n) => n !== outside), acl }, 'PAT configuré')}>Appliquer</button>
      </div>

      <div className="split">
        <div className="card">
          <div className="card pad" style={{ border: 0, paddingBottom: 6 }}><b>Rôle des interfaces</b></div>
          {!nat.interfaces.length ? <Empty>Aucune interface IP.</Empty> : (
            <table><tbody>{nat.interfaces.map((i) => (
              <tr key={i.name}>
                <td className="mono">{i.name}<div className="muted small">{i.ip} {i.mask}</div></td>
                <td style={{ width: 140 }}>
                  <select value={i.role} disabled={p.busy} onChange={(e) => p.push(() => api.put(`/api/devices/${active.id}/nat/interface`, { name: i.name, role: e.target.value }), 'Rôle modifié')}>
                    <option value="">aucun</option><option value="inside">inside</option><option value="outside">outside</option>
                  </select>
                </td>
              </tr>
            ))}</tbody></table>
          )}
        </div>

        <div className="card">
          <div className="card pad" style={{ border: 0, paddingBottom: 6 }}><b>Règles NAT</b></div>
          {!nat.rules.length ? <Empty>Aucune règle.</Empty> : (
            <table><tbody>{nat.rules.map((r) => (
              <tr key={r.raw}>
                <td>
                  {r.kind === 'dynamic'
                    ? <><span className="tag accent">{r.overload ? 'PAT' : 'dynamique'}</span> ACL <b>{r.acl}</b> → <span className="mono">{r.interface || r.pool}</span>
                        {nat.acls[r.acl] && <div className="mono small muted">{nat.acls[r.acl].join(' · ')}</div>}</>
                    : <><span className="tag accent">{r.proto || 'statique'}</span> <span className="mono">{r.inside}{r.insidePort && `:${r.insidePort}`}</span> ⇄ <span className="mono">{r.outside}{r.outsidePort && `:${r.outsidePort}`}</span></>}
                </td>
                <td className="actions-cell"><button className="icon" disabled={p.busy} onClick={() => confirm('Supprimer cette règle ?') && post('delete', { raw: r.raw }, 'Règle supprimée')}><Trash2 size={15} /></button></td>
              </tr>
            ))}</tbody></table>
          )}
        </div>
      </div>

      <div className="card pad" style={{ marginTop: 14 }}>
        <h3 style={{ marginBottom: 12 }}>Redirection de port / NAT statique</h3>
        <div className="row">
          <Field label="Protocole"><select value={st.proto} onChange={(e) => setSt({ ...st, proto: e.target.value })}><option value="tcp">TCP</option><option value="udp">UDP</option><option value="any">Tous (1:1)</option></select></Field>
          <Field label="IP interne"><input value={st.inside} onChange={(e) => setSt({ ...st, inside: e.target.value })} placeholder="192.168.20.5" /></Field>
          {st.proto !== 'any' && <Field label="Port interne"><input type="number" value={st.insidePort} onChange={(e) => setSt({ ...st, insidePort: e.target.value })} /></Field>}
        </div>
        <div className="row">
          <Field label="Côté externe">
            <select value={st.outsideKind} onChange={(e) => setSt({ ...st, outsideKind: e.target.value })}><option value="interface">Adresse d’une interface</option><option value="ip">Adresse IP publique</option></select>
          </Field>
          {st.outsideKind === 'interface'
            ? <Field label="Interface"><select value={st.outsideIf || outside} onChange={(e) => setSt({ ...st, outsideIf: e.target.value })}>{nat.interfaces.map((i) => <option key={i.name}>{i.name}</option>)}</select></Field>
            : <Field label="IP externe"><input value={st.outsideIp} onChange={(e) => setSt({ ...st, outsideIp: e.target.value })} /></Field>}
          {st.proto !== 'any' && <Field label="Port externe" hint="vide = identique"><input type="number" value={st.outsidePort} onChange={(e) => setSt({ ...st, outsidePort: e.target.value })} /></Field>}
        </div>
        <button className="primary" disabled={p.busy || !st.inside || (st.proto !== 'any' && !st.insidePort)} onClick={addStatic}><Plus size={15} /> Ajouter</button>
      </div>

      <Raw endpoint="nat-translations" label="Voir les traductions en cours" />
      {p.result && <PushResult result={p.result} onClose={p.close} />}
    </>
  );
}

/* ================= DHCP ================= */
export function DhcpPage() {
  return (
    <DevicePage title="DHCP" subtitle="Serveur DHCP du routeur" endpoint="dhcp" supports="dhcp" actions={(r) => <Refresh r={r} />}>
      {(d) => <DhcpBody d={d} />}
    </DevicePage>
  );
}

function PoolModal({ pool, onClose, p }) {
  const { active } = useApp();
  const [f, setF] = useState(pool ? { ...pool, dns: pool.dns.join(' ') } : { name: '', network: '', mask: '255.255.255.0', router: '', dns: '8.8.8.8', domain: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => { if (await p.push(() => api.post(`/api/devices/${active.id}/dhcp/pools`, f), 'Pool enregistré')) onClose(); };
  return (
    <Modal title={pool ? `Pool ${pool.name}` : 'Nouveau pool DHCP'} onClose={onClose} footer={<><button onClick={onClose}>Annuler</button><button className="primary" disabled={p.busy || !f.name || !f.network} onClick={submit}>Appliquer</button></>}>
      <Field label="Nom"><input value={f.name} onChange={set('name')} disabled={!!pool} autoFocus /></Field>
      <div className="row">
        <Field label="Réseau"><input value={f.network} onChange={set('network')} placeholder="192.168.10.0" /></Field>
        <Field label="Masque"><input value={f.mask} onChange={set('mask')} /></Field>
      </div>
      <div className="row">
        <Field label="Passerelle"><input value={f.router} onChange={set('router')} placeholder="192.168.10.1" /></Field>
        <Field label="Serveurs DNS" hint="séparés par un espace"><input value={f.dns} onChange={set('dns')} /></Field>
      </div>
      <Field label="Domaine (optionnel)"><input value={f.domain} onChange={set('domain')} /></Field>
    </Modal>
  );
}

function DhcpBody({ d }) {
  const { active } = useApp();
  const p = usePush();
  const [edit, setEdit] = useState(undefined); // undefined = fermé, null = nouveau
  const [ex, setEx] = useState({ from: '', to: '' });
  const post = (path, body, msg) => p.push(() => api.post(`/api/devices/${active.id}/dhcp/${path}`, body), msg);
  return (
    <>
      <div className="card">
        <div className="card pad" style={{ border: 0, paddingBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
          <b>Pools</b><button onClick={() => setEdit(null)}><Plus size={14} /> Nouveau pool</button>
        </div>
        {!d.pools.length ? <Empty>Aucun pool DHCP.</Empty> : (
          <table>
            <thead><tr><th>Nom</th><th>Réseau</th><th>Passerelle</th><th>DNS</th><th /></tr></thead>
            <tbody>{d.pools.map((x) => (
              <tr key={x.name}>
                <td><b>{x.name}</b></td><td className="mono">{x.network} {x.mask}</td><td className="mono">{x.router}</td><td className="mono small">{x.dns.join(', ')}</td>
                <td className="actions-cell">
                  <button className="icon" onClick={() => setEdit(x)}><Pencil size={15} /></button>
                  <button className="icon" disabled={p.busy} onClick={() => confirm(`Supprimer le pool ${x.name} ?`) && post('pools/delete', { name: x.name }, 'Pool supprimé')}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card pad" style={{ border: 0, paddingBottom: 6 }}><b>Adresses exclues</b> <span className="muted small">(réservées, jamais distribuées)</span></div>
        {d.excluded.length > 0 && (
          <table><tbody>{d.excluded.map((x) => (
            <tr key={x.from + x.to}>
              <td className="mono">{x.from}{x.to !== x.from ? ` → ${x.to}` : ''}</td>
              <td className="actions-cell"><button className="icon" disabled={p.busy} onClick={() => post('excluded/delete', x, 'Exclusion supprimée')}><Trash2 size={15} /></button></td>
            </tr>
          ))}</tbody></table>
        )}
        <div className="row" style={{ padding: 16, alignItems: 'flex-end' }}>
          <Field label="De"><input value={ex.from} onChange={(e) => setEx({ ...ex, from: e.target.value })} placeholder="192.168.10.1" /></Field>
          <Field label="À (optionnel)"><input value={ex.to} onChange={(e) => setEx({ ...ex, to: e.target.value })} placeholder="192.168.10.10" /></Field>
          <Field label=" "><button disabled={!ex.from || p.busy} onClick={async () => { if (await post('excluded', ex, 'Exclusion ajoutée')) setEx({ from: '', to: '' }); }}><Plus size={14} /> Ajouter</button></Field>
        </div>
      </div>

      <Raw endpoint="dhcp-bindings" label="Voir les baux en cours" />
      {edit !== undefined && <PoolModal pool={edit} onClose={() => setEdit(undefined)} p={p} />}
      {p.result && <PushResult result={p.result} onClose={p.close} />}
    </>
  );
}
