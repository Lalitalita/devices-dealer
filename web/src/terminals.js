// Terminaux xterm conservés d'une page à l'autre : la connexion reste ouverte tant qu'on ne se déconnecte pas.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const terms = new Map(); // deviceId -> { term, fit, ws, el, state, subs }

const emit = (t) => t.subs.forEach((f) => f(t.state));

function create(id) {
  const el = document.createElement('div');
  el.style.height = '100%';
  const term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', theme: { background: '#0a0c10', foreground: '#e6e9f0' }, scrollback: 5000 });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  const t = { term, fit, el, state: 'connexion…', subs: new Set(), ws: null };
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/devices/${id}/terminal`);
  t.ws = ws;
  const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  t.send = send;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'output') term.write(m.data);
    else if (m.type === 'ready') { t.state = 'connecté'; emit(t); send({ type: 'resize', cols: term.cols, rows: term.rows }); }
    else if (m.type === 'error') { t.state = 'erreur'; term.write(`\r\n\x1b[31m${m.data}\x1b[0m\r\n`); emit(t); }
    else if (m.type === 'closed') { t.state = 'déconnecté'; emit(t); }
  };
  ws.onclose = () => { if (t.state !== 'erreur') t.state = 'déconnecté'; emit(t); };
  term.onData((data) => send({ type: 'input', data }));
  terms.set(id, t);
  return t;
}

export function openTerminal(id) {
  const t = terms.get(id);
  return t && t.ws.readyState <= 1 ? t : (closeTerminal(id), create(id));
}

/** Place le terminal (déjà connecté) dans un conteneur de la page. */
export function attach(id, container, onState) {
  const t = openTerminal(id);
  container.appendChild(t.el);
  const refit = () => { t.fit.fit(); t.send({ type: 'resize', cols: t.term.cols, rows: t.term.rows }); };
  requestAnimationFrame(() => { refit(); t.term.focus(); });
  t.subs.add(onState);
  onState(t.state);
  window.addEventListener('resize', refit);
  return () => { window.removeEventListener('resize', refit); t.subs.delete(onState); };
}

export function closeTerminal(id) {
  const t = terms.get(id);
  if (!t) return;
  t.ws.close();
  t.term.dispose();
  t.el.remove();
  terms.delete(id);
}

export const closeAllExcept = (keepIds) => [...terms.keys()].filter((id) => !keepIds.includes(id)).forEach(closeTerminal);
