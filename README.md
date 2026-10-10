# Devices Dealer

Administration visuelle de routeurs et switchs (Cisco, HP/HPE, et autres marques) — **tout passe par SSH ou par la console**, rien n'est installé sur les équipements.

- **Appareils** : ajout / modification / suppression, mots de passe chiffrés (AES-256-GCM)
- **Machines vides** : postes utilisateurs, imprimantes… sans connexion, juste pour le schéma
- **Topologie automatique** : découverte LLDP/CDP → appareils + liens créés tout seuls, mise en page auto (dagre), glisser-déposer, liens manuels (tirer d'un nœud à l'autre)
- **Connexion persistante** : on choisit l'appareil, on clique *Connecter*, la connexion reste ouverte (changement d'onglet sans reconnexion, lectures mises en cache) jusqu'à *Déconnecter* ou 30 min d'inactivité (`SESSION_IDLE_MIN`)
- **Volet de gauche façon OPNsense** : Système, Interfaces (VLAN par port, sous-interfaces), VLANs, Routage, **NAT** (assistant PAT, redirections), **DHCP**, Voisins, Sauvegardes, Commandes, Console
- **Console web** (xterm.js) via SSH, console réseau (ser2net/serveur console, TCP/telnet) ou port série local (`/dev/ttyUSB0`)
- **Sauvegardes** de la running-config avec notes, **comparaison** (entre sauvegardes ou avec l'état actuel) et **réinjection** (aperçu des commandes, sauvegarde de sécurité automatique)
- **Journal** de toutes les commandes envoyées
- Thème sombre/clair, nom et couleur d'accent personnalisables

## Démarrage

```bash
docker compose up -d --build
# → http://localhost:8080
```

Sans `ADMIN_PASSWORD`, un mot de passe aléatoire est affiché au premier lancement : `docker compose logs devices-dealer`.
Pour le fixer : `ADMIN_PASSWORD=monmotdepasse docker compose up -d` (ou un fichier `.env`).

Essayer sans matériel : `docker compose --profile demo up -d --build`, puis ajouter un appareil *Cisco IOS*, hôte `cisco-demo`, port `2222`, `admin` / `admin`, et cliquer **Topologie → Découvrir**.

| Variable | Rôle |
|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | Identifiants de l'interface (défaut `admin` / aléatoire) |
| `SECRET_KEY` | Clé de chiffrement des secrets ; sinon générée dans `./data/secret.key` |
| `COOKIE_SECURE` | `true` derrière un reverse proxy HTTPS |
| `SESSION_IDLE_MIN` | Minutes d'inactivité avant fermeture d'une connexion (30) |
| `PORT`, `DATA_DIR` | Port (8080) et dossier de données (`/data`) |

Toutes les données (inventaire, liens, sauvegardes, journal, clé) sont dans `./data`.

**Console série locale** : décommenter `devices:` dans `docker-compose.yml`, puis appareil → connexion *Console série locale* (`/dev/ttyUSB0`, 9600 bauds en général). La console est aussi utilisable à travers un serveur console (connexion *TCP/telnet*).

## Compatibilité

| Marque | Lecture / écriture (interfaces, VLANs, routes, hostname, voisins) | Terminal, commandes libres, sauvegarde |
|---|---|---|
| Cisco IOS / IOS-XE (switch, routeur) | ✅ testé sur un switch simulé ; NAT / DHCP / sous-interfaces : parseurs testés | ✅ |
| HP ProCurve / Aruba OS-Switch | ⚠️ écrit d'après la doc, **non testé sur matériel** | ✅ |
| HPE Comware / H3C | ⚠️ idem | ✅ |
| Autres marques | — | ✅ (Console + Commandes) |

Ajouter une marque = un fichier dans `server/src/drivers/` (commandes + parseurs) ; voir `cisco_ios.js`.

## Sécurité

- Authentification obligatoire, cookie `HttpOnly` + `SameSite=Strict`, limitation des tentatives.
- Les valeurs saisies sont refusées si elles contiennent des retours à la ligne (pas d'injection de commandes).
- Empreinte SSH mémorisée à la première connexion (TOFU) ; refus si elle change.
- Les algorithmes SSH anciens (`ssh-rsa`, `diffie-hellman-group1-sha1`, CBC…) sont acceptés en dernier recours pour les vieux équipements.
- À exposer uniquement sur un réseau de confiance ou derrière un reverse proxy HTTPS.

## Développement

```bash
cd server && npm i && npm test          # tests e2e contre un switch Cisco simulé
cd server && npm run emulator           # faux switch sur :2222
cd server && npm run dev                # API sur :8080
cd web && npm i && npm run dev          # UI sur :5173 (proxy vers :8080)
```
