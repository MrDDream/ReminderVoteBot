## Discord Vote Reminder Bot

Bot Discord qui envoie un MP toutes les 2 heures aux utilisateurs abonnés, avec un bouton ouvrant la page de vote. L’URL de vote est configurable.

### Fonctionnalités
- Slash commands:
  - `/subscribe [times]` : s’abonner aux rappels. Option `times` pour définir des heures quotidiennes au format `HH:mm` séparées par des virgules (ex: `08:00,12:30,20:00`). Sans `times`, rappel toutes les 2h.
  - `/unsubscribe` : se désabonner.
  - `/setvoteurl <url>` : définir l’URL de vote (réservé aux responsables du serveur).
  - `/status` : consulter la config et le nombre d’abonnés.
- Stockage local JSON pour la config et les abonnés.
- Planification par défaut: toutes les 2h (UTC).

### Prérequis
- Node.js 18+
- Créez une application/bot sur le portail Discord, invitez-le avec les scopes `bot` et `applications.commands`.

### Installation
1. Installer les dépendances:
   ```bash
   npm install
   ```
2. Créer un fichier `.env` à la racine:
   ```
   DISCORD_TOKEN=your_discord_bot_token_here
   CLIENT_ID=your_discord_application_client_id
   # Optionnel: pour déployer les commandes dans un seul serveur (plus rapide)
    GUILD_ID=your_guild_id
    # Optionnel: URL par défaut
    DEFAULT_VOTE_URL=https://top-serveurs.net/palworld/vote/fr-server-2424-splendide
    # Langue du bot (fr ou en)
    BOT_LANG=fr
   ```
3. Déployer les commandes (guild = immédiat; global = peut prendre jusqu’à 1h):
   ```bash
   npm run deploy:commands
   ```
4. Démarrer le bot:
   ```bash
   npm start
   ```

### Exécution avec Docker
1. Créez un fichier `.env` (ou exportez les variables dans votre shell) contenant au minimum:
   ```
   DISCORD_TOKEN=your_discord_bot_token_here
   CLIENT_ID=your_discord_application_client_id
   # Optionnel, pour déploiement rapide des commandes dans un seul serveur:
    GUILD_ID=your_guild_id
    # URL par défaut:
    DEFAULT_VOTE_URL=https://top-serveurs.net/palworld/vote/fr-server-2424-splendide
    # Fuseau optionnel:
    DEFAULT_TZ=Europe/Paris
    # Langue du bot (fr ou en):
    BOT_LANG=fr
   ```
2. Construire et démarrer le bot:
   ```bash
   docker compose up -d --build
   ```
3. Déployer les commandes (depuis le conteneur):
   ```bash
   docker compose run --rm bot node src/deploy-commands.js
   ```
   - Si vous utilisez `GUILD_ID`, les commandes seront visibles immédiatement dans ce serveur.
   - Sans `GUILD_ID`, l’apparition globale peut prendre jusqu’à 1h.

Notes Docker:
- Les données (`data/`) sont persistées dans un volume `bot_data`.
- Mettez à jour vos variables dans `.env` puis redémarrez:
  ```bash
  docker compose up -d
  ```

### Notes
- Le bouton ouvre l’URL de vote. Le bot ajoute `?pseudo=<VotreNomDiscord>` en tant que paramètre de requête. Le site de vote peut ignorer ce paramètre; il est fourni pour convenance.
- Les DM peuvent échouer si l’utilisateur bloque les MP depuis les serveurs.
- Les données sont stockées dans `data/config.json` et `data/subscribers.json`.

### Personnalisation
- Modifier l’intervalle par défaut: éditez `data/config.json` (`intervalCron`) avec une expression CRON (par défaut `0 */2 * * *` pour toutes les 2h) puis redémarrez le bot.
- Fuseau horaire utilisé pour les horaires quotidiens: `data/config.json` (`timezone`, défaut `Europe/Paris`). Vous pouvez définir `DEFAULT_TZ` dans `.env` pour initialiser la valeur.

### Lien de vote
- Par défaut: `https://top-serveurs.net/palworld/vote/fr-server-2424-splendide`
  - Source: page de vote Top-Serveurs [`top-serveurs.net/palworld/vote/fr-server-2424-splendide`](https://top-serveurs.net/palworld/vote/fr-server-2424-splendide)


