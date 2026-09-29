import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = () => ({
  version: 1,
  settings: { appName: 'Devices Dealer', accent: '#6d8cff', theme: 'dark', passwordHash: '' },
  devices: [],
  links: [],
  audit: [],
});

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    this.data = DEFAULTS();
    if (fs.existsSync(this.file)) {
      this.data = { ...DEFAULTS(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    }
    this.timer = null;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 100);
  }

  flush() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  audit(entry) {
    this.data.audit.unshift({ ts: new Date().toISOString(), ...entry });
    this.data.audit.length = Math.min(this.data.audit.length, 500);
    this.save();
  }
}
