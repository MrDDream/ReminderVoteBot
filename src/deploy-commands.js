import './env.js';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { BOT_LANG, COOLDOWN_CHOICES } from './constants.js';

const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const token = process.env.DISCORD_TOKEN;

const DESCRIPTIONS = {
	subscribe: {
		fr: 'S’abonner aux rappels de vote.',
		en: 'Subscribe to vote reminders.'
	},
	unsubscribe: {
		fr: 'Se désabonner des rappels de vote.',
		en: 'Unsubscribe from vote reminders.'
	},
	addvote: {
		fr: 'Ajouter une URL de vote via formulaire.',
		en: 'Add a vote URL using a form.'
	},
	listvote: {
		fr: 'Gérer les URLs de vote existantes.',
		en: 'Manage existing vote URLs.'
	},
	status: {
		fr: 'Voir et gérer vos abonnements.',
		en: 'View and manage your subscriptions.'
	},
	addvoteCooldown: {
		fr: 'Délai entre deux votes (2 heures par défaut).',
		en: 'Cooldown between two votes (2 hours by default).'
	},
	addvoteChannel: {
		fr: 'Salon où mentionner les abonnés en mode ping (optionnel).',
		en: 'Channel where subscribers are pinged in ping mode (optional).'
	}
};

const commands = [
	new SlashCommandBuilder()
		.setName('subscribe')
		.setDescription(DESCRIPTIONS.subscribe[BOT_LANG]),
	new SlashCommandBuilder()
		.setName('unsubscribe')
		.setDescription(DESCRIPTIONS.unsubscribe[BOT_LANG]),
	new SlashCommandBuilder()
		.setName('addvote')
		.setDescription(DESCRIPTIONS.addvote[BOT_LANG])
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addIntegerOption(option => option
			.setName('cooldown')
			.setNameLocalizations({ fr: 'delai' })
			.setDescription(DESCRIPTIONS.addvoteCooldown[BOT_LANG])
			.setRequired(false)
			.addChoices(...COOLDOWN_CHOICES.map(choice => ({ name: choice[BOT_LANG], value: choice.minutes }))))
		.addChannelOption(option => option
			.setName('channel')
			.setNameLocalizations({ fr: 'salon' })
			.setDescription(DESCRIPTIONS.addvoteChannel[BOT_LANG])
			.setRequired(false)
			.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
	new SlashCommandBuilder()
		.setName('listvote')
		.setDescription(DESCRIPTIONS.listvote[BOT_LANG])
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
	new SlashCommandBuilder()
		.setName('status')
		.setDescription(DESCRIPTIONS.status[BOT_LANG])
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

async function main() {
	if (!clientId || !token || !guildId) {
		console.error('CLIENT_ID, DISCORD_TOKEN ou GUILD_ID manquant(s) dans .env');
		process.exit(1);
	}
	try {
		await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
		// The bot serves a single server: remove global commands left by older versions,
		// otherwise they would stay usable from any server the bot is in.
		await rest.put(Routes.applicationCommands(clientId), { body: [] });
		console.log('Commandes deployees sur le serveur et commandes globales supprimees.');
	} catch (e) {
		console.error(e);
		process.exit(1);
	}
}

main();
