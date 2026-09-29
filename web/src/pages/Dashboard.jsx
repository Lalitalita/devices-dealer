import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Network } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { PageHeader, DeviceIcon, Dot, TYPE_META, Empty } from '../ui.jsx';

export default function Dashboard() {
  const { devices, links, status } = useApp();
  const [audit, setAudit] = useState([]);
  useEffect(() => { api.get('/api/audit').then((a) => setAudit(a.slice(0, 6))).catch(() => {}); }, []);
  const real = devices.filter((d) => !d.virtual);
  const online = real.filter((d) => status[d.id]).length;
  const byType = Object.entries(TYPE_META).map(([k, v]) => [k, v, devices.filter((d) => d.type === k).length]).filter((x) => x[2]);

  return (
    <>
      <PageHeader title="Vue d’ensemble" subtitle="L’état de votre réseau en un coup d’œil">
        <Link to="/topology"><button><Network size={15} /> Topologie</button></Link>
        <Link to="/devices"><button className="primary"><Plus size={15} /> Ajouter un appareil</button></Link>
      </PageHeader>
      <div className="grid" style={{ marginBottom: 18 }}>
        <div className="card pad stat"><div className="n">{devices.length}</div><div className="l">appareils</div></div>
        <div className="card pad stat"><div className="n" style={{ color: 'var(--ok)' }}>{online}<span className="muted" style={{ fontSize: 16 }}> / {real.length}</span></div><div className="l">joignables</div></div>
        <div className="card pad stat"><div className="n">{links.length}</div><div className="l">liens</div></div>
        <div className="card pad stat"><div className="n">{devices.filter((d) => d.virtual).length}</div><div className="l">machines vides</div></div>
      </div>
      <div className="split">
        <div className="card">
          <div className="card pad" style={{ border: 0, paddingBottom: 6 }}><b>Parc</b></div>
          {!devices.length && <Empty>Aucun appareil. Commencez par en ajouter un.</Empty>}
          {byType.map(([k, v, n]) => (
            <div key={k} className="name-cell" style={{ padding: '8px 18px' }}>
              <div className="ico"><DeviceIcon type={k} /></div><span>{v.label}</span><span className="tag" style={{ marginLeft: 'auto' }}>{n}</span>
            </div>
          ))}
          {real.slice(0, 8).map((d) => (
            <div key={d.id} style={{ padding: '6px 18px' }}><Dot on={status[d.id]} unknown={status[d.id] === undefined} />{d.name} <span className="muted mono small">{d.host || d.serialPath}</span></div>
          ))}
        </div>
        <div className="card">
          <div className="card pad" style={{ border: 0, paddingBottom: 6 }}><b>Dernières actions</b></div>
          {!audit.length && <Empty>Rien pour l’instant.</Empty>}
          {audit.map((a, i) => (
            <div key={i} style={{ padding: '7px 18px' }}>
              <span className={a.ok ? '' : 'muted'}>{a.ok ? '✓' : '✕'}</span> <b>{a.device}</b> · {a.action}
              <div className="muted small">{new Date(a.ts).toLocaleString()} · {a.user}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
