import { Link } from 'react-router-dom';
import { useApp, useRemote } from '../store.jsx';
import { PageHeader, Spinner, ErrorBox, Empty, DeviceIcon } from '../ui.jsx';

/** Page de config liée à l'appareil actif : gère "aucun appareil", chargement et erreur. */
export function DevicePage({ title, subtitle, endpoint, actions, children, supports }) {
  const { active, meta } = useApp();
  const remote = useRemote(active && endpoint && (!supports || driverSupports(meta, active, supports)) ? `/api/devices/${active.id}/${endpoint}` : null);

  const head = (
    <PageHeader title={title} subtitle={active ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><DeviceIcon type={active.type} size={14} /> {active.name}{subtitle ? ` · ${subtitle}` : ''}</span> : subtitle}>
      {actions?.(remote)}
    </PageHeader>
  );

  if (!active) return <>{head}<div className="card"><Empty>Choisissez un appareil dans la barre du haut, ou <Link to="/devices" style={{ color: 'var(--accent)' }}>ajoutez-en un</Link>.</Empty></div></>;
  if (supports && !driverSupports(meta, active, supports)) {
    return <>{head}<div className="card"><Empty>Cette fonction n’est pas encore disponible pour « {active.vendor} ». Utilisez <Link to="/tools/commands" style={{ color: 'var(--accent)' }}>Commandes</Link> ou la <Link to="/tools/console" style={{ color: 'var(--accent)' }}>Console</Link>.</Empty></div></>;
  }
  return (
    <>
      {head}
      {remote.loading && !remote.data ? <div className="card"><Spinner /></div>
        : remote.error ? <div className="card"><ErrorBox message={remote.error} onRetry={remote.reload} /></div>
        : children(remote.data, remote.reload)}
    </>
  );
}

export const driverSupports = (meta, dev, cap) => !!meta?.drivers.find((d) => d.id === dev.vendor)?.capabilities.includes(cap);
