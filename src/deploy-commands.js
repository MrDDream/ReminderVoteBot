import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

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
		fr: 'Arrêter les MP de rappel de vote.',
		en: 'Stop vote reminder DMs.'
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
		fr: 'Voir la configuration actuelle et le nombre d’abonnés.',
		en: 'View current configuration and subscriber count.'
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
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
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
