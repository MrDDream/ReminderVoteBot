# ReminderVoteBot ????

![Node.js](https://img.shields.io/badge/Node.js-18%2B-3C873A?style=flat&logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat&logo=discord&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-0db7ed?style=flat&logo=docker&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

Need English? ?? [Switch to the EN version](README.md).

ReminderVoteBot rappelle vos joueurs de voter sans polluer vos salons. Tout passe par des slash commands : choix du serveur de vote, fenêtre horaire en pas de 30 min, fuseau horaire et mode de livraison (DM ou ping canal).

## ? En bref
- ?? Rappels ultra-personnalisés (fenêtre, timezone, cooldown par URL, DM ou canal avec fallback auto).
- ?? Interface FR/EN et gestion multi-URLs via `/addvote` + `/listvote`.
- ?? Boutons intelligents : `Voter maintenant` ouvre l'URL (ou la redirection signée), `Relancer le timer` repart sur un nouveau cooldown.
- ?? Petit serveur Express pour `/health` et `/v?t=...` afin de suivre les clics.
- ?? Image publique prête à l'emploi `ghcr.io/mrddream/remindervotebot:latest` + volume persistant `data/`.

## ?? Démarrage express (Docker recommandé)
1. Créez un `.env` à côté du `docker-compose.yml` :
   ```env
   DISCORD_TOKEN=xxxxxxxx
   CLIENT_ID=yyyyyyyy
   GUILD_ID=id_serveur_optionnel
   BOT_LANG=fr
   DEFAULT_TZ=Europe/Paris
   ```
2. Lancez l'image publique :
   ```bash
   docker compose pull
   docker compose up -d
   ```
   Le compose pointe déjà sur `ghcr.io/mrddream/remindervotebot:latest` et monte le volume `bot_data`.
3. Déployez les slash commands (immédiat en guild, jusqu'à 1h en global) :
   ```bash
   docker compose run --rm bot node src/deploy-commands.js
   ```
4. Suivez les logs avec `docker compose logs -f bot`. Les données survivent dans `bot_data`.

## ????? En local (Node)
```bash
git clone https://github.com/<votre-org>/ReminderVoteBot.git
cd ReminderVoteBot
npm install
cp .env.example .env  # ou créez-le manuellement
npm run deploy:commands
npm start
```

## ?? Variables d'env
| Variable | Obligatoire | Rôle |
| --- | --- | --- |
| `DISCORD_TOKEN` | ? | Token du bot (Portail Discord > Bot). |
| `CLIENT_ID` | ? | ID de l'application. |
| `GUILD_ID` | ? | ID du serveur pour un déploiement instantané des commandes. |
| `DEFAULT_VOTE_URL` | ? | URL de vote par défaut (seed de `config.json`). |
| `DEFAULT_TZ` | ? | Fuseau par défaut (`Europe/Paris` recommandé). |
| `BOT_LANG` | ? | `fr` ou `en`. |
| `FORCE_DELIVERY_MODE` | ? | Forcer `dm` ou `channel`. |
| `PUBLIC_BASE_URL` | ? | Domaine public pour les redirections signées. |
| `MARK_SECRET` | ? | Secret HMAC (requis si `PUBLIC_BASE_URL`). |
| `PORT` | ? | Port Express (3000 par défaut). |

Les `DEFAULT_*` ne servent qu'à initialiser `data/config.json` au premier run. Ajustez ensuite via `/listvote`.

## ?? Slash commands
| Commande | Action |
| --- | --- |
| `/subscribe` | Flow interactif pour choisir serveur, fenêtre, mode, fuseau. |
| `/unsubscribe` | Supprimer un abonnement ou tous. |
| `/status` | Visualiser/éditer ses abonnements actifs. |
| `/addvote` *(Manage Guild)* | Ajouter une URL de vote (libellé, URL, cooldown, salon). |
| `/listvote` *(Manage Guild)* | Gérer les URLs : changer d'URL, de salon, réassigner ou supprimer. |

Tous les menus/boutons sont éphémères ? pas de spam dans les salons publics.

## ?? Comment ça marche ?
1. Cron par abonnement (toutes les minutes) aligné sur son timezone.
2. Exécution uniquement dans la fenêtre `start/end` (support des fenêtres nocturnes).
3. Cooldown basé sur `lastReminderAt` + `lastVotedAt`.
4. Mode canal tombe en DM si les permissions cassent.
5. Boutons = ouverture ou reset instantané du timer.
6. Avec `PUBLIC_BASE_URL`, chaque clic passe par `/v?t=...` avant redirection.

## ?? Données & endpoints HTTP
- `data/config.json` : URLs de vote, timezone, mode forcé.
- `data/subscriptions.json` : un enregistrement par abonnement (schema v4, migration auto des anciens formats).
- Express expose :
  - `GET /` ? `OK`
  - `GET /health` ? `{ ok: true }`
  - `GET /v?t=TOKEN` ? vérifie la signature, met à jour `lastVotedAt`, ajoute `?pseudo=<displayName>` puis redirige.

## ?? Astuces dépannage
- ?? Pas de slash commands ? Relancez `npm run deploy:commands` (ou la commande Docker) et patientez jusqu'à 1h sans `GUILD_ID`.
- ?? DM refusés ? Proposez le mode canal ou demandez aux joueurs d'activer les MP serveur.
- ?? Aucun rappel ? Vérifiez que les URLs sont renseignées, que `/subscribe` a été confirmé, et que l'heure actuelle est dans la fenêtre.
- ??? Salon supprimé ? `/listvote` permet d'en choisir un autre; le bot bascule en DM en attendant.
- ?? Logs ? `docker compose logs -f bot` (ou la sortie console en local).

## ?? Licence
Licence [MIT](LICENSE). Forkez, adaptez, déployez ?
