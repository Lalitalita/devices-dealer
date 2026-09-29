import { signToken, verifyToken, hashPassword, verifyPassword } from './crypto.js';
import { HttpError } from './util.js';

const COOKIE = 'dd_session';
const TTL = 12 * 3600 * 1000;
const fails = new Map();

export function registerAuth(app, store, config) {
  const s = store.data.settings;
  if (!s.passwordHash) {
    let pw = config.adminPassword;
    if (!pw) {
      pw = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
      console.log(`\n  ╭─ Premier lancement ─────────────────────────\n  │ Identifiant  : ${config.adminUser}\n  │ Mot de passe : ${pw}\n  ╰─ (défini via ADMIN_PASSWORD pour le fixer)\n`);
    }
    s.passwordHash = hashPassword(pw);
    store.flush();
  }

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') || url === '/api/auth/login' || url === '/api/health') return;
    const p = verifyToken(req.cookies?.[COOKIE]);
    if (!p) return reply.code(401).send({ error: 'Non authentifié' });
    req.user = p.u;
  });

  app.post('/api/auth/login', async (req, reply) => {
    const ip = req.ip;
    const f = fails.get(ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) throw new HttpError(429, 'Trop de tentatives, réessayez dans une minute');
    const { username, password } = req.body || {};
    if (username !== config.adminUser || !verifyPassword(String(password || ''), s.passwordHash)) {
      f.n++;
      if (f.n >= 5) Object.assign(f, { n: 0, until: Date.now() + 60000 });
      fails.set(ip, f);
      throw new HttpError(401, 'Identifiants invalides');
    }
    fails.delete(ip);
    reply.setCookie(COOKIE, signToken({ u: username, exp: Date.now() + TTL }), {
      httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/', maxAge: TTL / 1000,
    });
    return { user: username };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: req.user }));

  app.post('/api/auth/password', async (req) => {
    const { current, next } = req.body || {};
    if (!verifyPassword(String(current || ''), s.passwordHash)) throw new HttpError(400, 'Mot de passe actuel incorrect');
    if (String(next || '').length < 8) throw new HttpError(400, 'Minimum 8 caractères');
    s.passwordHash = hashPassword(next);
    store.flush();
    return { ok: true };
  });
}
