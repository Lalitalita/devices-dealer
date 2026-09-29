import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Download, Eye, Trash2, Archive, Play } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Modal, Empty, Spinner } from '../ui.jsx';
import { DevicePage } from './Gate.jsx';

/* ---------- Sauvegardes ---------- */
export function BackupsPage() {
  const { active, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const backup = (reload) => async () => {
    setBusy(true);
    try { await api.post(`/api/devices/${active.id}/backups`); toast('Configuration sauvegardée'); await reload(); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <DevicePage title="Sauvegardes" subtitle="Configuration courante (running-config)" endpoint="backups"
      actions={(r) => <button className="primary" disabled={busy} onClick={backup(r.reload)}><Archive size={15} /> {busy ? 'Sauvegarde…' : 'Sauvegarder maintenant'}</button>}>
      {(list, reload) => (
        <div className="card">
          {!list.length ? <Empty>Aucune sauvegarde pour cet appareil.</Empty> : (
            <table>
              <thead><tr><th>Fichier</th><th>Taille</th><th /></tr></thead>
              <tbody>{list.map((b) => (
                <tr key={b.name}><td className="mono">{b.name}</td><td className="muted">{(b.size / 1024).toFixed(1)} Ko</td>
                  <td className="actions-cell">
                    <button className="icon" title="Voir" onClick={async () => setView({ name: b.name, text: await api.get(`/api/devices/${active.id}/backups/${b.name}`) })}><Eye size={15} /></button>
                    <a href={`/api/devices/${active.id}/backups/${b.name}?download=1`}><button className="icon" title="Télécharger"><Download size={15} /></button></a>
                    <button className="icon" title="Supprimer" onClick={async () => { if (confirm('Supprimer cette sauvegarde ?')) { await api.del(`/api/devices/${active.id}/backups/${b.name}`); reload(); } }}><Trash2 size={15} /></button>
                  </td></tr>
              ))}</tbody>
            </table>
          )}
          {view && <Modal title={view.name} wide onClose={() => setView(null)}><pre className="term" style={{ maxHeight: '60vh' }}>{view.text}</pre></Modal>}
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
    <DevicePage title="Console" subtitle="Terminal interactif SSH ou console">
      {() => <TerminalView />}
    </DevicePage>
  );
}

function TerminalView() {
  const { active } = useApp();
  const el = useRef(null);
  const [state, setState] = useState('connexion…');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', theme: { background: '#0a0c10', foreground: '#e6e9f0' }, scrollback: 5000 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el.current);
    fit.fit();
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/devices/${active.id}/terminal`);
    const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
    ws.onopen = () => send({ type: 'resize', cols: term.cols, rows: term.rows });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'output') term.write(m.data);
      else if (m.type === 'ready') { setState('connecté'); term.focus(); send({ type: 'resize', cols: term.cols, rows: term.rows }); }
      else if (m.type === 'error') { setState('erreur'); term.write(`\r\n\x1b[31m${m.data}\x1b[0m\r\n`); }
      else if (m.type === 'closed') setState('déconnecté');
    };
    ws.onclose = () => setState((s) => (s === 'erreur' ? s : 'déconnecté'));
    term.onData((data) => send({ type: 'input', data }));
    const onResize = () => { fit.fit(); send({ type: 'resize', cols: term.cols, rows: term.rows }); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); ws.close(); term.dispose(); };
  }, [active.id, nonce]);

  return (
    <>
      <div className="actions" style={{ marginBottom: 10 }}>
        <span className="tag accent">{active.connection}</span>
        <span className="muted small">{state}</span>
        <button className="ghost" onClick={() => { setState('connexion…'); setNonce((n) => n + 1); }}>Reconnecter</button>
      </div>
      <div className="xterm-wrap"><div ref={el} style={{ height: '100%' }} /></div>
    </>
  );
}
