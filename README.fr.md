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

- Node.js 20 ou supérieur
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
GUILD_ID=votre_guild_id  # Optionnel, pour les commandes spécifiques au serveur
DEFAULT_TZ=Europe/Paris  # Fuseau horaire par défaut
BOT_LANG=fr  # ou 'en' pour l'anglais
PUBLIC_BASE_URL=https://votre-domaine.com  # Optionnel, pour la redirection de vote
MARK_SECRET=votre_cle_secrete  # Optionnel, pour les tokens de vote sécurisés
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
| `GUILD_ID` | Non | ID du serveur pour les commandes spécifiques (déploiement plus rapide) | - |
| `DEFAULT_TZ` | Non | Fuseau horaire par défaut pour les rappels | `Europe/Paris` |
| `BOT_LANG` | Non | Langue du bot (`en` ou `fr`) | `fr` |
| `PUBLIC_BASE_URL` | Non | URL de base pour le service de redirection de vote | - |
| `MARK_SECRET` | Non | Clé secrète pour la signature des tokens de vote | - |
| `PORT` | Non | Port du serveur HTTP | `3000` |
| `DEFAULT_VOTE_URL` | Non | Legacy : URL de vote par défaut (déprécié, utilisez `/addvote`) | - |

### Stockage des données

Le bot stocke les données dans le répertoire `data/` :
- `data/config.json` : Configuration du bot et URLs de vote
- `data/subscriptions.json` : Abonnements des utilisateurs

**Important** : Assurez-vous de sauvegarder régulièrement le répertoire `data/` !

## Utilisation

### Commandes utilisateur

#### `/subscribe`
S'abonner aux rappels de vote. Vous pouvez configurer :
- **Serveur** : Choisissez le serveur de vote pour lequel recevoir des rappels
- **Fenêtre horaire** : Définissez les heures de début et de fin pour les rappels (par incréments de 30 minutes)
- **Mode** : Choisissez entre MP (message privé) ou mention dans un salon

#### `/unsubscribe`
Se désabonner des rappels de vote. Vous pouvez supprimer un abonnement spécifique ou tous les abonnements.

#### `/status`
Visualisez vos abonnements actuels, incluant :
- Nom et ID du serveur
- Fenêtre horaire
- Fuseau horaire
- Mode de livraison
- Période de cooldown
- Timer du prochain rappel

Vous pouvez également modifier ou supprimer des abonnements depuis cette interface.

### Commandes administrateur

#### `/addvote`
Ajouter une nouvelle URL de vote. Nécessite la permission "Gérer le serveur". Vous devez fournir :
- **Nom** : Nom d'affichage pour le serveur de vote
- **URL** : L'URL de vote (peut inclure le placeholder `{pseudo}`)
- **Délai** : Période de cooldown en minutes (60, 120, 180, 240, 720, ou 1440)
- **ID du salon** (optionnel) : Salon par défaut pour le mode mention dans un salon

#### `/listvote`
Lister et gérer les URLs de vote existantes. Vous pouvez :
- Voir tous les serveurs de vote configurés
- Modifier les détails d'un serveur de vote
- Supprimer des serveurs de vote

## Fonctionnement

1. **Abonnement** : Les utilisateurs s'abonnent avec `/subscribe` et configurent leurs préférences
2. **Planification** : Le bot utilise des tâches cron pour vérifier chaque minute si des rappels doivent être envoyés
3. **Fenêtre horaire** : Les rappels ne sont envoyés que pendant la fenêtre horaire configurée (dans le fuseau horaire de l'utilisateur)
4. **Cooldown** : Après l'envoi d'un rappel ou le marquage d'un vote, le bot attend la période de cooldown avant d'envoyer un autre rappel
5. **Livraison** : Les rappels sont envoyés par MP ou comme mention dans un salon, selon la préférence de l'utilisateur
6. **Suivi des votes** : Lorsque les utilisateurs cliquent sur le bouton de vote, le bot peut suivre les votes (si `PUBLIC_BASE_URL` est configuré)

## Docker

### Développement

Utilisez `docker-compose-dev.yml` pour le développement avec rechargement à chaud (si configuré).

### Production

Le fichier `docker-compose.yml` est configuré pour une utilisation en production avec :
- Déploiement automatique des commandes au démarrage
- Persistance des volumes pour les données
- Point de contrôle de santé à `/health`
- Mappage de port pour le serveur HTTP

## Structure du projet

```
ReminderVoteBot/
├── src/
│   ├── index.js          # Logique principale du bot
│   ├── config.js         # Gestion de la configuration
│   ├── storage.js        # Stockage des abonnements
│   └── deploy-commands.js # Déploiement des commandes Discord
├── data/                 # Répertoire de données (créé à l'exécution)
│   ├── config.json       # Configuration du bot
│   └── subscriptions.json # Abonnements des utilisateurs
├── Dockerfile            # Définition de l'image Docker
├── docker-compose.yml    # Docker Compose de production
├── docker-compose-dev.yml # Docker Compose de développement
├── package.json          # Dépendances Node.js
└── README.fr.md         # Ce fichier
```

## Fonctionnalités détaillées

### Fenêtres horaires
- Les utilisateurs peuvent définir une heure de début et de fin pour les rappels
- Les heures doivent être par incréments de 30 minutes (ex. 08:00, 08:30, 09:00)
- Supporte les fenêtres nocturnes (ex. 22:00-06:00)
- Prend en compte les fuseaux horaires en utilisant le fuseau configuré

### Système de cooldown
- Chaque serveur de vote peut avoir sa propre période de cooldown
- Le cooldown par défaut est de 2 heures (120 minutes)
- Valeurs supportées : 60, 120, 180, 240, 720, 1440 minutes
- Le timer se réinitialise lorsque l'utilisateur clique sur "Voter maintenant" ou utilise le bouton de réinitialisation

### Plusieurs serveurs de vote
- Les administrateurs peuvent ajouter plusieurs serveurs de vote
- Chaque serveur a sa propre URL, cooldown et salon par défaut optionnel
- Les utilisateurs peuvent s'abonner à différents serveurs avec différentes configurations

### Service de redirection de vote
Si `PUBLIC_BASE_URL` est configuré :
- Le bot fournit un service de redirection sécurisé à `/v?t=<token>`
- Les tokens sont signés avec HMAC-SHA256
- Suit automatiquement quand les utilisateurs votent
- Revient à l'URL de vote directe si non configuré

## Dépannage

### Le bot ne répond pas
- Vérifiez que le token du bot est correct
- Vérifiez que le bot a les permissions nécessaires (Envoyer des messages, Messages privés)
- Consultez les logs du bot pour les erreurs

### Les rappels ne sont pas envoyés
- Vérifiez que la fenêtre horaire est correctement configurée
- Vérifiez que la période de cooldown s'est écoulée
- Assurez-vous que le bot peut envoyer des MP ou accéder au salon configuré
- Vérifiez les paramètres de fuseau horaire

### Les commandes n'apparaissent pas
- Exécutez `npm run deploy:commands` pour déployer les commandes
- Attendez jusqu'à 1 heure pour que les commandes globales se propagent
- Utilisez `GUILD_ID` pour un déploiement instantané des commandes spécifiques au serveur

## Licence

Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.

## Contribution

Les contributions sont les bienvenues ! N'hésitez pas à soumettre une Pull Request.

## Support

Pour les problèmes, questions ou demandes de fonctionnalités, veuillez ouvrir une issue sur GitHub.

---

Fait avec ❤️ par MrDDream

