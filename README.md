# 🤖 Discord Vote Reminder Bot 

![GitHub release (latest by date)](https://img.shields.io/github/v/release/discord-vote-reminder-bot?style=flat-square)
![GitHub](https://img.shields.io/github/license/discord-vote-reminder-bot?style=flat-square)
![GitHub top language](https://img.shields.io/github/languages/top/discord-vote-reminder-bot?style=flat-square)

**Discord Vote Reminder Bot** est un bot Discord écrit en JavaScript, qui envoie des messages directs (DMs) aux utilisateurs abonnés toutes les deux heures avec un bouton de vote. Ce projet est open-source et est sous licence MIT.

## 📑 Table des matières

- [Fonctionnalités principales](#-fonctionnalités-principales)
- [Prérequis](#-prérequis)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Utilisation](#-utilisation)
- [Structure du projet](#-structure-du-projet)
- [Technologies utilisées](#-technologies-utilisées)
- [Contribution](#-contribution)
- [Roadmap](#-roadmap)
- [FAQ ou Troubleshooting](#-faq-ou-troubleshooting)
- [Licence](#-licence)
- [Auteurs et remerciements](#-auteurs-et-remerciements)

## 🎯 Fonctionnalités principales

- 📨 Envoie des DMs aux utilisateurs abonnés toutes les deux heures.
- 🗳️ Intègre un bouton de vote dans les DMs.
- 📝 Permet aux utilisateurs de s'abonner ou de se désabonner à tout moment.
- 🕓 Utilise node-cron pour programmer l'envoi des DMs.
- 🚀 Déployable avec Docker.

## 💻 Prérequis

- Node.js v14+
- npm v6+
- Un compte Discord avec les permissions de bot

## 🏗 Installation 

1. Clonez le dépôt sur votre machine locale :
```bash
git clone https://github.com/discord-vote-reminder-bot.git
```
2. Installez les dépendances avec npm :
```bash
cd discord-vote-reminder-bot
npm install
```
3. Créez un `.env` à partir du `.env.example` et remplissez les valeurs :
```bash
cp .env.example .env
```
4. Lancez le bot avec npm :
```bash
npm start
```

## ⚙️ Configuration

Les variables d'environnement suivantes doivent être configurées dans le fichier `.env` :

- `DISCORD_BOT_TOKEN` : Le token de votre bot Discord.
- `CRON_SCHEDULE` : L'horaire des DMs (toutes les 2 heures par défaut).

## 📖 Utilisation

```javascript
const Discord = require('discord.js');
const client = new Discord.Client();

client.once('ready', () => {
  console.log('Bot is ready!');
});

client.login(process.env.DISCORD_BOT_TOKEN);
```

## 📂 Structure du projet

```
discord-vote-reminder-bot
├── .git/
├── src/
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose-dev.yml
├── docker-compose.yml
├── package.json
├── README.fr.md
├── README.md
└── LICENSE
```

## 🛠️ Technologies utilisées

- ![JavaScript](https://img.shields.io/badge/-JavaScript-black?style=flat-square&logo=javascript)
- ![Express](https://img.shields.io/badge/-Express-black?style=flat-square&logo=express)
- ![Discord.js](https://img.shields.io/badge/-Discord.js-black?style=flat-square&logo=discord)
- ![Dotenv](https://img.shields.io/badge/-Dotenv-black?style=flat-square&logo=dotenv)
- ![Node-cron](https://img.shields.io/badge/-Node--cron-black?style=flat-square&logo=node-cron)

## 👥 Contribution

Nous accueillons toute contribution. Veuillez d'abord ouvrir une issue pour discuter de ce que vous souhaitez modifier.

## 🚀 Roadmap

- Ajouter des tests
- Support de plusieurs langages
- Plus d'options de configuration

## ❓ FAQ ou Troubleshooting

Si vous rencontrez des problèmes lors de l'utilisation de ce bot, veuillez vérifier la [section des problèmes](https://github.com/discord-vote-reminder-bot/issues) pour voir si votre problème a déjà été signalé. Si ce n'est pas le cas, n'hésitez pas à ouvrir une nouvelle issue.

## 📜 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus d'informations.

## 🙏 Auteurs et remerciements

Ce bot a été créé par [Votre nom] et est maintenu par la communauté open-source. Nous remercions tous ceux qui ont contribué à ce projet.
