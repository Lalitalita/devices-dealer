import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = inconnu, null = déconnecté
  const [meta, setMeta] = useState(null);
  const [devices, setDevices] = useState([]);
  const [links, setLinks] = useState([]);
  const [status, setStatus] = useState({});
  const [toasts, setToasts] = useState([]);
  const [activeId, setActiveIdState] = useState(() => localStorage.getItem('dd.active') || '');

  const toast = useCallback((message, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3000);
  }, []);

  const setActiveId = (id) => {
    setActiveIdState(id);
    localStorage.setItem('dd.active', id);
  };

  const reload = useCallback(async () => {
    const [d, l] = await Promise.all([api.get('/api/devices'), api.get('/api/links')]);
    setDevices(d);
    setLinks(l);
  }, []);

  const loadMeta = useCallback(async () => setMeta(await api.get('/api/meta')), []);

  const refreshStatus = useCallback(() => api.get('/api/status').then(setStatus).catch(() => {}), []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.get('/api/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadMeta();
    reload().then(refreshStatus);
    const t = setInterval(refreshStatus, 30000);
    return () => clearInterval(t);
  }, [user, loadMeta, reload, refreshStatus]);

  // thème + couleur d'accent
  useEffect(() => {
    const s = meta?.settings;
    document.documentElement.dataset.theme = s?.theme || localStorage.getItem('dd.theme') || 'dark';
    if (s?.accent) document.documentElement.style.setProperty('--accent', s.accent);
    if (s) localStorage.setItem('dd.theme', s.theme);
    document.title = s?.appName || 'Devices Dealer';
  }, [meta]);

  // sélectionne automatiquement le premier appareil configurable
  useEffect(() => {
    if (devices.length && !devices.some((d) => d.id === activeId && !d.virtual)) {
      const first = devices.find((d) => !d.virtual);
      if (first) setActiveId(first.id);
    }
    // eslint-disable-next-line
  }, [devices]);

  const active = useMemo(() => devices.find((d) => d.id === activeId && !d.virtual) || null, [devices, activeId]);

  const value = { user, setUser, meta, loadMeta, devices, links, status, reload, refreshStatus, toast, active, activeId, setActiveId };
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Charge des données d'un appareil (SSH) avec état de chargement/erreur. */
export function useRemote(url) {
  const [state, setState] = useState({ data: null, loading: !!url, error: '' });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return setState({ data: null, loading: false, error: '' });
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await api.get(url);
      if (n === seq.current) setState({ data, loading: false, error: '' });
    } catch (e) {
      if (n === seq.current) setState({ data: null, loading: false, error: e.message });
    }
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
