import { HttpError, safe } from '../util.js';

export function appRoutes(app, store) {
  const s = store.data.settings;

  app.put('/api/settings', async (req) => {
    const b = req.body || {};
    if (b.appName !== undefined) s.appName = safe(b.appName, 'nom').slice(0, 40) || 'Devices Dealer';
    if (b.accent !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(b.accent)) throw new HttpError(400, 'Couleur invalide');
      s.accent = b.accent;
    }
    if (b.theme !== undefined) s.theme = ['dark', 'light'].includes(b.theme) ? b.theme : 'dark';
    store.save();
    return { ...s, passwordHash: undefined };
  });

  app.get('/api/audit', async () => store.data.audit);
  app.get('/api/health', async () => ({ ok: true }));
}
