import path from 'node:path';

export const config = {
  port: Number(process.env.PORT) || 8080,
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  secretKey: process.env.SECRET_KEY || '',
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  webDir: path.resolve(process.env.WEB_DIR || '../web/dist'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
};
