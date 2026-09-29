import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, SlidersHorizontal, TerminalSquare } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { PageHeader, Modal, Field, DeviceIcon, Dot, TYPE_META, Empty } from '../ui.jsx';

const CONNS = { ssh: 'SSH', telnet: 'Console réseau (TCP/telnet)', serial: 'Console série locale' };

export function DeviceForm({ device, onClose, virtualDefault = false }) {
  const { meta, reload, toast, refreshStatus } = useApp();
  const edit = !!device;
  const [f, setF] = useState(device ? { ...device } : { name: '', type: virtualDefault ? 'pc' : 'switch', virtual: virtualDefault, vendor: 'cisco_ios', connection: 'ssh', port: 22, baud: 9600 });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async () => {
    setBusy(true);
    try {
      const body = { ...f };
      delete body.id; delete body.hasPassword; delete body.hasKey; delete body.hasEnable; delete body.hostKeyKnown;
      edit ? await api.put(`/api/devices/${device.id}`, body) : await api.post('/api/devices', body);
      await reload();
      refreshStatus();
      toast(edit ? 'Appareil modifié' : 'Appareil ajouté');
      onClose();
    } catch (e) {
      toast(e.message, 'err');
    }
    setBusy(false);
  };

  return (
    <Modal
      title={edit ? `Modifier ${device.name}` : 'Nouvel appareil'}
      onClose={onClose}
      footer={<><button onClick={onClose}>Annuler</button><button className="primary" disabled={busy || !f.name} onClick={submit}>{edit ? 'Enregistrer' : 'Ajouter'}</button></>}
    >
      <label className="check">
        <input type="checkbox" checked={!!f.virtual} onChange={set('virtual')} />
        <span>Machine vide <span className="muted">(poste utilisateur, sans connexion)</span></span>
      </label>
      <div className="row">
        <Field label="Nom"><input value={f.name || ''} onChange={set('name')} autoFocus /></Field>
        <Field label="Type">
          <select value={f.type} onChange={set('type')}>
            {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
      </div>
      {f.virtual ? (
        <div className="row">
          <Field label="Adresse IP (info)"><input value={f.ip || ''} onChange={set('ip')} placeholder="192.168.1.20" /></Field>
          <Field label="MAC (info)"><input value={f.mac || ''} onChange={set('mac')} /></Field>
        </div>
      ) : (
        <>
          <div className="row">
            <Field label="Constructeur / OS">
              <select value={f.vendor} onChange={set('vendor')}>
                {meta?.drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </Field>
            <Field label="Connexion">
              <select value={f.connection} onChange={(e) => setF({ ...f, connection: e.target.value, port: e.target.value === 'ssh' ? 22 : e.target.value === 'telnet' ? 23 : f.port })}>
                {Object.entries(CONNS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          {f.connection === 'serial' ? (
            <div className="row">
              <Field label="Port série" hint="ex. /dev/ttyUSB0 (à monter dans docker-compose)"><input value={f.serialPath || ''} onChange={set('serialPath')} placeholder="/dev/ttyUSB0" /></Field>
              <Field label="Baud"><input type="number" value={f.baud || 9600} onChange={set('baud')} /></Field>
            </div>
          ) : (
            <div className="row" style={{ gridTemplateColumns: '3fr 1fr' }}>
              <Field label={f.connection === 'ssh' ? 'Adresse / hôte' : 'Serveur console'}><input value={f.host || ''} onChange={set('host')} placeholder="10.0.0.1" /></Field>
              <Field label="Port"><input type="number" value={f.port || ''} onChange={set('port')} style={{ maxWidth: 110 }} /></Field>
            </div>
          )}
          <div className="row">
            <Field label="Utilisateur"><input value={f.username || ''} onChange={set('username')} autoComplete="off" /></Field>
            <Field label="Mot de passe" hint={edit && f.hasPassword ? 'Laisser vide pour conserver' : ''}><input type="password" value={f.password || ''} onChange={set('password')} autoComplete="new-password" /></Field>
          </div>
          <div className="row">
            <Field label="Mot de passe enable" hint={edit && f.hasEnable ? 'Laisser vide pour conserver' : 'Optionnel'}><input type="password" value={f.enableSecret || ''} onChange={set('enableSecret')} autoComplete="new-password" /></Field>
            {edit && f.hostKeyKnown && f.connection === 'ssh' && (
              <label className="check" style={{ alignSelf: 'center', margin: 0 }}><input type="checkbox" checked={!!f.resetHostKey} onChange={set('resetHostKey')} /><span>Oublier l’empreinte SSH</span></label>
            )}
          </div>
          {f.connection === 'ssh' && (
            <Field label="Clé privée (optionnel)" hint={edit && f.hasKey ? 'Laisser vide pour conserver' : 'Format PEM / OpenSSH'}>
              <textarea value={f.privateKey || ''} onChange={set('privateKey')} rows={3} />
            </Field>
          )}
        </>
      )}
      <Field label="Notes"><input value={f.notes || ''} onChange={set('notes')} /></Field>
    </Modal>
  );
}

export default function Devices() {
  const { devices, status, reload, toast, setActiveId } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null); // null | {} | device
  const list = devices.filter((d) => `${d.name} ${d.host} ${d.ip} ${d.type}`.toLowerCase().includes(q.toLowerCase()));

  const remove = async (d) => {
    if (!confirm(`Supprimer « ${d.name} » et ses liens ?`)) return;
    try { await api.del(`/api/devices/${d.id}`); await reload(); toast('Appareil supprimé'); } catch (e) { toast(e.message, 'err'); }
  };
  const open = (d, to) => { setActiveId(d.id); nav(to); };

  return (
    <>
      <PageHeader title="Appareils" subtitle={`${devices.length} appareil(s) dans l’inventaire`}>
        <input className="search" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={() => setForm({ virtualDefault: true })}><Plus size={15} /> Machine vide</button>
        <button className="primary" onClick={() => setForm({})}><Plus size={15} /> Appareil</button>
      </PageHeader>
      <div className="card">
        {!list.length ? <Empty>Aucun appareil.</Empty> : (
          <table>
            <thead><tr><th>Nom</th><th>Type</th><th>Adresse</th><th>Connexion</th><th>Marque</th><th /></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td><div className="name-cell"><div className="ico"><DeviceIcon type={d.type} /></div><div><b>{d.name}</b>{d.notes && <div className="muted small">{d.notes}</div>}</div></div></td>
                  <td>{TYPE_META[d.type]?.label}</td>
                  <td className="mono">{d.virtual ? (d.ip || '—') : <><Dot on={status[d.id]} unknown={status[d.id] === undefined} />{d.host || d.serialPath}{d.port && d.connection !== 'serial' ? `:${d.port}` : ''}</>}</td>
                  <td>{d.virtual ? <span className="tag">machine vide</span> : <span className="tag accent">{d.connection}</span>}</td>
                  <td className="muted">{d.virtual ? '' : meta_label(d.vendor)}</td>
                  <td className="actions-cell">
                    {!d.virtual && <button className="icon" title="Configurer" onClick={() => open(d, '/config/interfaces')}><SlidersHorizontal size={15} /></button>}
                    {!d.virtual && <button className="icon" title="Console" onClick={() => open(d, '/tools/console')}><TerminalSquare size={15} /></button>}
                    <button className="icon" title="Modifier" onClick={() => setForm(d)}><Pencil size={15} /></button>
                    <button className="icon" title="Supprimer" onClick={() => remove(d)}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {form && <DeviceForm device={form.id ? form : null} virtualDefault={form.virtualDefault} onClose={() => setForm(null)} />}
    </>
  );
}

const meta_label = (v) => ({ cisco_ios: 'Cisco IOS', hp_procurve: 'HP ProCurve', hp_comware: 'HPE Comware', generic: 'Autre' })[v] || v;
