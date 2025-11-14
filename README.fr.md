# ReminderVoteBot

![Node.js](https://img.shields.io/badge/Node.js-18%2B-3C873A?style=flat&logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat&logo=discord&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-0db7ed?style=flat&logo=docker&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

Bot Discord cle-en-main qui rappelle vos joueurs de voter via DM ou ping salon, avec fenetres horaires, cooldowns personnalises et support fr/en. Ideal pour les serveurs qui veulent maximiser leurs votes Top-Serveurs ou similaires sans spammer manuellement.

## Sommaire
- [Apercu](#apercu)
- [Fonctionnalites cles](#fonctionnalites-cles)
- [Architecture eclair](#architecture-eclair)
- [Prerequis](#prerequis)
- [Installation rapide](#installation-rapide)
- [Configuration (.env)](#configuration-env)
- [Commandes npm](#commandes-npm)
- [Slash commands cote Discord](#slash-commands-cote-discord)
- [Cycle de rappel](#cycle-de-rappel)
- [Persistance des donnees](#persistance-des-donnees)
- [Deploiement Docker](#deploiement-docker)
- [HTTP helper & suivi des votes](#http-helper--suivi-des-votes)
- [Depannage express](#depannage-express)
- [Licence](#licence)

## Apercu
ReminderVoteBot stocke les abonnements dans `data/subscriptions.json`, gere les URLs de vote dans `data/config.json`, et declenche les rappels via `node-cron`. Chaque joueur peut choisir:
- Le serveur/vote cible (plusieurs URLs sont supportees).
- Une fenetre de temps quotidienne (par pas de 30 min) et un fuseau horaire.
- Le canal de reception: DM ou ping dans un salon dedie.

Les admins pilotent tout via slash commands et modales dans Discord, sans editer de fichier.

## Fonctionnalites cles
- Rappels personnalises par utilisateur avec fenetre, timezone et cooldown par serveur.
- Bouton `Vote now` + bouton `Relancer le timer` qui marque un vote sans quitter Discord.
- Multi-serveurs: ajoutez plusieurs URLs de vote, chacune avec son salon cible et son propre cooldown.
- Mode DM ou channel force via `FORCE_DELIVERY_MODE`, avec fallback automatique sur DM si le canal echoue.
- Localisation fr/en (`BOT_LANG`), textes coherents dans tout le parcours slash commands.
- Mini serveur HTTP pour `/health` et `/v?t=...` afin de tracer les clics via un domaine public.
- Docker compose pret a l'emploi avec volume persistant `bot_data`.

## Architecture eclair
| Element | Description |
| --- | --- |
| `src/index.js` | Coeur du bot: interactions Discord, calendrier, redirections HTTP. |
| `src/deploy-commands.js` | Publication des slash commands (global ou guild). |
| `src/config.js` | Chargement/sauvegarde de `data/config.json`, valeurs par defaut depuis `.env`. |
| `src/storage.js` | Persistance des abonnements (schema v4) et migrations legacy. |
| `docker-compose.yml` | Service unique `bot` avec volume `bot_data` et port HTTP. |
| `Dockerfile` | Image Node 20 alpine, installe uniquement les deps prod. |
| `data/` | Cree automatiquement; contient config + subscriptions (JSON prettifies). |

## Prerequis
- Node.js 18+ (ou runtime compatible dans Docker).
- Application Discord avec bot invite sur votre serveur avec scopes `bot` & `applications.commands`.
- Permissions `Send Messages`, `Manage Messages`, `Use Slash Commands`, et `Send Messages in Threads` si vous ciblez des salons.
- (Optionnel) Nom de domaine/public URL si vous souhaitez signer les clics de vote (`PUBLIC_BASE_URL`).

## Installation rapide
```bash
git clone https://github.com/<votre-org>/ReminderVoteBot.git
cd ReminderVoteBot
npm install
cp .env.example .env    # si vous avez un template ; sinon creez le fichier manuellement
```
1. Renseignez toutes les variables requises (voir tableau ci-dessous).
2. Deployer les slash commands:
   ```bash
   npm run deploy:commands
   ```
   - Avec `GUILD_ID`, la publication est immediate sur ce serveur.
   - Sans `GUILD_ID`, Discord peut prendre jusqu'a 1h pour propager globalement.
3. Lancer le bot:
   ```bash
   npm start
   ```

## Configuration (.env)
| Variable | Obligatoire | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | Oui | Token du bot Discord (onglet Bot). |
| `CLIENT_ID` | Oui | ID de l'application (onglet General Information). |
| `GUILD_ID` | Optionnel | ID du serveur pour deploiement rapide des commandes (laisser vide = global). |
| `DEFAULT_VOTE_URL` | Optionnel | URL de vote pre-remplie au premier demarrage; peut etre changee ensuite via `/addvote`. |
| `DEFAULT_TZ` | Optionnel | Fuseau horaire par defaut (ex: `Europe/Paris`). |
| `BOT_LANG` | Optionnel | `fr` ou `en`. Controle tous les textes slash/DM. |
| `FORCE_DELIVERY_MODE` | Optionnel | `dm` ou `channel`. Si defini, force ce mode pour tous les nouveaux abonnements. |
| `PUBLIC_BASE_URL` | Optionnel | URL publique (https://vote.example.com). Active les redirections signees `/v?t=...`. |
| `MARK_SECRET` | Optionnel | Cle HMAC pour signer les tokens de redirection (obligatoire si `PUBLIC_BASE_URL`). |
| `PORT` | Optionnel | Port HTTP pour Express (`3000` par defaut). |

Notes:
- Les valeurs `DEFAULT_*` ne servent qu'a initialiser `data/config.json`. Modifiez ensuite ce fichier ou utilisez `/listvote`.
- Les secrets (`DISCORD_TOKEN`, `MARK_SECRET`) ne doivent jamais etre commit.

## Commandes npm
| Script | Action |
| --- | --- |
| `npm start` | Lance le bot (Discord + serveur HTTP). |
| `npm run deploy:commands` | Publie/actualise les slash commands via REST. |

## Slash commands cote Discord
| Commande | Role |
| --- | --- |
| `/subscribe` | Ouvre une session interactive: choix du serveur de vote, fenetre horaire (pas de 30 min), mode DM/channel, puis validation. |
| `/unsubscribe` | Supprime tous les rappels ou un abonnement specifique via select menu. |
| `/status` | Affiche un resume de vos abonnements, permet d'en modifier un (mode, fenetre) ou de le supprimer. |
| `/addvote` | (Manage Guild) Modale pour ajouter une URL de vote: libelle, URL, cooldown (minutes) et salon cible optionnel. |
| `/listvote` | (Manage Guild) Tableau de bord des URLs: selection, mise a jour du canal, changement d'URL, suppression avec reassignment automatique des abonnes. |

Tous les menus/boutons sont ephimeres afin d'eviter le spam dans les salons publics.

## Cycle de rappel
1. **Planification minutieuse**: chaque abonnement possede une tache `node-cron` (toutes les minutes) limitee au fuseau stocke dans la subscription.
2. **Fenetre quotidienne**: les rappels ne se declenchent qu'entre `window.start` et `window.end` (support des fenetres qui traversent minuit).
3. **Cooldown par entree de vote**: definissez `cooldownMinutes` pour chaque URL (ex: 120 min). Le compteur est alimente par `lastReminderAt` et `lastVotedAt`.
4. **DM ou salon**: si le mode `channel` echoue (permissions, channel supprime), le bot repasse automatiquement en DM et log l'erreur.
5. **Boutons intelligents**: `Vote now` ouvre l'URL (ou la redirection signee). `Relancer le timer` marque un vote immediatement et reset le cooldown.
6. **Tracking optionnel**: avec `PUBLIC_BASE_URL`, chaque clic passe par `/v?t=...` qui met a jour `lastVotedAt` avant de rediriger.

## Persistance des donnees
- `data/config.json` : configuration globale (liste des URLs, timezone, mode force). Cree automatiquement si absent.
- `data/subscriptions.json` : liste schema v4 (un enregistrement par abonnement). `storage.js` migre les anciens formats (`subscribers.json`, etc.).
- Les fichiers sont prettifies pour faciliter le debugging manuel. Sauvegarde apres chaque modification via slash commands.
- Avec Docker, le volume `bot_data` conserve ces fichiers entre les redemarrages.

## Deploiement Docker
1. Creez un `.env` aux racines (le compose lit directement vos variables shell).
2. Construisez et lancez:
   ```bash
   docker compose up -d --build
   ```
3. Publiez les commandes (selon votre besoin):
   ```bash
   docker compose run --rm bot node src/deploy-commands.js
   ```
4. Les donnees vivent dans `bot_data` (volume). Pour mettre a jour une variable, modifiez `.env` puis `docker compose up -d` pour recreer le conteneur.

Le port expose `PORT` (par defaut 3000) pour `/health` et `/v`. Ajustez la redirection dans votre reverse proxy si besoin d'un domaine public.

## HTTP helper & suivi des votes
Le bot embarque un mini serveur Express:
- `GET /` : renvoie `OK` (pratique pour monitorer que le conteneur tourne).
- `GET /health` : JSON `{ ok: true }`.
- `GET /v?t=<token>` : valide la signature HMAC, marque `lastVotedAt` puis redirige vers la veritable URL de vote avec `?pseudo=<displayName>`.

Activez cette fonctionnalite en definissant `PUBLIC_BASE_URL` (l'URL qui expose ce serveur) et `MARK_SECRET`. Les boutons `Vote now` pointeront alors vers votre domaine pour comptabiliser les clics.

## Depannage express
- **Les slash commands n'apparaissent pas** : verifiez `CLIENT_ID`, relancez `npm run deploy:commands`. Sans `GUILD_ID`, patientez jusqu'a 1h.
- **Bot en ligne mais aucun rappel** : assurez-vous que chaque entree de vote a une URL, que les users ont valide `/subscribe` et que la fenetre horaire inclut le moment courant.
- **MP bloques** : Discord refuse les DMs si l'utilisateur a desactive les messages du serveur. Dans ce cas, proposez le mode `channel`.
- **URL multiple par serveur** : utilisez `/addvote` pour dupliquer une entree avec un cooldown different, puis `/listvote` pour assigner un salon.
- **Logs** : toutes les actions notables (erreurs, rappels, redirections) sont journalisees en console. Pensez a raccorder votre hebergeur a ces logs.

## Licence
Distribue sous licence [MIT](LICENSE). Vous etes libres de cloner, modifier et deployer tant que la licence reste intacte.
