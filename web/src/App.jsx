import { useState } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Network, HardDrive, Cable, GitBranch, Radar, Archive, TerminalSquare, ScrollText, SlidersHorizontal, ChevronDown, Save, LogOut, Sun, Moon, Waypoints, ListChecks, Route as RouteIcon, Cpu, Shuffle, Server, Plug, Unplug, Loader2 } from 'lucide-react';
import { useApp } from './store.jsx';
import { api } from './api.js';
import { DeviceIcon } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Topology from './pages/Topology.jsx';
import Devices from './pages/Devices.jsx';
import { SystemPage, InterfacesPage, VlansPage, RoutingPage, NeighborsPage } from './pages/Config.jsx';
import { BackupsPage, CommandsPage, ConsolePage } from './pages/Tools.jsx';
import { AuditPage, SettingsPage } from './pages/Admin.jsx';
import { NatPage, DhcpPage } from './pages/Network.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

const NAV = [
  { title: 'Général', items: [
    { to: '/', icon: LayoutDashboard, label: 'Vue d’ensemble', end: true },
    { to: '/topology', icon: Network, label: 'Topologie' },
  ] },
  { title: 'Inventaire', items: [{ to: '/devices', icon: HardDrive, label: 'Appareils' }] },
  { title: 'Configuration', needsDevice: true, items: [
    { to: '/config/system', icon: Cpu, label: 'Système' },
    { to: '/config/interfaces', icon: Cable, label: 'Interfaces' },
    { to: '/config/vlans', icon: Waypoints, label: 'VLANs' },
    { to: '/config/routing', icon: RouteIcon, label: 'Routage' },
    { to: '/config/nat', icon: Shuffle, label: 'NAT' },
    { to: '/config/dhcp', icon: Server, label: 'DHCP' },
    { to: '/config/neighbors', icon: Radar, label: 'Voisins LLDP/CDP' },
  ] },
  { title: 'Outils', needsDevice: true, items: [
    { to: '/tools/backups', icon: Archive, label: 'Sauvegardes' },
    { to: '/tools/commands', icon: ListChecks, label: 'Commandes' },
    { to: '/tools/console', icon: TerminalSquare, label: 'Console' },
  ] },
  { title: 'Administration', items: [
    { to: '/audit', icon: ScrollText, label: 'Journal' },
    { to: '/settings', icon: SlidersHorizontal, label: 'Paramètres' },
  ] },
];

function Sidebar() {
  const { meta } = useApp();
  const [closed, setClosed] = useState(() => JSON.parse(localStorage.getItem('dd.closed') || '{}'));
  const toggle = (t) => {
    const n = { ...closed, [t]: !closed[t] };
    setClosed(n);
    localStorage.setItem('dd.closed', JSON.stringify(n));
  };
  return (
    <aside className="side">
      <div className="brand">
        <div className="logo"><GitBranch size={15} /></div>
        {meta?.settings?.appName || 'Devices Dealer'}
      </div>
      {NAV.map((g) => (
        <div key={g.title} className={`nav-group ${closed[g.title] ? 'closed' : ''}`}>
          <button className="title" onClick={() => toggle(g.title)}>
            {g.title} <ChevronDown size={13} className="chev" />
          </button>
          <div className="items">
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <i.icon size={16} strokeWidth={1.7} /> {i.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
      <div className="foot">v0.1 · SSH &amp; console</div>
    </aside>
  );
}

function Topbar() {
  const { devices, active, activeId, setActiveId, meta, loadMeta, setUser, toast, sessions, connecting, connectDevice, disconnectDevice } = useApp();
  const { pathname } = useLocation();
  const needsDevice = pathname.startsWith('/config') || pathname.startsWith('/tools');
  const [saving, setSaving] = useState(false);
  const real = devices.filter((d) => !d.virtual);
  const theme = meta?.settings?.theme;

  const saveConfig = async () => {
    setSaving(true);
    try {
      await api.post(`/api/devices/${active.id}/save`);
      toast('Configuration enregistrée sur l’équipement');
    } catch (e) {
      toast(e.message, 'err');
    }
    setSaving(false);
  };

  return (
    <div className="topbar">
      {needsDevice && (
        <div className="active-dev">
          {active && <DeviceIcon type={active.type} />}
          <select value={activeId} onChange={(e) => setActiveId(e.target.value)} style={{ width: 220 }}>
            <option value="">— choisir un appareil —</option>
            {real.map((d) => <option key={d.id} value={d.id}>{sessions.includes(d.id) ? '● ' : ''}{d.name}</option>)}
          </select>
          {active && (sessions.includes(active.id)
            ? <button onClick={() => disconnectDevice(active.id)} title="Fermer la connexion"><Unplug size={15} /> Déconnecter</button>
            : <button className="primary" disabled={connecting === active.id} onClick={() => connectDevice(active.id)}>{connecting === active.id ? <Loader2 size={15} className="spin" /> : <Plug size={15} />} Connecter</button>)}
        </div>
      )}
      <div className="spacer" />
      {needsDevice && active && sessions.includes(active.id) && pathname.startsWith('/config') && (
        <button onClick={saveConfig} disabled={saving} title="write memory / save">
          <Save size={15} /> Enregistrer la config
        </button>
      )}
      <button className="icon" title="Thème" onClick={async () => { await api.put('/api/settings', { theme: theme === 'light' ? 'dark' : 'light' }); loadMeta(); }}>
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
      </button>
      <button className="icon" title="Déconnexion" onClick={async () => { await api.post('/api/auth/logout'); setUser(null); }}>
        <LogOut size={16} />
      </button>
    </div>
  );
}

export default function App() {
  const { user } = useApp();
  const { pathname } = useLocation();
  if (user === undefined) return null;
  if (!user) return <Login />;
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar />
        <div className={`content ${pathname === '/topology' ? 'flush' : ''}`}>
          <ErrorBoundary resetKey={pathname}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/topology" element={<Topology />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/config/system" element={<SystemPage />} />
            <Route path="/config/interfaces" element={<InterfacesPage />} />
            <Route path="/config/vlans" element={<VlansPage />} />
            <Route path="/config/routing" element={<RoutingPage />} />
            <Route path="/config/nat" element={<NatPage />} />
            <Route path="/config/dhcp" element={<DhcpPage />} />
            <Route path="/config/neighbors" element={<NeighborsPage />} />
            <Route path="/tools/backups" element={<BackupsPage />} />
            <Route path="/tools/commands" element={<CommandsPage />} />
            <Route path="/tools/console" element={<ConsolePage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
