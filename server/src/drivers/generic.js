/** Autres marques : terminal, commandes libres et sauvegarde de config uniquement. */
export default {
  id: 'generic',
  label: 'Autre marque (terminal & commandes libres)',
  prompt: /^[^\s].*[>#$%\]]\s*$/,
  enable: false,
  init: [],
  configEnter: [],
  configExit: [],
  save: '',
  errorRe: /(?!)/,
  read: {
    async config(cli) {
      return cli.run('show running-config', { timeout: 60000 });
    },
  },
  write: {},
};
