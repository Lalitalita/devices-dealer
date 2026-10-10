import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { closeTerminal, closeAllExcept } from './terminals.js';
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
  const [sessions, setSessions] = useState([]);
  const [connecting, setConnecting] = useState('');
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

  const refreshSessions = useCallback(
    () => api.get('/api/sessions').then((l) => { setSessions(l.map((x) => x.id)); closeAllExcept(l.map((x) => x.id)); }).catch(() => {}),
    [],
  );

  const connectDevice = useCallback(async (id) => {
    setConnecting(id);
    try {
      await api.post(`/api/devices/${id}/connect`);
      await refreshSessions();
      toast('Connecté');
    } catch (e) {
      toast(e.message, 'err');
    }
    setConnecting('');
  }, [refreshSessions, toast]);

  const disconnectDevice = useCallback(async (id) => {
    try { await api.post(`/api/devices/${id}/disconnect`); } catch { /* déjà fermée */ }
    closeTerminal(id);
    forget(id);
    await refreshSessions();
    toast('Déconnecté');
  }, [refreshSessions, toast]);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.get('/api/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadMeta();
    reload().then(refreshStatus);
    refreshSessions();
    const t = setInterval(() => { refreshStatus(); refreshSessions(); }, 20000);
    return () => clearInterval(t);
  }, [user, loadMeta, reload, refreshStatus, refreshSessions]);

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

  const value = { sessions, connecting, connectDevice, disconnectDevice, user, setUser, meta, loadMeta, devices, links, status, reload, refreshStatus, toast, active, activeId, setActiveId };
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

// --- cache des lectures d'équipement : on ne relance une commande que si nécessaire ---
const cache = new Map(); // url -> { data, error, loading, stale }
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => (listeners.add(l), () => listeners.delete(l));

async function fetchInto(url) {
  const old = cache.get(url);
  if (old?.loading) return;
  cache.set(url, { data: old?.data ?? null, error: '', loading: true, stale: false });
  emit();
  try {
    cache.set(url, { data: await api.get(url), error: '', loading: false, stale: false });
  } catch (e) {
    cache.set(url, { data: null, error: e.message, loading: false, stale: false });
  }
  emit();
}

/** Marque périmées les lectures d'un appareil (après une modification) : les pages ouvertes se rafraîchissent. */
export function invalidate(deviceId) {
  for (const [k, v] of cache) if (k.startsWith(`/api/devices/${deviceId}/`) && !k.includes('/backups')) cache.set(k, { ...v, stale: true });
  emit();
}
export function forget(deviceId) {
  for (const k of [...cache.keys()]) if (k.startsWith(`/api/devices/${deviceId}/`)) cache.delete(k);
  emit();
}

/** Lecture d'un appareil, mise en cache. `reload()` force une nouvelle lecture. */
export function useRemote(url) {
  const e = useSyncExternalStore(subscribe, () => (url ? cache.get(url) : undefined));
  useEffect(() => {
    if (url && (!e || (e.stale && !e.loading))) fetchInto(url);
  }, [url, e]);
  return { data: e?.data ?? null, loading: !!url && (!e || e.loading), error: e?.error || '', reload: () => url && fetchInto(url) };
}
