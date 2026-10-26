import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';

const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const token = process.env.DISCORD_TOKEN;
const BOT_LANG = (process.env.BOT_LANG || 'fr').trim().toLowerCase() === 'en' ? 'en' : 'fr';

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

const COOLDOWN_CHOICES = [
	{ minutes: 60, fr: '1 heure', en: '1 hour' },
	{ minutes: 120, fr: '2 heures', en: '2 hours' },
	{ minutes: 180, fr: '3 heures', en: '3 hours' },
	{ minutes: 240, fr: '4 heures', en: '4 hours' },
	{ minutes: 720, fr: '12 heures', en: '12 hours' },
	{ minutes: 1440, fr: '24 heures', en: '24 hours' }
];

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
	if (!clientId || !token) {
		console.error('CLIENT_ID ou DISCORD_TOKEN manquant(s) dans .env');
		process.exit(1);
	}
	try {
		if (guildId) {
			await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
			console.log('Commandes guild deployeees.');
		} else {
			await rest.put(Routes.applicationCommands(clientId), { body: commands });
			console.log('Commandes globales deployeees (propagation jusqu a 1h).');
		}
	} catch (e) {
		console.error(e);
		process.exit(1);
	}
}

main();
