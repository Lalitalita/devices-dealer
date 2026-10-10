import { useEffect, useRef, useState } from 'react';
import { Download, Eye, Trash2, Archive, Play, GitCompare, RotateCcw, Pencil } from 'lucide-react';
import { useApp, invalidate } from '../store.jsx';
import { api } from '../api.js';
import { attach, closeTerminal } from '../terminals.js';
import { Modal, Field, Empty, Spinner, PushResult } from '../ui.jsx';
import { DevicePage } from './Gate.jsx';

/* ---------- Sauvegardes ---------- */
function DiffView({ changes, context = 3 }) {
  // n'affiche que les lignes modifiées et quelques lignes de contexte
  const show = new Array(changes.length).fill(false);
  changes.forEach((c, i) => { if (c.t !== ' ') for (let k = Math.max(0, i - context); k <= Math.min(changes.length - 1, i + context); k++) show[k] = true; });
  const rows = [];
  let gap = false;
  changes.forEach((c, i) => {
    if (!show[i]) { gap = true; return; }
    if (gap && rows.length) rows.push(<div key={`g${i}`} className="diff-gap">⋯</div>);
    gap = false;
    rows.push(<div key={i} className={`diff-line ${c.t === '+' ? 'add' : c.t === '-' ? 'del' : ''}`}><span>{c.t}</span>{c.s}</div>);
  });
  return rows.length ? <div className="diff">{rows}</div> : <Empty>Aucune différence.</Empty>;
}

function CompareModal({ device, backups, base, connected, onClose }) {
  const [other, setOther] = useState(connected ? 'live' : backups.find((b) => b.name !== base)?.name || '');
  const [noise, setNoise] = useState(true);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!other) return;
    setBusy(true); setErr('');
    api.get(`/api/devices/${device.id}/backups-diff?a=${encodeURIComponent(base)}&b=${encodeURIComponent(other)}&noise=${noise ? 1 : 0}`)
      .then(setRes).catch((e) => { setErr(e.message); setRes(null); }).finally(() => setBusy(false));
  }, [other, noise, base, device.id]);
  return (
    <Modal title="Comparer" wide onClose={onClose} footer={<button onClick={onClose}>Fermer</button>}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label="Sauvegarde de référence"><input value={base} disabled /></Field>
        <Field label="Comparer avec">
          <select value={other} onChange={(e) => setOther(e.target.value)}>
            {connected && <option value="live">Configuration actuelle de l’équipement</option>}
            {backups.filter((b) => b.name !== base).map((b) => <option key={b.name} value={b.name}>{b.name}{b.note ? ` — ${b.note}` : ''}</option>)}
          </select>
        </Field>
      </div>
      <label className="check"><input type="checkbox" checked={noise} onChange={(e) => setNoise(e.target.checked)} /> Ignorer les lignes sans importance (dates, tailles…)</label>
      {busy && <Spinner label="Comparaison…" />}
      {err && <div className="errors">{err}</div>}
      {res && !busy && (
        <>
          <p className="small" style={{ marginBottom: 8 }}><span style={{ color: 'var(--ok)' }}>+{res.added}</span> ajoutée(s) · <span style={{ color: 'var(--err)' }}>−{res.removed}</span> supprimée(s) <span className="muted">(de la référence vers la cible)</span></p>
          <DiffView changes={res.changes} />
        </>
      )}
    </Modal>
  );
}

function RestoreModal({ device, name, onClose, onDone }) {
  const { toast } = useApp();
  const [removeExtra, setRemoveExtra] = useState(false);
  const [save, setSave] = useState(false);
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => {
    setPlan(null); setErr('');
    api.post(`/api/devices/${device.id}/backups/${name}/restore`, { mode: 'preview', removeExtra }).then(setPlan).catch((e) => setErr(e.message));
  }, [removeExtra, name, device.id]);
  const apply = async () => {
    if (!confirm(`Envoyer ${plan.commands.length} commande(s) à ${device.name} ?`)) return;
    setBusy(true);
    try { const r = await api.post(`/api/devices/${device.id}/backups/${name}/restore`, { mode: 'apply', removeExtra, save }); setResult(r); invalidate(device.id); onDone(); }
    catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  if (result) return <PushResult result={{ ok: !result.errors?.length, errors: result.errors, commands: result.commands, output: `${result.safetyBackup ? `Sauvegarde de sécurité créée : ${result.safetyBackup}\n\n` : ''}${result.output || ''}` }} onClose={onClose} />;
  return (
    <Modal title={`Réinjecter ${name}`} wide onClose={onClose} footer={<><button onClick={onClose}>Annuler</button><button className="primary" disabled={busy || !plan?.commands.length} onClick={apply}><RotateCcw size={14} /> Réinjecter</button></>}>
      <div className="errors" style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)', color: 'var(--warn)' }}>
        Mode « fusion » : seules les différences sont envoyées en configuration, sans redémarrage. Relisez la liste ci-dessous. Une sauvegarde de sécurité de l’état actuel est créée automatiquement avant l’envoi.
      </div>
      <label className="check"><input type="checkbox" checked={removeExtra} onChange={(e) => setRemoveExtra(e.target.checked)} /> Supprimer aussi ce qui n’existe pas dans la sauvegarde <span className="muted">(les accès SSH, comptes et mots de passe sont protégés)</span></label>
      <label className="check"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Enregistrer ensuite en mémoire permanente</label>
      {err && <div className="errors">{err}</div>}
      {!plan && !err && <Spinner label="Calcul des différences avec l’équipement…" />}
      {plan && (!plan.commands.length ? <Empty>L’équipement est déjà identique à cette sauvegarde.</Empty> : (
        <>
          <p className="small muted">{plan.additions} ajout(s) · {plan.removals} suppression(s)</p>
          <div className="diff">{plan.commands.map((c, i) => <div key={i} className={`diff-line ${/^(no|undo) /.test(c) ? 'del' : 'add'}`}><span>›</span>{c}</div>)}</div>
        </>
      ))}
    </Modal>
  );
}

function NoteCell({ device, b, onSaved }) {
  const { toast } = useApp();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(b.note);
  const save = async () => {
    setEdit(false);
    if (v === b.note) return;
    try { await api.put(`/api/devices/${device.id}/backups/${b.name}/note`, { note: v }); onSaved(); } catch (e) { toast(e.message, 'err'); }
  };
  return edit
    ? <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => (e.key === 'Enter' ? save() : e.key === 'Escape' && (setV(b.note), setEdit(false)))} placeholder="Ajouter une note…" />
    : <span style={{ cursor: 'text', display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={() => setEdit(true)}>{b.note || <span className="muted">Ajouter une note…</span>} <Pencil size={12} className="muted" /></span>;
}

export function BackupsPage() {
  const { active, toast, sessions } = useApp();
  const connected = !!active && sessions.includes(active.id);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const [ask, setAsk] = useState(false);
  const [note, setNote] = useState('');
  const [cmp, setCmp] = useState(null);
  const [restore, setRestore] = useState(null);

  const backup = (reload) => async () => {
    setBusy(true);
    try { await api.post(`/api/devices/${active.id}/backups`, { note }); toast('Configuration sauvegardée'); setAsk(false); setNote(''); await reload(); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <DevicePage title="Sauvegardes" subtitle="Configuration courante (running-config)" endpoint="backups" local
      actions={() => <button className="primary" disabled={!connected} title={connected ? '' : 'Connectez l’appareil pour sauvegarder'} onClick={() => setAsk(true)}><Archive size={15} /> Sauvegarder maintenant</button>}>
      {(list, reload) => (
        <div className="card">
          {!connected && <div className="muted small" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>Appareil non connecté : vous pouvez consulter et comparer les sauvegardes entre elles ; connectez-vous pour sauvegarder, comparer avec l’état actuel ou réinjecter.</div>}
          {!list.length ? <Empty>Aucune sauvegarde pour cet appareil.</Empty> : (
            <table>
              <thead><tr><th>Date</th><th>Note</th><th>Taille</th><th /></tr></thead>
              <tbody>{list.map((b) => (
                <tr key={b.name}>
                  <td className="mono small">{b.name.replace(/\.cfg$/, '')}</td>
                  <td><NoteCell device={active} b={b} onSaved={reload} /></td>
                  <td className="muted small">{(b.size / 1024).toFixed(1)} Ko</td>
                  <td className="actions-cell">
                    <button className="icon" title="Voir" onClick={async () => setView({ name: b.name, text: await api.get(`/api/devices/${active.id}/backups/${b.name}`) })}><Eye size={15} /></button>
                    <button className="icon" title="Comparer" disabled={!connected && list.length < 2} onClick={() => setCmp({ base: b.name, list })}><GitCompare size={15} /></button>
                    <button className="icon" title={connected ? 'Réinjecter sur l’équipement' : 'Connectez l’appareil'} disabled={!connected} onClick={() => setRestore(b.name)}><RotateCcw size={15} /></button>
                    <a href={`/api/devices/${active.id}/backups/${b.name}?download=1`}><button className="icon" title="Télécharger"><Download size={15} /></button></a>
                    <button className="icon" title="Supprimer" onClick={async () => { if (confirm('Supprimer cette sauvegarde ?')) { await api.del(`/api/devices/${active.id}/backups/${b.name}`); reload(); } }}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {view && <Modal title={view.name} wide onClose={() => setView(null)}><pre className="term" style={{ maxHeight: '60vh' }}>{view.text}</pre></Modal>}
          {cmp && <CompareModal device={active} backups={cmp.list} base={cmp.base} connected={connected} onClose={() => setCmp(null)} />}
          {restore && <RestoreModal device={active} name={restore} onClose={() => setRestore(null)} onDone={reload} />}
          {ask && (
            <Modal title="Nouvelle sauvegarde" onClose={() => setAsk(false)} footer={<><button onClick={() => setAsk(false)}>Annuler</button><button className="primary" disabled={busy} onClick={backup(reload)}>{busy ? 'Sauvegarde…' : 'Sauvegarder'}</button></>}>
              <Field label="Note (optionnel)" hint="ex. « avant ajout du NAT »"><input autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && backup(reload)()} /></Field>
            </Modal>
          )}
        </div>
      )}
    </DevicePage>
  );
}

/* ---------- Commandes ---------- */
export function CommandsPage() {
  const { active } = useApp();
  const [cmds, setCmds] = useState('');
  const [config, setConfig] = useState(false);
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const run = async () => {
    if (config && !confirm(`Envoyer ${cmds.split('\n').filter(Boolean).length} commande(s) en mode configuration sur ${active.name} ?`)) return;
    setBusy(true); setRes(null);
    try { setRes(await api.post(`/api/devices/${active.id}/exec`, { commands: cmds, config, save })); } catch (e) { setRes({ output: '', errors: [{ command: '', message: e.message }] }); }
    setBusy(false);
  };
  return (
    <DevicePage title="Commandes" subtitle="Une commande par ligne — fonctionne avec n’importe quelle marque">
      {() => (
        <>
          <div className="card pad">
            <textarea rows={8} value={cmds} onChange={(e) => setCmds(e.target.value)} placeholder={'show version\nshow interfaces status'} spellCheck={false} />
            <div className="actions" style={{ marginTop: 12 }}>
              <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={config} onChange={(e) => setConfig(e.target.checked)} /> Mode configuration</label>
              {config && <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Enregistrer ensuite</label>}
              <span style={{ flex: 1 }} />
              <button className="primary" disabled={busy || !cmds.trim()} onClick={run}><Play size={14} /> Exécuter</button>
            </div>
          </div>
          {busy && <div className="card" style={{ marginTop: 14 }}><Spinner label="Exécution…" /></div>}
          {res && (
            <div style={{ marginTop: 14 }}>
              {res.errors?.length > 0 && <div className="errors">{res.errors.map((e, i) => <div key={i}>{e.command && <code>{e.command} → </code>}{e.message}</div>)}</div>}
              {res.output && <pre className="term" style={{ maxHeight: 'none' }}>{res.output}</pre>}
            </div>
          )}
        </>
      )}
    </DevicePage>
  );
}

/* ---------- Console (xterm.js) ---------- */
export function ConsolePage() {
  return (
    <DevicePage title="Console" subtitle="Terminal interactif — la session reste ouverte quand vous changez d’onglet">
      {() => <TerminalView />}
    </DevicePage>
  );
}

function TerminalView() {
  const { active } = useApp();
  const el = useRef(null);
  const [state, setState] = useState('connexion…');
  const [nonce, setNonce] = useState(0);

  useEffect(() => attach(active.id, el.current, setState), [active.id, nonce]);

  return (
    <>
      <div className="actions" style={{ marginBottom: 10 }}>
        <span className="tag accent">{active.connection}</span>
        <span className="muted small">{state}</span>
        <button className="ghost" onClick={() => { closeTerminal(active.id); setNonce((n) => n + 1); }}>Rouvrir le terminal</button>
      </div>
      <div className="xterm-wrap"><div ref={el} style={{ height: '100%' }} /></div>
    </>
  );
}
