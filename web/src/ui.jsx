import { useEffect } from 'react';
import { Router, Layers3, Shield, Wifi, Server, Monitor, Cloud, Box, X, Loader2, AlertTriangle } from 'lucide-react';

export const TYPE_META = {
  router: { icon: Router, label: 'Routeur' },
  switch: { icon: Layers3, label: 'Switch' },
  firewall: { icon: Shield, label: 'Pare-feu' },
  ap: { icon: Wifi, label: 'Point d’accès' },
  server: { icon: Server, label: 'Serveur' },
  pc: { icon: Monitor, label: 'Poste / PC' },
  cloud: { icon: Cloud, label: 'Internet / Cloud' },
  other: { icon: Box, label: 'Autre' },
};

export function DeviceIcon({ type, size = 18 }) {
  const Icon = (TYPE_META[type] || TYPE_META.other).icon;
  return <Icon size={size} strokeWidth={1.6} />;
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <header>
          <h3>{title}</h3>
          <button className="icon" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children }) => (
  <label className="field">
    <span>{label}</span>
    {children}
    {hint && <small>{hint}</small>}
  </label>
);

export const PageHeader = ({ title, subtitle, children }) => (
  <div className="page-head">
    <div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    <div className="actions">{children}</div>
  </div>
);

export const Spinner = ({ label = 'Connexion à l’équipement…' }) => (
  <div className="state"><Loader2 className="spin" size={18} /> {label}</div>
);

export const ErrorBox = ({ message, onRetry }) => (
  <div className="state error">
    <AlertTriangle size={18} /> <span>{message}</span>
    {onRetry && <button className="ghost" onClick={onRetry}>Réessayer</button>}
  </div>
);

export const Empty = ({ children }) => <div className="state muted">{children}</div>;

export const Dot = ({ on, unknown }) => <span className={`dot ${unknown ? 'unknown' : on ? 'on' : 'off'}`} />;

/** Affiche le détail d'un push de configuration (commandes + erreurs). */
export function PushResult({ result, onClose }) {
  return (
    <Modal title={result.ok ? 'Configuration appliquée' : 'Appliquée avec des erreurs'} onClose={onClose} wide footer={<button className="primary" onClick={onClose}>OK</button>}>
      {result.errors?.length > 0 && (
        <div className="errors">
          {result.errors.map((e, i) => (
            <div key={i}><code>{e.command}</code> → {e.message}</div>
          ))}
        </div>
      )}
      <p className="muted small">Commandes envoyées</p>
      <pre className="term">{result.commands?.join('\n')}</pre>
      {result.output && (
        <>
          <p className="muted small">Retour de l’équipement</p>
          <pre className="term">{result.output}</pre>
        </>
      )}
    </Modal>
  );
}
