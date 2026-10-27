# ReminderVoteBot
Cette documentation est disponible en [Français](README.fr.md) et en [Anglais](README.md)

## Vue d'ensemble
Un bot Discord qui envoie des rappels de vote automatisés aux utilisateurs abonnés via messages privés ou mentions dans un salon. Le bot prend en charge plusieurs serveurs de vote, des fenêtres horaires personnalisables, une planification tenant compte des fuseaux horaires et des périodes de cooldown configurables.

## Fonctionnalités

- 🔔 **Rappels de vote automatisés** : Envoie des rappels par MP ou mentions dans un salon selon les préférences de l'utilisateur
- ⏰ **Support des fenêtres horaires** : Configurez des heures spécifiques pour l'envoi des rappels
- 🌍 **Prise en charge des fuseaux horaires** : Supporte différents fuseaux horaires pour une planification précise
- 🎯 **Plusieurs serveurs de vote** : Gérez plusieurs URLs de vote avec différentes périodes de cooldown
- 🔄 **Gestion du cooldown** : Périodes de cooldown configurables (1h, 2h, 3h, 4h, 12h, 24h)
- 🌐 **Redirection web** : Interface web optionnelle pour le suivi sécurisé des votes
- 🌍 **Multilingue** : Supporte l'anglais et le français
- 📊 **Gestion du statut** : Visualisez et gérez facilement vos abonnements

## Prérequis

- Node.js 26 ou supérieur
- Un token de bot Discord ([Discord Developer Portal](https://discord.com/developers/applications))
- (Optionnel) Docker et Docker Compose pour un déploiement conteneurisé

## Installation

### Utilisation de Docker (Recommandé)

1. Clonez le dépôt :
```bash
git clone https://github.com/mrddream/ReminderVoteBot.git
cd ReminderVoteBot
```

2. Créez un fichier `.env` à la racine du projet :
```env
DISCORD_TOKEN=votre_token_de_bot_discord
CLIENT_ID=votre_client_id
GUILD_ID=votre_guild_id  # Obligatoire : le serveur Discord du bot
DEFAULT_TZ=Europe/Paris  # Fuseau horaire par défaut
BOT_LANG=fr  # ou 'en' pour l'anglais
PUBLIC_BASE_URL=https://votre-domaine.com  # Optionnel, pour la redirection de vote
MARK_SECRET=au_moins_32_caracteres_aleatoires  # Obligatoire avec PUBLIC_BASE_URL (openssl rand -hex 32)
PORT=3000  # Optionnel, par défaut 3000
```

3. Démarrez avec Docker Compose :
```bash
docker-compose up -d
```

### Installation manuelle

1. Clonez le dépôt :
```bash
git clone https://github.com/mrddream/ReminderVoteBot.git
cd ReminderVoteBot
```

2. Installez les dépendances :
```bash
npm install
```

3. Créez un fichier `.env` (voir la section configuration ci-dessus)

4. Déployez les commandes Discord :
```bash
npm run deploy:commands
```

5. Démarrez le bot :
```bash
npm start
```

## Configuration

### Variables d'environnement

| Variable | Requis | Description | Par défaut |
|----------|--------|-------------|------------|
| `DISCORD_TOKEN` | Oui | Token de votre bot Discord | - |
| `CLIENT_ID` | Oui | ID client de votre application Discord | - |
| `GUILD_ID` | Oui | ID du serveur Discord du bot : les commandes y sont déployées uniquement, et les commandes admin ne fonctionnent que là | - |
| `DEFAULT_TZ` | Non | Fuseau horaire par défaut pour les rappels | `Europe/Paris` |
| `BOT_LANG` | Non | Langue du bot (`en` ou `fr`) | `fr` |
| `PUBLIC_BASE_URL` | Non | URL de base pour le service de redirection de vote | - |
| `MARK_SECRET` | Avec `PUBLIC_BASE_URL` | Clé secrète (32 caractères minimum) pour signer les liens de vote ; le bot refuse de démarrer sans elle si `PUBLIC_BASE_URL` est défini | - |
| `PORT` | Non | Port du serveur HTTP | `3000` |

### Stockage des données

Le bot stocke les données dans le répertoire `data/` :
- `data/config.json` : Configuration du bot et URLs de vote
- `data/subscriptions.json` : Abonnements des utilisateurs

Les fichiers sont écrits de façon atomique et la version précédente est conservée dans `*.json.bak`. Si un fichier est corrompu, le bot le restaure depuis la copie `.bak` ; si c'est impossible, il refuse de démarrer au lieu d'écraser vos données.

**Important** : Assurez-vous de sauvegarder régulièrement le répertoire `data/` !

## Utilisation

### Commandes utilisateur

#### `/subscribe`
S'abonner aux rappels de vote. Vous pouvez configurer :
- **Serveur** : Choisissez le serveur de vote pour lequel recevoir des rappels (les serveurs auxquels vous êtes déjà abonné sont signalés et ne peuvent pas être choisis deux fois)
- **Fenêtre horaire** : Choisissez un préréglage (toute la journée, journée, matin, après-midi, soirée) ou **Personnalisée…** pour saisir n'importe quelle heure de début et de fin (ex. `9h`, `21:30`)
- **Mode** : Message privé, ou mention dans le salon du serveur (proposé seulement si l'admin en a configuré un)
- **Fuseau horaire** : Choisissez votre fuseau (affiché avec son décalage UTC et l'heure locale actuelle)

Le formulaire indique quand le premier rappel sera envoyé.

#### `/unsubscribe`
Se désabonner des rappels de vote. Vous pouvez supprimer un abonnement spécifique ou tous les abonnements.

#### `/status`
Visualisez vos abonnements actuels, incluant :
- Nom du serveur
- Fenêtre horaire et fuseau horaire
- Mode de livraison
- Période de cooldown
- Dernier vote enregistré et prochain rappel (en timestamps Discord, affichés dans votre propre fuseau)

Vous pouvez également modifier (fenêtre horaire, mode, fuseau) ou supprimer des abonnements depuis cette interface. Si un abonnement a été mis en pause parce que les rappels n'arrivaient pas, un bouton **Réactiver** apparaît.

### Messages de rappel
Chaque rappel indique le serveur de vote et propose trois boutons :
- **Voter maintenant** : ouvre la page de vote (et enregistre le vote automatiquement si `PUBLIC_BASE_URL` est configuré)
- **✅ J'ai voté** : enregistre le vote et relance le délai ; le message est mis à jour
- **⏰ Dans 30 min** : reporte le rappel de 30 minutes

### Commandes administrateur

#### `/addvote [delai] [salon]`
Ajouter une nouvelle URL de vote. Nécessite la permission "Gérer le serveur".
- Option **delai** (optionnelle) : 1h, 2h, 3h, 4h, 12h ou 24h (2h par défaut)
- Option **salon** (optionnelle) : salon utilisé pour le mode ping

Un formulaire demande ensuite :
- **Nom** : Nom d'affichage pour le serveur de vote
- **URL** : L'URL de vote (`https://`, 400 caractères maximum). Placez `{pseudo}` à l'endroit où doit aller le pseudo de l'utilisateur (ex. `https://site/vote/{pseudo}`) ; sinon, `?pseudo=<pseudo>` est ajouté à l'URL

25 URLs de vote au maximum peuvent être configurées.

#### `/listvote`
Lister et gérer les URLs de vote existantes. Vous pouvez :
- Voir tous les serveurs de vote configurés et leur nombre d'abonnés
- Changer le délai et le salon de ping directement depuis des menus
- Modifier le nom et l'URL
- Supprimer des serveurs de vote (leurs abonnements sont aussi supprimés)

## Fonctionnement

1. **Abonnement** : Les utilisateurs s'abonnent avec `/subscribe` et configurent leurs préférences
2. **Planification** : Chaque minute, le bot vérifie pour chaque abonnement si un rappel est dû
3. **Fenêtre horaire** : Les rappels ne sont envoyés que pendant la fenêtre horaire configurée (dans le fuseau horaire de l'utilisateur). Un rappel dû en dehors de la fenêtre part à son ouverture
4. **Cooldown** : Après l'envoi d'un rappel ou le marquage d'un vote, le bot attend la période de cooldown avant d'envoyer un autre rappel. Un rappel ignoré est donc relancé à chaque cooldown jusqu'au vote
5. **Livraison** : Les rappels sont envoyés par MP ou comme mention dans un salon, selon la préférence de l'utilisateur (repli en MP si le salon échoue). Après 3 échecs d'envoi consécutifs, l'abonnement est mis en pause et `/status` explique comment le réactiver
6. **Suivi des votes** : Les votes sont enregistrés avec le bouton **J'ai voté**, ou automatiquement via le lien **Voter maintenant** si `PUBLIC_BASE_URL` est configuré

## Docker

### Développement

Utilisez `docker-compose-dev.yml` pour construire l'image à partir des sources locales.

Lancez les tests unitaires avec `npm test` et le linter avec `npm run lint`.

### Production

Le fichier `docker-compose.yml` est configuré pour une utilisation en production avec :
- Déploiement automatique des commandes au démarrage
- Persistance des volumes pour les données
- Contrôle de santé Docker sur `/health`
- Arrêt propre sur `docker stop` (les modifications en attente sont enregistrées)
- Mappage de port pour le serveur HTTP

Le conteneur tourne avec l'utilisateur non privilégié `node`. Les images publiées avant ce changement tournaient en root : si votre volume `bot_data` vient d'une telle image, donnez-le une fois à l'utilisateur `node` (sinon le bot refuse de démarrer et affiche cette commande) :

```bash
docker compose run --rm --user root bot chown -R node:node /app/data
```

### Image Docker (CI)

Le workflow GitHub Actions `.github/workflows/docker.yml` lance les tests sous Node.js 26, puis construit l'image pour `linux/amd64` et `linux/arm64` :
- push sur `main` → publie `ghcr.io/mrddream/remindervotebot:latest` (et un tag `sha-…`)
- tag `vX.Y.Z` → publie aussi `X.Y.Z` et `X.Y`
- pull request → lance les tests et construit l'image sans la publier

Pour mettre à jour un serveur : `docker compose pull && docker compose up -d`.

## Structure du projet

```
ReminderVoteBot/
├── src/
│   ├── index.js          # Logique principale du bot
│   ├── config.js         # Gestion de la configuration
│   ├── storage.js        # Stockage des abonnements
│   ├── schedule.js       # Règles de planification (fenêtres horaires, cooldown, report)
│   ├── jsonFile.js       # Écriture JSON atomique avec sauvegarde .bak
│   ├── token.js          # Liens de vote /v signés
│   ├── voteUrl.js        # Validation et identifiants des URLs de vote
│   ├── constants.js      # Valeurs partagées avec deploy-commands.js
│   ├── paths.js          # Dossier des données
│   └── deploy-commands.js # Déploiement des commandes Discord
├── data/                 # Répertoire de données (créé à l'exécution)
│   ├── config.json       # Configuration du bot
│   └── subscriptions.json # Abonnements des utilisateurs
├── test/                 # Tests unitaires (npm test)
├── Dockerfile            # Définition de l'image Docker
├── docker-compose.yml    # Docker Compose de production
├── docker-compose-dev.yml # Docker Compose de développement
├── package.json          # Dépendances Node.js
└── README.fr.md         # Ce fichier
```

## Fonctionnalités détaillées

### Fenêtres horaires
- Les utilisateurs choisissent un préréglage ou saisissent n'importe quelle heure de début et de fin (`HH:MM`, `9h`, `21h30`…)
- Supporte les fenêtres nocturnes (ex. 22:00-06:00)
- Chaque abonnement a son propre fuseau horaire (par défaut : `DEFAULT_TZ`)

### Système de cooldown
- Chaque serveur de vote peut avoir sa propre période de cooldown
- Le cooldown par défaut est de 2 heures (120 minutes)
- Valeurs supportées : 60, 120, 180, 240, 720, 1440 minutes
- Le timer se réinitialise lorsque l'utilisateur clique sur "J'ai voté" (ou sur "Voter maintenant" si `PUBLIC_BASE_URL` est configuré)

### Plusieurs serveurs de vote
- Les administrateurs peuvent ajouter plusieurs serveurs de vote
- Chaque serveur a sa propre URL, son cooldown et un salon de ping optionnel
- Les utilisateurs peuvent s'abonner à différents serveurs avec différentes configurations

### Service de redirection de vote
Si `PUBLIC_BASE_URL` est configuré :
- Le bot fournit un service de redirection sécurisé à `/v?t=<token>`
- Les tokens sont signés avec HMAC-SHA256 (`MARK_SECRET`), identifient l'abonnement pour que le vote soit enregistré sur le bon serveur, et expirent après 7 jours
- En mode ping salon, le bouton **Voter maintenant** donne à l'abonné son lien personnel en privé : les autres membres ne peuvent pas voter à sa place
- Suit automatiquement quand les utilisateurs votent et met à jour le message de rappel
- Revient à l'URL de vote directe si non configuré

## Dépannage

### Le bot ne répond pas
- Vérifiez que le token du bot est correct
- Vérifiez que le bot a les permissions nécessaires (Envoyer des messages, Messages privés)
- Consultez les logs du bot pour les erreurs

### Les rappels ne sont pas envoyés
- Vérifiez que la fenêtre horaire est correctement configurée
- Vérifiez que la période de cooldown s'est écoulée (`/status` affiche le prochain rappel)
- Assurez-vous que le bot peut envoyer des MP ou accéder au salon configuré ; un abonnement mis en pause après des échecs d'envoi se réactive depuis `/status`
- Vérifiez les paramètres de fuseau horaire

### Les commandes n'apparaissent pas
- Exécutez `npm run deploy:commands` pour déployer les commandes
- Les commandes n'existent que sur le serveur `GUILD_ID` (le déploiement supprime aussi les commandes globales des anciennes versions)
- `/addvote` et `/listvote` demandent la permission « Gérer le serveur » sur ce serveur

## Licence

Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.

## Contribution

Les contributions sont les bienvenues ! N'hésitez pas à soumettre une Pull Request.

## Support

Pour les problèmes, questions ou demandes de fonctionnalités, veuillez ouvrir une issue sur GitHub.

---

Fait avec ❤️ par MrDDream

