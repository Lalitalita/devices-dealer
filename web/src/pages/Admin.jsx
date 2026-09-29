import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { PageHeader, Field, Empty } from '../ui.jsx';

export function AuditPage() {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { api.get('/api/audit').then(setList); }, []);
  return (
    <>
      <PageHeader title="Journal" subtitle="Toutes les actions envoyées aux équipements" />
      <div className="card">
        {!list?.length ? <Empty>Rien pour l’instant.</Empty> : (
          <table>
            <thead><tr><th>Date</th><th>Appareil</th><th>Action</th><th>Résultat</th></tr></thead>
            <tbody>{list.map((a, i) => (
              <>
                <tr key={i} onClick={() => setOpen(open === i ? null : i)} style={{ cursor: 'pointer' }}>
                  <td className="muted small">{new Date(a.ts).toLocaleString()}</td><td>{a.device}</td><td>{a.action}</td>
                  <td>{a.ok ? <span className="tag accent">ok</span> : <span className="tag" style={{ color: 'var(--err)' }}>erreur</span>}</td>
                </tr>
                {open === i && (
                  <tr key={`${i}d`}><td colSpan={4}>
                    {a.detail && <p className="small muted">{a.detail}</p>}
                    {a.commands?.length > 0 && <pre className="term">{a.commands.join('\n')}</pre>}
                    {a.errors?.length > 0 && <div className="errors">{a.errors.join(' · ')}</div>}
                  </td></tr>
                )}
              </>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

const SWATCHES = ['#6d8cff', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb7185', '#22d3ee'];

export function SettingsPage() {
  const { meta, loadMeta, toast } = useApp();
  const s = meta?.settings;
  const [name, setName] = useState(s?.appName || '');
  const [pw, setPw] = useState({ current: '', next: '' });
  const save = async (patch, msg = 'Enregistré') => { try { await api.put('/api/settings', patch); await loadMeta(); toast(msg); } catch (e) { toast(e.message, 'err'); } };
  if (!s) return null;
  return (
    <>
      <PageHeader title="Paramètres" subtitle="Rendez l’outil à votre image" />
      <div className="split">
        <div className="card pad">
          <h3 style={{ marginBottom: 14 }}>Apparence</h3>
          <Field label="Nom de l’application">
            <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} /><button style={{ flex: 0 }} onClick={() => save({ appName: name })}>OK</button></div>
          </Field>
          <Field label="Couleur d’accent">
            <div className="actions">
              {SWATCHES.map((c) => <button key={c} onClick={() => save({ accent: c })} style={{ background: c, width: 26, height: 26, padding: 0, borderRadius: '50%', borderColor: s.accent === c ? 'var(--text)' : 'transparent' }} />)}
              <input type="color" value={s.accent} onChange={(e) => save({ accent: e.target.value }, 'Couleur appliquée')} />
            </div>
          </Field>
          <Field label="Thème">
            <div className="seg">
              {['dark', 'light'].map((t) => <button key={t} className={s.theme === t ? 'on' : ''} onClick={() => save({ theme: t })}>{t === 'dark' ? 'Sombre' : 'Clair'}</button>)}
            </div>
          </Field>
        </div>
        <div className="card pad">
          <h3 style={{ marginBottom: 14 }}>Mot de passe</h3>
          <Field label="Actuel"><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="Nouveau (8 caractères min.)"><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <button className="primary" onClick={async () => { try { await api.post('/api/auth/password', pw); setPw({ current: '', next: '' }); toast('Mot de passe modifié'); } catch (e) { toast(e.message, 'err'); } }}>Changer</button>
        </div>
      </div>
    </>
  );
}
