import { useState } from 'react';
import { RefreshCw, Plus, Trash2, Pencil, Power } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Modal, Field, Dot, Empty, PushResult } from '../ui.jsx';
import { DevicePage } from './Gate.jsx';

const Refresh = ({ r }) => <button onClick={r.reload} disabled={r.loading}><RefreshCw size={14} className={r.loading ? 'spin' : ''} /> Actualiser</button>;

/** Envoie une modification, affiche le résultat détaillé. */
function usePush(reloadFn) {
  const { toast } = useApp();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const push = async (fn, okMsg = 'Configuration appliquée') => {
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) setResult(r);
      else toast(okMsg);
      await reloadFn();
      return r.ok;
    } catch (e) {
      toast(e.message, 'err');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { push, busy, result, close: () => setResult(null) };
}

/* ---------- Système ---------- */
export function SystemPage() {
  return (
    <DevicePage title="Système" endpoint="system" supports="system" actions={(r) => <Refresh r={r} />}>
      {(sys, reload) => <SystemBody sys={sys} reload={reload} />}
    </DevicePage>
  );
}
function SystemBody({ sys, reload }) {
  const { active } = useApp();
  const [name, setName] = useState(sys.hostname);
  const p = usePush(reload);
  const rows = [['Modèle', sys.model], ['Version', sys.os], ['Uptime', sys.uptime], ['N° de série', sys.serial]];
  return (
    <>
      <div className="split">
        <div className="card pad">
          <Field label="Nom d’hôte"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <button className="primary" disabled={p.busy || !name || name === sys.hostname} onClick={() => p.push(() => api.put(`/api/devices/${active.id}/hostname`, { hostname: name }))}>Appliquer</button>
        </div>
        <div className="card pad">
          {rows.map(([k, v]) => v ? <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span className="muted">{k}</span><span className="mono">{v}</span></div> : null)}
        </div>
      </div>
      <p className="muted small" style={{ margin: '18px 0 6px' }}>Sortie brute</p>
      <pre className="term">{sys.raw}</pre>
      {p.result && <PushResult result={p.result} onClose={p.close} />}
    </>
  );
}

/* ---------- Interfaces ---------- */
export function InterfacesPage() {
  const [q, setQ] = useState('');
  return (
    <DevicePage title="Interfaces" endpoint="interfaces" supports="interfaces" actions={(r) => <><input className="search" placeholder="Filtrer…" value={q} onChange={(e) => setQ(e.target.value)} /><Refresh r={r} /></>}>
      {(list, reload) => <InterfacesBody list={list} reload={reload} q={q} />}
    </DevicePage>
  );
}
function InterfacesBody({ list, reload, q }) {
  const { active } = useApp();
  const [edit, setEdit] = useState(null);
  const p = usePush(reload);
  const rows = list.filter((i) => `${i.name} ${i.description} ${i.ip}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (i) => p.push(() => api.put(`/api/devices/${active.id}/interfaces`, { name: i.name, adminUp: !i.adminUp }), i.adminUp ? `${i.name} désactivée` : `${i.name} activée`);
  return (
    <div className="card">
      {!rows.length ? <Empty>Aucune interface.</Empty> : (
        <table>
          <thead><tr><th>État</th><th>Interface</th><th>Description</th><th>Mode</th><th>VLAN</th><th>IP</th><th /></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.name} style={{ opacity: i.adminUp ? 1 : 0.55 }}>
                <td><Dot on={i.linkUp} /><span className="muted small">{!i.adminUp ? 'désactivée' : i.linkUp ? 'up' : 'down'}</span></td>
                <td className="mono">{i.name}</td>
                <td>{i.description || <span className="muted">—</span>}</td>
                <td>{i.mode ? <span className="tag">{i.mode}</span> : <span className="muted">—</span>}</td>
                <td className="mono">{i.mode === 'trunk' ? i.trunkVlans || 'all' : i.accessVlan || ''}</td>
                <td className="mono">{i.ip ? `${i.ip} ${i.mask}` : ''}</td>
                <td className="actions-cell">
                  <button className="icon" title={i.adminUp ? 'Désactiver' : 'Activer'} disabled={p.busy} onClick={() => toggle(i)}><Power size={15} /></button>
                  <button className="icon" title="Modifier" onClick={() => setEdit(i)}><Pencil size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && <InterfaceModal iface={edit} onClose={() => setEdit(null)} p={p} />}
      {p.result && <PushResult result={p.result} onClose={p.close} />}
    </div>
  );
}
function InterfaceModal({ iface, onClose, p }) {
  const { active } = useApp();
  const [f, setF] = useState({ description: iface.description, adminUp: iface.adminUp, mode: iface.mode || '', accessVlan: iface.accessVlan, trunkVlans: iface.trunkVlans, ip: iface.ip, mask: iface.mask, save: false });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async () => {
    const body = { name: iface.name, description: f.description, adminUp: f.adminUp, save: f.save };
    if (f.mode) Object.assign(body, { mode: f.mode, accessVlan: f.accessVlan, trunkVlans: f.trunkVlans, ip: f.ip, mask: f.mask });
    if (await p.push(() => api.put(`/api/devices/${active.id}/interfaces`, body))) onClose();
  };
  return (
    <Modal title={iface.name} onClose={onClose} footer={<><button onClick={onClose}>Annuler</button><button className="primary" disabled={p.busy} onClick={submit}>Appliquer</button></>}>
      <Field label="Description"><input value={f.description} onChange={set('description')} autoFocus /></Field>
      <label className="check"><input type="checkbox" checked={f.adminUp} onChange={set('adminUp')} /> Interface activée</label>
      <Field label="Mode">
        <select value={f.mode} onChange={set('mode')}>
          <option value="">— ne pas modifier —</option>
          <option value="access">Access (untagged)</option>
          <option value="trunk">Trunk (tagged)</option>
          <option value="routed">Routée (IP)</option>
        </select>
      </Field>
      {f.mode === 'access' && <Field label="VLAN"><input type="number" value={f.accessVlan} onChange={set('accessVlan')} /></Field>}
      {f.mode === 'trunk' && <Field label="VLANs autorisés" hint="ex. 10,20,30-40"><input value={f.trunkVlans} onChange={set('trunkVlans')} /></Field>}
      {f.mode === 'routed' && <div className="row"><Field label="Adresse IP"><input value={f.ip} onChange={set('ip')} /></Field><Field label="Masque"><input value={f.mask} onChange={set('mask')} placeholder="255.255.255.0" /></Field></div>}
      <label className="check"><input type="checkbox" checked={f.save} onChange={set('save')} /> Enregistrer ensuite en mémoire permanente</label>
    </Modal>
  );
}

/* ---------- VLANs ---------- */
export function VlansPage() {
  return (
    <DevicePage title="VLANs" endpoint="vlans" supports="vlans" actions={(r) => <Refresh r={r} />}>
      {(list, reload) => <VlansBody list={list} reload={reload} />}
    </DevicePage>
  );
}
function VlansBody({ list, reload }) {
  const { active } = useApp();
  const p = usePush(reload);
  const [f, setF] = useState({ id: '', name: '' });
  const add = async () => { if (await p.push(() => api.post(`/api/devices/${active.id}/vlans`, f), `VLAN ${f.id} enregistré`)) setF({ id: '', name: '' }); };
  const del = (v) => confirm(`Supprimer le VLAN ${v.id} (${v.name}) ?`) && p.push(() => api.del(`/api/devices/${active.id}/vlans/${v.id}`), `VLAN ${v.id} supprimé`);
  return (
    <>
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="ID (1–4094)"><input type="number" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} /></Field>
          <Field label="Nom"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label=" "><button className="primary" disabled={!f.id || p.busy} onClick={add}><Plus size={15} /> Créer / renommer</button></Field>
        </div>
      </div>
      <div className="card">
        {!list.length ? <Empty>Aucun VLAN.</Empty> : (
          <table>
            <thead><tr><th>ID</th><th>Nom</th><th>Statut</th><th>Ports</th><th /></tr></thead>
            <tbody>{list.map((v) => (
              <tr key={v.id}>
                <td className="mono">{v.id}</td><td>{v.name}</td><td><span className="tag">{v.status}</span></td>
                <td className="mono small muted">{v.ports.join(', ')}</td>
                <td className="actions-cell">{v.id !== 1 && <button className="icon" title="Supprimer" disabled={p.busy} onClick={() => del(v)}><Trash2 size={15} /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {p.result && <PushResult result={p.result} onClose={p.close} />}
    </>
  );
}

/* ---------- Routage ---------- */
export function RoutingPage() {
  return (
    <DevicePage title="Routage" subtitle="Routes statiques" endpoint="routes" supports="routes" actions={(r) => <Refresh r={r} />}>
      {(list, reload) => <RoutingBody list={list} reload={reload} />}
    </DevicePage>
  );
}
function RoutingBody({ list, reload }) {
  const { active } = useApp();
  const p = usePush(reload);
  const [f, setF] = useState({ network: '', nextHop: '', distance: 1 });
  const [table, setTable] = useState(null);
  const add = async () => { if (await p.push(() => api.post(`/api/devices/${active.id}/routes`, f), 'Route ajoutée')) setF({ network: '', nextHop: '', distance: 1 }); };
  const del = (r) => confirm(`Supprimer la route ${r.network}/${r.prefix} via ${r.nextHop} ?`) && p.push(() => api.post(`/api/devices/${active.id}/routes/delete`, { network: `${r.network}/${r.prefix}`, nextHop: r.nextHop }), 'Route supprimée');
  const show = async () => { try { setTable(await api.get(`/api/devices/${active.id}/routing-table`)); } catch (e) { setTable(e.message); } };
  return (
    <>
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Réseau" hint="10.0.0.0/8 ou 10.0.0.0 255.0.0.0"><input value={f.network} onChange={(e) => setF({ ...f, network: e.target.value })} placeholder="0.0.0.0/0" /></Field>
          <Field label="Passerelle (next-hop)"><input value={f.nextHop} onChange={(e) => setF({ ...f, nextHop: e.target.value })} /></Field>
          <Field label="Distance"><input type="number" value={f.distance} onChange={(e) => setF({ ...f, distance: Number(e.target.value) })} /></Field>
          <Field label=" "><button className="primary" disabled={!f.network || !f.nextHop || p.busy} onClick={add}><Plus size={15} /> Ajouter</button></Field>
        </div>
      </div>
      <div className="card">
        {!list.length ? <Empty>Aucune route statique.</Empty> : (
          <table>
            <thead><tr><th>Réseau</th><th>Next-hop</th><th>Distance</th><th /></tr></thead>
            <tbody>{list.map((r, i) => (
              <tr key={i}><td className="mono">{r.network}/{r.prefix}</td><td className="mono">{r.nextHop}</td><td>{r.distance}</td>
                <td className="actions-cell"><button className="icon" disabled={p.busy} onClick={() => del(r)}><Trash2 size={15} /></button></td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div style={{ marginTop: 16 }}>
        <button onClick={show}>Afficher la table de routage complète</button>
        {table && <pre className="term" style={{ marginTop: 10 }}>{table}</pre>}
      </div>
      {p.result && <PushResult result={p.result} onClose={p.close} />}
    </>
  );
}

/* ---------- Voisins ---------- */
export function NeighborsPage() {
  return (
    <DevicePage title="Voisins" subtitle="LLDP / CDP" endpoint="neighbors" supports="neighbors" actions={(r) => <Refresh r={r} />}>
      {(list) => (
        <div className="card">
          {!list.length ? <Empty>Aucun voisin annoncé.</Empty> : (
            <table>
              <thead><tr><th>Port local</th><th>Voisin</th><th>Port distant</th><th>IP</th><th>Plateforme</th><th /></tr></thead>
              <tbody>{list.map((n, i) => (
                <tr key={i}><td className="mono">{n.localIf}</td><td><b>{n.remoteName}</b></td><td className="mono">{n.remoteIf}</td><td className="mono">{n.remoteIp}</td>
                  <td className="muted small">{n.platform}</td><td><span className="tag">{n.protocol}</span></td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </DevicePage>
  );
}
