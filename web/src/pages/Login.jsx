import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../store.jsx';

export default function Login() {
  const { setUser } = useApp();
  const [f, setF] = useState({ username: 'admin', password: '' });
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/api/auth/login', f);
      setUser(r.user);
    } catch (e2) {
      setErr(e2.message);
    }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="logo"><GitBranch size={20} /></div>
        <h1>Devices Dealer</h1>
        <p className="muted" style={{ marginBottom: 20 }}>Administration du parc réseau</p>
        <label className="field"><span>Identifiant</span><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoFocus /></label>
        <label className="field"><span>Mot de passe</span><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        {err && <div className="errors">{err}</div>}
        <button className="primary" style={{ width: '100%', justifyContent: 'center' }}>Connexion</button>
      </form>
    </div>
  );
}
