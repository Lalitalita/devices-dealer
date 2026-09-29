import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config.js';
import { initKey } from './crypto.js';
import { Store } from './store.js';
import { registerAuth } from './auth.js';
import { devicesRoutes } from './routes/devices.js';
import { opsRoutes } from './routes/ops.js';
import { appRoutes } from './routes/app.js';

export async function buildApp(cfg = config) {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  initKey(cfg.dataDir, cfg.secretKey);
  const store = new Store(cfg.dataDir);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: 1024 * 1024 });

  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket);

  app.setErrorHandler((err, _req, reply) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500 && !err.status) app.log.error(err);
    reply.code(status).send({ error: err.message });
  });

  registerAuth(app, store, cfg);
  devicesRoutes(app, store);
  opsRoutes(app, store);
  appRoutes(app, store);

  if (fs.existsSync(cfg.webDir)) {
    await app.register(fastifyStatic, { root: cfg.webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Introuvable' });
      return reply.sendFile('index.html');
    });
  }
  app.addHook('onClose', async () => store.flush());
  return { app, store };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app } = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
}
