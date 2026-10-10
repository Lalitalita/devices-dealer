import { Link } from 'react-router-dom';
import { Plug, Loader2 } from 'lucide-react';
import { useApp, useRemote } from '../store.jsx';
import { PageHeader, Spinner, ErrorBox, Empty, DeviceIcon } from '../ui.jsx';

export const driverSupports = (meta, dev, cap) => !!meta?.drivers.find((d) => d.id === dev.vendor)?.capabilities.includes(cap);

export function ConnectCard({ device }) {
  const { connectDevice, connecting } = useApp();
  const busy = connecting === device.id;
  return (
    <div className="card state" style={{ flexDirection: 'column', gap: 14, padding: 48 }}>
      <Plug size={26} />
      <div>Pas de connexion ouverte avec <b>{device.name}</b>.</div>
      <div className="muted small">La connexion reste ouverte pendant que vous naviguez, jusqu’à la déconnexion.</div>
      <button className="primary" disabled={busy} onClick={() => connectDevice(device.id)}>
        {busy ? <Loader2 size={15} className="spin" /> : <Plug size={15} />} Se connecter
      </button>
    </div>
  );
}

/**
 * Page de config liée à l'appareil actif. Aucune commande n'est envoyée tant que l'appareil
 * n'est pas connecté, puis chaque lecture est mise en cache.
 */
export function DevicePage({ title, subtitle, endpoint, actions, children, supports, local = false }) {
  const { active, meta, sessions } = useApp();
  const connected = !!active && sessions.includes(active.id);
  const ok = !!active && (!supports || driverSupports(meta, active, supports)) && (local || connected);
  const remote = useRemote(ok && endpoint ? `/api/devices/${active.id}/${endpoint}` : null);

  const head = (
    <PageHeader title={title} subtitle={active ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><DeviceIcon type={active.type} size={14} /> {active.name}{subtitle ? ` · ${subtitle}` : ''}</span> : subtitle}>
      {ok && actions?.(remote)}
    </PageHeader>
  );

  if (!active) return <>{head}<div className="card"><Empty>Choisissez un appareil dans la barre du haut, ou <Link to="/devices" style={{ color: 'var(--accent)' }}>ajoutez-en un</Link>.</Empty></div></>;
  if (supports && !driverSupports(meta, active, supports)) {
    return <>{head}<div className="card"><Empty>Cette fonction n’est pas encore disponible pour « {active.vendor} ». Utilisez <Link to="/tools/commands" style={{ color: 'var(--accent)' }}>Commandes</Link> ou la <Link to="/tools/console" style={{ color: 'var(--accent)' }}>Console</Link>.</Empty></div></>;
  }
  if (!local && !connected) return <>{head}<ConnectCard device={active} /></>;

  const waiting = endpoint && (remote.loading && remote.data == null);
  return (
    <>
      {head}
      {waiting && !remote.error ? <div className="card"><Spinner label="Lecture sur l’équipement…" /></div>
        : remote.error ? <div className="card"><ErrorBox message={remote.error} onRetry={remote.reload} /></div>
        : endpoint && remote.data == null ? null
        : children(remote.data, remote.reload)}
    </>
  );
}
