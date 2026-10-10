import { HttpError } from './util.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Z0-9]|\x1b[=>78MDE]|\x07|\x00/g;
const MORE = /\s*(?:-{2,}\s*more\s*-{2,}(?:,\s*next page:[^\n\x1b]*?Control-C)?|<--- More --->)(?:\x1b\[[0-9;?]*[ -/]*[@-~]|[\x08 ])*/gi;

export const clean = (s) => s.replace(ANSI, '').replace(/[^\n\x08]\x08/g, '').replace(/\x08/g, '').replace(/\x1b/g, '').replace(/\r\n?/g, '\n');

/**
 * Pilote une CLI d'équipement réseau via un transport (ssh / console) :
 * détection de prompt, pagination, login console, enable, mode configuration.
 */
export class CliSession {
  constructor(transport, driver, secrets = {}, username = '') {
    this.t = transport;
    this.driver = driver;
    this.secrets = secrets;
    this.username = username;
    this.buf = '';
    this.waiter = null;
    this.closed = false;
    transport.on('data', (d) => {
      this.buf += d.toString('utf8');
      this._check();
    });
    transport.on('close', () => {
      this.closed = true;
      this._settle(new Error('Connexion fermée par l’équipement'));
    });
    transport.on('error', (e) => this._settle(e));
  }

  _settle(err, value) {
    const w = this.waiter;
    if (!w) return;
    clearTimeout(w.idle);
    clearTimeout(w.timeout);
    this.waiter = null;
    err ? w.reject(err) : w.resolve(value);
  }

  _check() {
    const w = this.waiter;
    if (!w) return;
    clearTimeout(w.idle);
    if (MORE.test(this.buf)) {
      MORE.lastIndex = 0;
      this.buf = this.buf.replace(MORE, '');
      this.t.write(' ');
      return;
    }
    MORE.lastIndex = 0;
    const text = clean(this.buf);
    const last = text.split('\n').pop();
    for (const h of w.handlers) {
      if (h.re.test(last)) {
        this.buf = '';
        this.t.write(h.send());
        return;
      }
    }
    if (w.until.test(last)) w.idle = setTimeout(() => this._settle(null, text), 150);
  }

  _expect({ until = this.driver.prompt, handlers = [], timeout = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      this.waiter = { until, handlers, resolve, reject };
      this.waiter.timeout = setTimeout(() => {
        const partial = clean(this.buf).slice(-200);
        this._settle(new HttpError(504, `Délai dépassé en attente du prompt (reçu : « ${partial.trim()} »)`));
      }, timeout);
      this._check();
    });
  }

  async init() {
    const { username, secrets } = this;
    const handlers = [
      { re: /press any key|any key to continue/i, send: () => '\r' },
      { re: /(user ?name|login)\s*:\s*$/i, send: () => `${username}\r` },
      { re: /password\s*:\s*$/i, send: () => `${secrets.password || ''}\r` },
      { re: /\(yes\/no\)\?\s*$/i, send: () => 'yes\r' },
    ];
    this.t.write('\r');
    let out = await this._expect({ handlers, timeout: 20000 });
    if (this.driver.enable && /^\S+>\s*$/.test(out.trim().split('\n').pop())) {
      this.buf = '';
      this.t.write('enable\r');
      out = await this._expect({
        handlers: [{ re: /password\s*:\s*$/i, send: () => `${secrets.enableSecret || secrets.password || ''}\r` }],
      });
    }
    await this._quiet();
    for (const c of this.driver.init || []) await this.run(c);
    return this;
  }

  /** Attend que l'équipement arrête d'écrire (bannières, prompts en double) puis vide le tampon. */
  async _quiet(ms = 400) {
    let n;
    do {
      n = this.buf.length;
      await new Promise((r) => setTimeout(r, ms));
    } while (this.buf.length !== n && !this.closed);
    this.buf = '';
  }

  /** Exécute une commande et renvoie sa sortie nettoyée (sans écho ni prompt). */
  async run(cmd, { timeout = 30000 } = {}) {
    if (this.closed) throw new HttpError(502, 'Session fermée');
    this.buf = '';
    this.t.write(cmd + '\r');
    const text = await this._expect({ timeout });
    const lines = text.split('\n');
    lines.pop(); // prompt
    if (lines.length && lines[0].includes(cmd.slice(0, 15))) lines.shift(); // écho
    return lines.join('\n').trim();
  }

  /** Passe en mode configuration, exécute, ressort. Retourne { output, errors }. */
  async configure(cmds) {
    const d = this.driver;
    const output = [];
    const errors = [];
    const send = async (c) => {
      const out = await this.run(c);
      if (out) output.push(`${c}\n${out}`);
      if (d.errorRe.test(out)) errors.push({ command: c, message: out.split('\n').find((l) => d.errorRe.test(l)) || out });
    };
    for (const c of d.configEnter) await this.run(c);
    try {
      for (const c of cmds) await send(c);
    } finally {
      for (const c of d.configExit) await this.run(c).catch(() => {});
    }
    return { output: output.join('\n'), errors };
  }

  async save() {
    if (!this.driver.save) return '';
    return this.run(this.driver.save, { timeout: 60000 });
  }

  close() {
    this.closed = true;
    try {
      this.t.close();
    } catch {
      /* ignore */
    }
  }
}
