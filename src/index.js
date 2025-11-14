import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, ButtonBuilder, ButtonStyle, ActionRowBuilder, Events, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } from 'discord.js';
import cron from 'node-cron';
import express from 'express';
import crypto from 'crypto';
import { loadSubscriptions, saveSubscriptions, addSubscription, updateSubscription, removeSubscription, removeAllSubscriptionsForUser } from './storage.js';
import { loadConfig, saveConfig } from './config.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
	console.error('DISCORD_TOKEN manquant dans .env');
	process.exit(1);
}

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const MARK_SECRET = process.env.MARK_SECRET;
const PORT = parseInt(process.env.PORT || '3000', 10);
const BOT_LANG = (process.env.BOT_LANG || 'fr').trim().toLowerCase() === 'en' ? 'en' : 'fr';

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.DirectMessages
	],
	partials: [Partials.Channel]
});

let subscriptions = loadSubscriptions(); // v4 schema
let config = loadConfig();
const subscriptionCronTasks = new Map(); // subscriptionId -> cron.Task
const DEFAULT_COOLDOWN_MINUTES = 120;
const COOLDOWN_CHOICES = [
	{ label: '1 heure', value: '60', minutes: 60 },
	{ label: '2 heures', value: '120', minutes: 120 },
	{ label: '3 heures', value: '180', minutes: 180 },
	{ label: '4 heures', value: '240', minutes: 240 },
	{ label: '12 heures', value: '720', minutes: 720 },
	{ label: '24 heures', value: '1440', minutes: 1440 }
];
const HALF_HOUR_VALUES = Array.from({ length: 48 }, (_, idx) => {
	const hours = Math.floor(idx / 2).toString().padStart(2, '0');
	const minutes = idx % 2 === 0 ? '00' : '30';
	return `${hours}:${minutes}`;
});
const TIME_PAGE_SIZE = 24;
const subscribeSessions = new Map(); // userId -> session state
const listVoteSessions = new Map(); // userId -> { selectedId?: string }
const statusSessions = new Map(); // userId -> { selectedId?: string }

function tr(frText, enText, params = {}) {
	const template = BOT_LANG === 'en' ? enText : frText;
	return template.replace(/\{(\w+)\}/g, (_, key) => (params[key] ?? `{${key}}`));
}

function getVoteUrlEntryById(id) {
	const entries = getVoteUrlEntries();
	if (entries.length === 0) {
		return null;
	}
	if (id) {
		const found = entries.find(entry => entry.id === id);
		if (found) return found;
	}
	if (config.defaultVoteUrlId) {
		const fallback = entries.find(entry => entry.id === config.defaultVoteUrlId);
		if (fallback) return fallback;
	}
	return entries[0];
}

function syncLegacyVoteBaseUrl() {
	const entry = getVoteUrlEntryById(config.defaultVoteUrlId);
	if (entry) {
		config.voteBaseUrl = entry.url;
		return;
	}
	if (!config.defaultVoteUrlId && getVoteUrlEntries().length === 0) {
		config.voteBaseUrl = null;
	}
}

function getVoteUrlEntries() {
	return Array.isArray(config.voteUrls) ? config.voteUrls : [];
}

function slugifyVoteUrlId(label) {
	return label
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || `vote-${Date.now()}`;
}

function generateVoteUrlId(label) {
	const existing = new Set(getVoteUrlEntries().map(entry => entry.id));
	const base = slugifyVoteUrlId(label);
	if (!existing.has(base)) return base;
	let counter = 2;
	let candidate = `${base}-${counter}`;
	while (existing.has(candidate)) {
		counter += 1;
		candidate = `${base}-${counter}`;
	}
	return candidate;
}

function getCooldownMsForEntry(entry) {
	const minutes = typeof entry?.cooldownMinutes === 'number' && entry.cooldownMinutes > 0 ? entry.cooldownMinutes : DEFAULT_COOLDOWN_MINUTES;
	return minutes * 60 * 1000;
}

function getCooldownMsForSubscriber(sub) {
	const entry = getVoteUrlEntryById(sub?.voteUrlId);
	return getCooldownMsForEntry(entry);
}

function syncSubscribeSessionWindow(session) {
	session.windowStart = session.startTime || null;
	session.windowEnd = session.endTime || null;
}

function renderSubscribeSummary(session, entries) {
	syncSubscribeSessionWindow(session);
	const entry = session?.voteUrlId ? entries.find(e => e.id === session.voteUrlId) : null;
	const lines = [
		tr('Configurez votre abonnement puis cliquez sur Valider.', 'Configure your subscription then click Confirm.'),
		entry
			? tr('Serveur sélectionné : {label}', 'Selected server: {label}', { label: entry.label })
			: tr('Serveur sélectionné : (aucun)', 'Selected server: (none)'),
		session?.windowStart && session?.windowEnd
			? tr('Plage horaire : {start} - {end}', 'Reminder window: {start} - {end}', { start: session.windowStart, end: session.windowEnd })
			: tr('Plage horaire : choisissez début et fin', 'Reminder window: pick a start and end'),
		session?.mode
			? tr('Mode de rappel : {mode}', 'Reminder mode: {mode}', {
				mode: session.mode === 'channel' ? tr('Ping salon', 'Channel ping') : tr('MP', 'DM')
			})
			: tr('Mode de rappel : (non sélectionné)', 'Reminder mode: (not selected)')
	];
	if (session?.mode === 'channel' && entry && !entry.channelId) {
		lines.push(tr('Attention : ce serveur n’a pas de salon configuré. Choisissez MP ou configurez un salon.', 'Warning: this server has no configured channel. Pick DM or configure one.'));
	}
	if (session?.windowStart) {
		lines.push(tr('Premier rappel prévu à {time}.', 'First reminder planned at {time}.', { time: session.windowStart }));
	}
	return lines.join('\n');
}

function buildTimeMenu(customId, selectedValue, page, placeholder) {
	const values = HALF_HOUR_VALUES.slice(page * TIME_PAGE_SIZE, (page + 1) * TIME_PAGE_SIZE);
	const menu = new StringSelectMenuBuilder()
		.setCustomId(customId)
		.setPlaceholder(placeholder)
		.setMinValues(1)
		.setMaxValues(1);
	for (const value of values) {
		menu.addOptions({
			label: value,
			value,
			default: value === selectedValue
		});
	}
	const hasNext = (page + 1) * TIME_PAGE_SIZE < HALF_HOUR_VALUES.length;
	const hasPrev = page > 0;
	if (hasNext) {
		menu.addOptions({ label: tr('Suite 12h-23h30', 'Next 12:00-23:30'), value: '__next__' });
	} else if (hasPrev) {
		menu.addOptions({ label: tr('Retour 00h-11h30', 'Back 00:00-11:30'), value: '__prev__' });
	}
	return menu;
}

function buildSubscribeComponents(entries, session) {
	syncSubscribeSessionWindow(session);
	const voteOptions = [];
	const seen = new Set();
	if (session.voteUrlId) {
		const selectedEntry = entries.find(entry => entry.id === session.voteUrlId);
		if (selectedEntry) {
			voteOptions.push(selectedEntry);
			seen.add(selectedEntry.id);
		}
	}
	for (const entry of entries) {
		if (voteOptions.length >= 25) break;
		if (seen.has(entry.id)) continue;
		voteOptions.push(entry);
		seen.add(entry.id);
	}
	const voteMenu = new StringSelectMenuBuilder()
		.setCustomId('subscribe-select-vote')
		.setPlaceholder(tr('Choisissez un serveur', 'Choose a server'))
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(voteOptions.map(entry => ({
			label: entry.label.slice(0, 100),
			value: entry.id,
			description: entry.url.slice(0, 90),
			default: entry.id === session.voteUrlId
		})));
	const startPage = session.startPage ?? 0;
	const endPage = session.endPage ?? 0;
	const startMenu = buildTimeMenu(
		'subscribe-select-start-time',
		session.startTime || null,
		startPage,
		startPage === 1
			? tr('Début (12h00-23h30)', 'Start (12:00-23:30)')
			: tr('Début (00h00-11h30)', 'Start (00:00-11:30)')
	);
	const endMenu = buildTimeMenu(
		'subscribe-select-end-time',
		session.endTime || null,
		endPage,
		endPage === 1
			? tr('Fin (12h00-23h30)', 'End (12:00-23:30)')
			: tr('Fin (00h00-11h30)', 'End (00:00-11:30)')
	);
	const modeMenu = new StringSelectMenuBuilder()
		.setCustomId('subscribe-select-mode')
		.setPlaceholder(tr('Mode de rappel', 'Reminder mode'))
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions([
			{
				label: tr('MP', 'DM'),
				value: 'dm',
				description: tr('Envoyer un message privé', 'Send a direct message'),
				default: session.mode === 'dm'
			},
			{
				label: tr('Ping salon', 'Channel ping'),
				value: 'channel',
				description: tr('Mentionner dans le salon configuré', 'Mention in the configured channel'),
				default: session.mode === 'channel'
			}
		]);
	const confirmButton = new ButtonBuilder()
		.setCustomId('subscribe-confirm')
		.setLabel(tr('Valider', 'Confirm'))
		.setStyle(ButtonStyle.Success)
		.setDisabled(!(session.voteUrlId && session.windowStart && session.windowEnd && session.mode));
	const cancelButton = new ButtonBuilder()
		.setCustomId('subscribe-cancel')
		.setLabel(tr('Annuler', 'Cancel'))
		.setStyle(ButtonStyle.Secondary);
	return [
		new ActionRowBuilder().addComponents(voteMenu),
		new ActionRowBuilder().addComponents(startMenu),
		new ActionRowBuilder().addComponents(endMenu),
		new ActionRowBuilder().addComponents(modeMenu),
		new ActionRowBuilder().addComponents(confirmButton, cancelButton)
	];
}

function buildListVoteSelect(entries, selectedId) {
	return new ActionRowBuilder().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId('listvote-select-entry')
			.setPlaceholder(tr('Choisissez une entrée à gérer', 'Choose an entry to manage'))
			.setMinValues(1)
			.setMaxValues(1)
			.addOptions(entries.map(entry => ({
				label: entry.label.slice(0, 100),
				value: entry.id,
				description: entry.url.slice(0, 90),
				default: entry.id === selectedId
			})))
	);
}

function renderListVoteSummary(entry) {
	if (!entry) {
		return tr('Sélectionnez une entrée pour la modifier ou la supprimer.', 'Select an entry to edit or delete it.');
	}
	const lines = [
		tr('ID : {id}', 'ID: {id}', { id: entry.id }),
		tr('Nom : {label}', 'Name: {label}', { label: entry.label }),
		`URL: ${entry.url}`,
		tr('Délai : {minutes} minutes', 'Cooldown: {minutes} minutes', { minutes: entry.cooldownMinutes }),
		entry.channelId ? tr('Salon par défaut : <#{channel}>', 'Default channel: <#{channel}>', { channel: entry.channelId }) : tr('Salon par défaut : MP', 'Default channel: DM')
	];
	return lines.join('\n');
}

function buildListVoteComponents(entries, selectedId) {
	const rows = [buildListVoteSelect(entries, selectedId)];
	if (selectedId) {
		const actionRow = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId('listvote-edit')
				.setLabel(tr('Modifier', 'Edit'))
				.setStyle(ButtonStyle.Primary)
				.setDisabled(false),
			new ButtonBuilder()
				.setCustomId('listvote-delete')
				.setLabel(tr('Supprimer', 'Delete'))
				.setStyle(ButtonStyle.Danger)
				.setDisabled(false)
		);
		rows.push(actionRow);
	}
	return rows;
}

function formatSubscriptionLine(sub, index) {
	const voteEntry = getVoteUrlEntryById(sub.voteUrlId);
	const label = voteEntry ? `${voteEntry.label} (${voteEntry.id})` : tr('Serveur inconnu', 'Unknown server');
	const tz = sub.timezone || config.timezone || 'Europe/Paris';
	const windowText = sub.window ? `${sub.window.start}-${sub.window.end}` : tr('toute la journée', 'all day');
	const modeText = sub.mode === 'channel'
		? tr('Ping {channel}', 'Ping {channel}', { channel: sub.channelId ? `<#${sub.channelId}>` : tr('(salon non configuré)', '(channel not set)') })
		: tr('MP', 'DM');
	const cooldown = voteEntry?.cooldownMinutes ? `${voteEntry.cooldownMinutes}m` : tr('inconnu', 'unknown');
	const timerText = getNextReminderLabel(sub);
	return tr(
		'{index}. {label} | {window} | TZ {tz} | {mode} | {cooldown} | {timer}',
		'{index}. {label} | {window} | TZ {tz} | {mode} | {cooldown} | {timer}',
		{ index: index + 1, label, window: windowText, tz, mode: modeText, cooldown, timer: timerText }
	);
}

function formatStatusMessage(userId) {
	const subs = subscriptions.filter(sub => sub.userId === userId);
	if (subs.length === 0) {
		return tr('Aucun abonnement actif.', 'No active subscriptions.');
	}
	const lines = subs.map((sub, idx) => formatSubscriptionLine(sub, idx));
	const summary = [
		tr('Nombre d’abonnements : {count}', 'Number of subscriptions: {count}', { count: subs.length }),
		...lines,
		tr('Utilisez le menu pour sélectionner un abonnement.', 'Use the menu to choose a subscription.')
	];
	if (subs.length > 25) {
		summary.push(tr('Seuls les 25 premiers abonnements apparaissent dans le menu pour modifications rapides.', 'Only the first 25 subscriptions appear in the quick-edit menu.'));
	}
	return summary.join('\n');
}

function buildStatusComponents(userId, selectedId) {
	const subs = subscriptions.filter(sub => sub.userId === userId);
	if (subs.length === 0) return [];
	const limited = subs.slice(0, 25);
	const select = new StringSelectMenuBuilder()
		.setCustomId('status-select-subscription')
		.setPlaceholder(tr('Choisissez un abonnement à gérer', 'Choose a subscription to manage'))
		.setMinValues(1)
		.setMaxValues(1);
	for (const sub of limited) {
		const entry = getVoteUrlEntryById(sub.voteUrlId);
		const label = entry ? entry.label : tr('Serveur inconnu', 'Unknown server');
		const tz = sub.timezone || config.timezone || 'Europe/Paris';
		const timerDesc = getNextReminderLabel(sub).replace('Timer:', tr('Timer', 'Timer')).trim();
		const description = sub.window
			? tr('{start}-{end} ({tz}) | {timer}', '{start}-{end} ({tz}) | {timer}', {
				start: sub.window.start,
				end: sub.window.end,
				tz,
				timer: timerDesc
			})
			: tr('Toute la journée ({tz}) | {timer}', 'All day ({tz}) | {timer}', { tz, timer: timerDesc });
		select.addOptions({
			label: label.slice(0, 100),
			value: sub.id,
			description: description.slice(0, 100),
			default: sub.id === selectedId
		});
	}
	if (selectedId && !limited.some(sub => sub.id === selectedId)) {
		const selectedSub = subs.find(sub => sub.id === selectedId);
		if (selectedSub) {
			const entry = getVoteUrlEntryById(selectedSub.voteUrlId);
			const label = entry ? entry.label : tr('Serveur inconnu', 'Unknown server');
			const tz = selectedSub.timezone || config.timezone || 'Europe/Paris';
			const timerDesc = getNextReminderLabel(selectedSub).replace('Timer:', tr('Timer', 'Timer')).trim();
			const description = selectedSub.window
				? tr('{start}-{end} ({tz}) | {timer}', '{start}-{end} ({tz}) | {timer}', {
					start: selectedSub.window.start,
					end: selectedSub.window.end,
					tz,
					timer: timerDesc
				})
				: tr('Toute la journée ({tz}) | {timer}', 'All day ({tz}) | {timer}', { tz, timer: timerDesc });
			select.addOptions({
				label: label.slice(0, 100),
				value: selectedSub.id,
				description: description.slice(0, 100),
				default: true
			});
		}
	}
	const buttonRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId('status-edit').setLabel(tr('Modifier', 'Edit')).setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId('status-delete').setLabel(tr('Supprimer', 'Delete')).setStyle(ButtonStyle.Danger)
	);
	return [
		new ActionRowBuilder().addComponents(select),
		buttonRow
	];
}

function renderStatusEditSummary(sub, editSession) {
	const entry = getVoteUrlEntryById(sub.voteUrlId);
	const label = entry ? `${entry.label} (${entry.id})` : tr('Serveur inconnu', 'Unknown server');
	const lines = [
		tr('Modification de l’abonnement {id}', 'Editing subscription {id}', { id: sub.id }),
		tr('Serveur : {label}', 'Server: {label}', { label }),
		editSession.windowStart && editSession.windowEnd
			? tr('Plage : {start}-{end}', 'Window: {start}-{end}', { start: editSession.windowStart, end: editSession.windowEnd })
			: tr('Plage : sélectionnez début et fin', 'Window: pick a start and end'),
		editSession.mode === 'channel' ? tr('Mode : Ping salon', 'Mode: Channel ping') : tr('Mode : MP', 'Mode: DM'),
		tr('Utilisez les menus puis cliquez sur Valider ou Annuler.', 'Use the menus then press Confirm or Cancel.')
	];
	if (editSession.mode === 'channel' && (!entry || !entry.channelId)) {
		lines.push(tr('Attention : ce serveur n’a pas de salon configuré. Choisissez MP ou configurez un salon.', 'Warning: this server has no configured channel. Pick DM or configure one.'));
	}
	return lines.join('\n');
}

function buildStatusEditComponents(editSession) {
	syncSubscribeSessionWindow(editSession);
	const startPage = editSession.startPage ?? 0;
	const endPage = editSession.endPage ?? 0;
	const startMenu = buildTimeMenu(
		'status-edit-start-time',
		editSession.startTime || null,
		startPage,
		startPage === 1
			? tr('Début (12h00-23h30)', 'Start (12:00-23:30)')
			: tr('Début (00h00-11h30)', 'Start (00:00-11:30)')
	);
	const endMenu = buildTimeMenu(
		'status-edit-end-time',
		editSession.endTime || null,
		endPage,
		endPage === 1
			? tr('Fin (12h00-23h30)', 'End (12:00-23:30)')
			: tr('Fin (00h00-11h30)', 'End (00:00-11:30)')
	);
	const modeMenu = new StringSelectMenuBuilder()
		.setCustomId('status-edit-mode')
		.setPlaceholder(tr('Mode de rappel', 'Reminder mode'))
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions([
			{
				label: tr('MP', 'DM'),
				value: 'dm',
				description: tr('Envoyer un message privé', 'Send a direct message'),
				default: editSession.mode === 'dm'
			},
			{
				label: tr('Ping salon', 'Channel ping'),
				value: 'channel',
				description: tr('Mentionner dans le salon configuré', 'Mention in the configured channel'),
				default: editSession.mode === 'channel'
			}
		]);
	const confirmButton = new ButtonBuilder()
		.setCustomId('status-edit-confirm')
		.setLabel(tr('Valider', 'Confirm'))
		.setStyle(ButtonStyle.Success)
		.setDisabled(!(editSession.windowStart && editSession.windowEnd && editSession.mode));
	const cancelButton = new ButtonBuilder()
		.setCustomId('status-edit-cancel')
		.setLabel(tr('Annuler', 'Cancel'))
		.setStyle(ButtonStyle.Secondary);
	return [
		new ActionRowBuilder().addComponents(startMenu),
		new ActionRowBuilder().addComponents(endMenu),
		new ActionRowBuilder().addComponents(modeMenu),
		new ActionRowBuilder().addComponents(confirmButton, cancelButton)
	];
}

function buildUnsubscribeComponents(userId, choice) {
	const subs = subscriptions.filter(sub => sub.userId === userId);
	if (subs.length === 0) return [];
	const sanitizedChoice = subs.some(sub => sub.id === choice) ? choice : 'all';
	const limited = subs.slice(0, 24); // keep room for "all"
	const select = new StringSelectMenuBuilder()
		.setCustomId('unsubscribe-select')
		.setPlaceholder(tr('Choisissez un abonnement à supprimer', 'Choose a subscription to delete'))
		.setMinValues(1)
		.setMaxValues(1);
	for (const sub of limited) {
		const entry = getVoteUrlEntryById(sub.voteUrlId);
		const label = entry ? entry.label : tr('Serveur inconnu', 'Unknown server');
		const tz = sub.timezone || config.timezone || 'Europe/Paris';
		const timerDesc = getNextReminderLabel(sub).replace('Timer:', tr('Timer', 'Timer')).trim();
		const description = sub.window
			? tr('{start}-{end} ({tz}) | {timer}', '{start}-{end} ({tz}) | {timer}', {
				start: sub.window.start,
				end: sub.window.end,
				tz,
				timer: timerDesc
			})
			: tr('Toute la journée ({tz}) | {timer}', 'All day ({tz}) | {timer}', { tz, timer: timerDesc });
		select.addOptions({
			label: label.slice(0, 100),
			value: sub.id,
			description: description.slice(0, 100),
			default: sub.id === sanitizedChoice
		});
	}
	select.addOptions({
		label: tr('Tous mes abonnements', 'All my subscriptions'),
		value: 'all',
		default: sanitizedChoice === 'all'
	});
	const buttons = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId('unsubscribe-confirm').setLabel(tr('Confirmer', 'Confirm')).setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId('unsubscribe-cancel').setLabel(tr('Annuler', 'Cancel')).setStyle(ButtonStyle.Secondary)
	);
	return [
		new ActionRowBuilder().addComponents(select),
		buttons
	];
}

function log(level, message, meta) {
	const timestamp = new Date().toISOString();
	const formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
	if (meta && Object.keys(meta).length > 0) {
		const serializedMeta = JSON.stringify(meta);
		if (level === 'error') {
			console.error(`${formatted} ${serializedMeta}`);
		} else if (level === 'warn') {
			console.warn(`${formatted} ${serializedMeta}`);
		} else {
			console.log(`${formatted} ${serializedMeta}`);
		}
		return;
	}
	if (level === 'error') {
		console.error(formatted);
	} else if (level === 'warn') {
		console.warn(formatted);
	} else {
		console.log(formatted);
	}
}

function serializeError(err) {
	if (!err) return undefined;
	if (typeof err === 'string') return { message: err };
	return {
		name: err.name,
		message: err.message,
		stack: err.stack,
		code: err.code,
		status: err.status,
		httpStatus: err.statusCode
	};
}

function buildVoteUrlForUser(username, voteUrlId) {
	// Le site peut ne pas supporter le pre-remplissage via query, mais on encode le pseudo.
	const entry = getVoteUrlEntryById(voteUrlId);
	const baseUrl = entry?.url || config.voteBaseUrl;
	if (!baseUrl) return null;
	const url = new URL(baseUrl);
	url.searchParams.set('pseudo', username);
	return url.toString();
}

function signToken(payload) {
	const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const sig = crypto.createHmac('sha256', MARK_SECRET || 'dev-secret').update(data).digest('base64url');
	return `${data}.${sig}`;
}

function verifyToken(tokenStr) {
	const [data, sig] = tokenStr.split('.');
	if (!data || !sig) return null;
	const expected = crypto.createHmac('sha256', MARK_SECRET || 'dev-secret').update(data).digest('base64url');
	if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
	try {
		const json = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
		return json;
	} catch {
		return null;
	}
}

function buildReminderButtons(sub, redirectUrl, directVoteUrl) {
	if (PUBLIC_BASE_URL) {
		const openBtn = new ButtonBuilder()
			.setLabel(tr('Voter maintenant', 'Vote now'))
			.setStyle(ButtonStyle.Link)
			.setURL(redirectUrl);
		return new ActionRowBuilder().addComponents(openBtn);
	}
	const voteBtn = new ButtonBuilder()
		.setLabel(tr('Voter maintenant', 'Vote now'))
		.setStyle(ButtonStyle.Link)
		.setURL(directVoteUrl);
	const resetBtn = new ButtonBuilder()
		.setCustomId(`reminder-reset|${sub.id}`)
		.setLabel(tr('Relancer le timer', 'Reset timer'))
		.setStyle(ButtonStyle.Primary);
	return new ActionRowBuilder().addComponents(voteBtn, resetBtn);
}

function formatDurationShort(ms) {
	const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
	}
	if (minutes > 0) {
		return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
	}
	return `${seconds}s`;
}

function getNextReminderLabel(sub) {
	const cooldownMs = getCooldownMsForSubscriber(sub);
	const base = Math.max(sub.lastVotedAt || 0, sub.lastReminderAt || 0);
	if (!base) {
		if (sub.window?.start) return `Timer: premier rappel vers ${sub.window.start}`;
		return 'Timer: en attente de programmation';
	}
	const remaining = base + cooldownMs - Date.now();
	if (remaining <= 0) return 'Timer: pret';
	return `Timer: ${formatDurationShort(remaining)}`;
}

async function getDisplayNameForUser(contextGuildId, userId, fallbackUsername) {
	if (contextGuildId) {
		try {
			const guild = await client.guilds.fetch(contextGuildId);
			const member = await guild.members.fetch(userId);
			return member.displayName || fallbackUsername;
		} catch {
			return fallbackUsername;
		}
	}
	return fallbackUsername;
}

async function deliverReminderViaChannel(sub, components, context) {
	try {
		const channel = await client.channels.fetch(sub.channelId);
		if (!channel) {
			log('warn', 'Channel introuvable pour le rappel', context);
			return false;
		}
		if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
			log('warn', 'Type de channel incompatible pour rappel', { ...context, channelType: channel.type });
			return false;
		}
		await channel.send({
			content: tr('<@{userId}> Rappel de vote', '<@{userId}> Vote reminder', { userId: sub.userId }),
			components
		});
		log('info', 'Rappel envoye sur le channel', context);
		return true;
	} catch (err) {
		log('error', 'Echec de lenvoi du rappel sur le channel', { ...context, error: serializeError(err) });
		return false;
	}
}

async function deliverReminderViaDm(user, components, context, isFallback) {
	try {
		await user.send({
			content: tr('Rappel de vote !', 'Vote reminder!'),
			components
		});
		log('info', isFallback ? 'Rappel envoye en MP (fallback)' : 'Rappel envoye en MP', context);
		return true;
	} catch (err) {
		log('error', 'Echec de lenvoi du rappel en MP', { ...context, error: serializeError(err) });
		return false;
	}
}

async function sendVoteReminder(sub) {
	const now = Date.now();
	const base = Math.max(sub.lastVotedAt || 0, sub.lastReminderAt || 0);
	const cooldownMs = getCooldownMsForSubscriber(sub);
	if (base && now < base + cooldownMs) return;
	const user = await client.users.fetch(sub.userId);
	const displayName = await getDisplayNameForUser(sub.guildId, sub.userId, user.username);
	const voteTarget = buildVoteUrlForUser(displayName, sub.voteUrlId);
	if (!voteTarget) {
		log('warn', 'Aucune URL de vote disponible pour le rappel', { userId: sub.userId, voteUrlId: sub.voteUrlId || null });
		return;
	}
	let redirectUrl = voteTarget;
	if (PUBLIC_BASE_URL) {
		const token = signToken({ uid: sub.userId, gid: sub.guildId || null, iat: Date.now() });
		redirectUrl = `${PUBLIC_BASE_URL.replace(/\/+$/,'')}/v?t=${encodeURIComponent(token)}`;
	}
	const context = {
		userId: sub.userId,
		guildId: sub.guildId || null,
		mode: sub.mode || 'dm',
		channelId: sub.channelId || null,
		displayName,
		voteUrlId: sub.voteUrlId || null
	};
	const channelComponents = [buildReminderButtons(sub, redirectUrl, voteTarget)];
	const dmComponents = [buildReminderButtons(sub, redirectUrl, voteTarget)];
	let delivered = false;
	if (sub.mode === 'channel' && sub.channelId) {
		delivered = await deliverReminderViaChannel(sub, channelComponents, context);
		if (!delivered) {
			log('warn', 'Echec du rappel via channel, tentative en MP', context);
		}
	} else if (sub.mode === 'channel') {
		log('warn', 'Mode channel demande mais aucun channelId stocke', context);
	}
	if (!delivered) {
		delivered = await deliverReminderViaDm(user, dmComponents, context, sub.mode === 'channel');
	}
	if (delivered) {
		sub.lastReminderAt = now;
		saveSubscriptions(subscriptions);
	} else {
		log('warn', 'Rappel non envoye: aucune route disponible', context);
	}
}

function isValidTime(hhmm) {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
	return !!m;
}

function isHalfHour(hhmm) {
	if (!isValidTime(hhmm)) return false;
	return hhmm.endsWith(':00') || hhmm.endsWith(':30');
}

function timeStringToMinutes(hhmm) {
	if (!isValidTime(hhmm)) return null;
	const [h, m] = hhmm.split(':').map(v => parseInt(v, 10));
	return h * 60 + m;
}

function getTimePage(value) {
	const minutes = timeStringToMinutes(value);
	if (minutes === null) return 0;
	return minutes >= 12 * 60 ? 1 : 0;
}

function withinWindow(now, windowObj, timezone) {
	if (!windowObj) return true;
	// Compute in timezone by using Intl and minutes from midnight in that TZ
	const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit' });
	const parts = fmt.formatToParts(now);
	const hh = parseInt(parts.find(p => p.type === 'hour').value, 10);
	const mm = parseInt(parts.find(p => p.type === 'minute').value, 10);
	const nowMin = hh * 60 + mm;
	const [sh, sm] = windowObj.start.split(':').map(x => parseInt(x, 10));
	const [eh, em] = windowObj.end.split(':').map(x => parseInt(x, 10));
	const startMin = sh * 60 + sm;
	const endMin = eh * 60 + em;
	if (startMin <= endMin) {
		return nowMin >= startMin && nowMin <= endMin;
	}
	// Overnight window (e.g., 22:00-06:00)
	return nowMin >= startMin || nowMin <= endMin;
}

function getTzTimeParts(date, timezone) {
	const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit' });
	const parts = fmt.formatToParts(date);
	const hh = parseInt(parts.find(p => p.type === 'hour').value, 10);
	const mm = parseInt(parts.find(p => p.type === 'minute').value, 10);
	return { hh, mm, total: hh * 60 + mm };
}

function tzDayString(ts, timezone) {
	const d = new Date(ts);
	const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
	// en-CA gives YYYY-MM-DD
	return fmt.format(d);
}

function stopSubscriptionTask(subscriptionId) {
	const task = subscriptionCronTasks.get(subscriptionId);
	if (task) {
		try { task.stop(); } catch {}
	}
	subscriptionCronTasks.delete(subscriptionId);
}

function scheduleSubscription(subscription) {
	stopSubscriptionTask(subscription.id);
	const timezone = subscription.timezone || config.timezone || 'Europe/Paris';
	const task = cron.schedule('*/1 * * * *', async () => {
		const sub = subscriptions.find(s => s.id === subscription.id);
		if (!sub) {
			stopSubscriptionTask(subscription.id);
			return;
		}
		const now = new Date();
		const timeParts = getTzTimeParts(now, timezone);
		if (!withinWindow(now, sub.window, timezone)) return;
		try {
			const todayStr = tzDayString(Date.now(), timezone);
			const sentToday = sub.lastReminderAt && tzDayString(sub.lastReminderAt, timezone) === todayStr;
			const startMin = sub.window ? timeStringToMinutes(sub.window.start) : null;
			if (!sentToday) {
				if (startMin !== null && timeParts.total !== startMin) {
					return;
				}
				await sendVoteReminder(sub);
				return;
			}
			if (sub.lastVotedAt && sub.lastVotedAt > (sub.lastReminderAt || 0)) {
				if (Date.now() >= sub.lastVotedAt + getCooldownMsForSubscriber(sub)) {
					await sendVoteReminder(sub);
				}
			}
		} catch (err) {
			log('error', 'Erreur lors de lexecution de la tache de rappel', { subscriptionId: sub.id, userId: sub.userId, error: serializeError(err) });
		}
	}, { timezone });
	subscriptionCronTasks.set(subscription.id, task);
}

function scheduleAll() {
	log('info', 'Replanification des rappels', { count: subscriptions.length });
	for (const [subId] of subscriptionCronTasks) stopSubscriptionTask(subId);
	for (const s of subscriptions) {
		if (s.userId && s.voteUrlId) {
			scheduleSubscription(s);
		}
	}
}

client.once(Events.ClientReady, () => {
	log('info', 'Client pret', { tag: client.user.tag });
	scheduleAll();
});

client.on(Events.InteractionCreate, async (interaction) => {
	if (interaction.isAutocomplete()) {
		try {
			await interaction.respond([]);
		} catch (err) {
			log('error', 'Autocomplete error', { error: serializeError(err) });
		}
		return;
	}

	if (interaction.isModalSubmit()) {
		try {
			if (interaction.customId === 'addvote-modal') {
				const labelRaw = interaction.fields.getTextInputValue('display_name')?.trim();
				const urlRaw = interaction.fields.getTextInputValue('vote_url')?.trim();
				const channelRaw = interaction.fields.getTextInputValue('channel_id')?.trim();
				const cooldownRaw = interaction.fields.getTextInputValue('cooldown')?.trim();
				if (!labelRaw) {
					await interaction.reply({ content: tr('Le nom ne peut pas être vide.', 'Name cannot be empty.'), ephemeral: true });
					return;
				}
				if (!urlRaw) {
					await interaction.reply({ content: tr('L’URL ne peut pas être vide.', 'URL cannot be empty.'), ephemeral: true });
					return;
				}
				try {
					new URL(urlRaw);
				} catch {
					await interaction.reply({ content: tr('URL invalide.', 'Invalid URL.'), ephemeral: true });
					return;
				}
				let channelId = null;
				if (channelRaw) {
					const normalized = channelRaw.replace(/[<#>]/g, '');
					if (!/^\d{15,21}$/.test(normalized)) {
						await interaction.reply({
							content: tr('ID de salon invalide. Utilisez l’identifiant numérique du salon.', 'Invalid channel ID. Use the numeric channel identifier.'),
							ephemeral: true
						});
						return;
					}
					channelId = normalized;
				}
				if (!cooldownRaw) {
					await interaction.reply({ content: tr('Merci d’indiquer un délai.', 'Please provide a cooldown.'), ephemeral: true });
					return;
				}
				const normalizedCooldown = cooldownRaw.toLowerCase().replace(/\s+/g, '');
				let minutes = Number.parseInt(normalizedCooldown, 10);
				if (!Number.isNaN(minutes)) {
					if (/[a-z]/.test(normalizedCooldown)) {
						minutes *= 60;
					}
				} else {
					const match = /^(\d+)(h|heure|heures)?$/i.exec(normalizedCooldown);
					if (match) {
						minutes = Number.parseInt(match[1], 10) * 60;
					}
				}
				if (!Number.isFinite(minutes)) {
					const allowedText = COOLDOWN_CHOICES.map(choice => `${choice.minutes} (${choice.label})`).join(', ');
					await interaction.reply({
						content: tr('Délai invalide. Choix possibles : {choices}.', 'Invalid cooldown. Allowed values: {choices}.', { choices: allowedText }),
						ephemeral: true
					});
					return;
				}
				const allowedMinutes = COOLDOWN_CHOICES.map(choice => choice.minutes);
				if (!allowedMinutes.includes(minutes)) {
					const allowedText = COOLDOWN_CHOICES.map(choice => `${choice.minutes} (${choice.label})`).join(', ');
					await interaction.reply({
						content: tr('Délai invalide. Choix possibles : {choices}.', 'Invalid cooldown. Allowed values: {choices}.', { choices: allowedText }),
						ephemeral: true
					});
					return;
				}
				const chosenCooldown = COOLDOWN_CHOICES.find(choice => choice.minutes === minutes);
				const allEntries = getVoteUrlEntries();
				const id = generateVoteUrlId(labelRaw);
				const entry = { id, label: labelRaw, url: urlRaw, cooldownMinutes: minutes, channelId };
				config.voteUrls = [...allEntries, entry];
				let updatedSubscriptions = 0;
				if (!config.defaultVoteUrlId) {
					config.defaultVoteUrlId = id;
					for (const sub of subscriptions) {
						if (!sub.voteUrlId) {
							sub.voteUrlId = id;
							if (sub.mode === 'channel') {
								sub.channelId = channelId || null;
							}
							updatedSubscriptions += 1;
							scheduleSubscription(sub);
						}
					}
					if (updatedSubscriptions > 0) {
						saveSubscriptions(subscriptions);
					}
				}
				syncLegacyVoteBaseUrl();
				saveConfig(config);
				scheduleAll();
				log('info', 'URL ajoutee via /addvote', {
					userId: interaction.user.id,
					label: entry.label,
					url: entry.url,
					cooldownMinutes: entry.cooldownMinutes,
					channelId: entry.channelId || null
				});
				await interaction.reply({
					content: [
						tr('URL ajoutée : {label} ({id})', 'Vote URL added: {label} ({id})', { label: entry.label, id: entry.id }),
						tr('Délai : {minutes} minutes{label}', 'Cooldown: {minutes} minutes{label}', {
							minutes: entry.cooldownMinutes,
							label: chosenCooldown ? ` (${chosenCooldown.label})` : ''
						}),
						entry.channelId
							? tr('Salon : <#{channel}>', 'Channel: <#{channel}>', { channel: entry.channelId })
							: tr('Salon : MP', 'Channel: DM')
					].join('\n'),
					ephemeral: true
				});
				return;
			}
			if (interaction.customId === 'listvote-edit-modal') {
				const session = listVoteSessions.get(interaction.user.id);
				if (!session?.selectedId) {
					await interaction.reply({ content: tr('Session invalide. Relancez /listvote.', 'Invalid session. Run /listvote again.'), ephemeral: true });
					return;
				}
				const entries = getVoteUrlEntries();
				const idx = entries.findIndex(entry => entry.id === session.selectedId);
				if (idx === -1) {
					await interaction.reply({ content: tr('Entrée introuvable. Relancez /listvote.', 'Entry not found. Run /listvote again.'), ephemeral: true });
					return;
				}
				const current = entries[idx];
				const label = interaction.fields.getTextInputValue('edit_display_name')?.trim();
				const urlStr = interaction.fields.getTextInputValue('edit_vote_url')?.trim();
				const cooldownStr = interaction.fields.getTextInputValue('edit_cooldown')?.trim();
				const channelRaw = interaction.fields.getTextInputValue('edit_channel_id')?.trim();
				if (!label) {
					await interaction.reply({ content: tr('Le nom ne peut pas être vide.', 'Name cannot be empty.'), ephemeral: true });
					return;
				}
				if (!urlStr) {
					await interaction.reply({ content: tr('L’URL ne peut pas être vide.', 'URL cannot be empty.'), ephemeral: true });
					return;
				}
				try {
					new URL(urlStr);
				} catch {
					await interaction.reply({ content: tr('URL invalide.', 'Invalid URL.'), ephemeral: true });
					return;
				}
				const cooldown = parseInt(cooldownStr || '0', 10);
				if (!Number.isFinite(cooldown) || cooldown <= 0) {
					await interaction.reply({ content: tr('Le délai doit être un nombre de minutes positif.', 'Cooldown must be a positive number of minutes.'), ephemeral: true });
					return;
				}
				let channelId = null;
				if (channelRaw) {
					const normalized = channelRaw.replace(/[<#>]/g, '');
					if (!/^\d{15,21}$/.test(normalized)) {
						await interaction.reply({
							content: tr('ID de salon invalide. Utilisez l’identifiant numérique du salon.', 'Invalid channel ID. Use the numeric channel identifier.'),
							ephemeral: true
						});
						return;
					}
					channelId = normalized;
				}
				const updatedEntry = { ...current, label, url: urlStr, cooldownMinutes: cooldown, channelId };
				const newEntries = [...entries];
				newEntries[idx] = updatedEntry;
				config.voteUrls = newEntries;
				syncLegacyVoteBaseUrl();
				saveConfig(config);
				let updatedSubs = 0;
				for (const sub of subscriptions) {
					if (sub.voteUrlId === current.id) {
						if (sub.mode === 'channel') {
							sub.channelId = channelId || null;
						}
						updatedSubs += 1;
						scheduleSubscription(sub);
					}
				}
				if (updatedSubs > 0) {
					saveSubscriptions(subscriptions);
				}
				scheduleAll();
				if (interaction.message) {
					try {
						await interaction.message.edit({
							content: renderListVoteSummary(updatedEntry),
							components: buildListVoteComponents(newEntries, session.selectedId)
						});
					} catch (err) {
						log('error', 'Edition de message listvote apres modification', { error: serializeError(err) });
					}
				}
					await interaction.reply({ content: tr('Entrée mise à jour.', 'Entry updated.'), ephemeral: true });
				return;
			}
		} catch (err) {
			log('error', 'Modal handling error', { error: serializeError(err) });
			if (!interaction.replied && !interaction.deferred) {
				try {
				await interaction.reply({ content: tr('Erreur interne. Merci de réessayer.', 'Internal error. Please try again.'), ephemeral: true });
				} catch {
					// ignore
				}
			} else if (interaction.deferred) {
				try {
				await interaction.editReply({ content: tr('Erreur interne. Merci de réessayer.', 'Internal error. Please try again.'), components: [] });
				} catch {
					// ignore
				}
			}
		}
		return;
	}

	if (interaction.isStringSelectMenu()) {
		try {
			if (interaction.customId === 'status-edit-start-time' || interaction.customId === 'status-edit-end-time' || interaction.customId === 'status-edit-mode') {
				const mapping = statusSessions.get(interaction.user.id) || {};
				const editSession = mapping.editSession;
				if (!editSession) {
					await interaction.update({ content: tr('Session de modification expirée. Relancez /status.', 'Edit session expired. Run /status again.'), components: [] });
					return;
				}
				const sub = subscriptions.find(s => s.id === editSession.subscriptionId && s.userId === interaction.user.id);
				if (!sub) {
					delete mapping.editSession;
					statusSessions.set(interaction.user.id, mapping);
					await interaction.update({ content: tr('Abonnement introuvable. Relancez /status.', 'Subscription not found. Run /status again.'), components: [] });
					return;
				}
				const value = interaction.values?.[0];
				if (!value) {
					await interaction.reply({ content: tr('Sélection invalide.', 'Invalid selection.'), ephemeral: true });
					return;
				}
				if (interaction.customId === 'status-edit-mode') {
					editSession.mode = value;
				} else if (interaction.customId === 'status-edit-start-time') {
					if (value === '__next__') {
						editSession.startPage = 1;
					} else if (value === '__prev__') {
						editSession.startPage = 0;
					} else {
						editSession.startTime = value;
						editSession.startPage = getTimePage(value);
					}
				} else if (interaction.customId === 'status-edit-end-time') {
					if (value === '__next__') {
						editSession.endPage = 1;
					} else if (value === '__prev__') {
						editSession.endPage = 0;
					} else {
						editSession.endTime = value;
						editSession.endPage = getTimePage(value);
					}
				}
				syncSubscribeSessionWindow(editSession);
				statusSessions.set(interaction.user.id, mapping);
				await interaction.update({
					content: renderStatusEditSummary(sub, editSession),
					components: buildStatusEditComponents(editSession)
				});
				return;
			}
			if (interaction.customId === 'subscribe-select-vote' || interaction.customId === 'subscribe-select-start-time' || interaction.customId === 'subscribe-select-end-time' || interaction.customId === 'subscribe-select-mode') {
				const session = subscribeSessions.get(interaction.user.id);
				if (!session) {
					await interaction.update({ content: tr('Session expirée. Relancez /subscribe.', 'Session expired. Run /subscribe again.'), components: [] });
					return;
				}
				const entries = getVoteUrlEntries();
				if (entries.length === 0) {
					await interaction.update({ content: tr('Aucune URL disponible.', 'No vote URL available.'), components: [] });
					subscribeSessions.delete(interaction.user.id);
					return;
				}
				if (interaction.customId === 'subscribe-select-vote') {
					session.voteUrlId = interaction.values[0];
				} else if (interaction.customId === 'subscribe-select-start-time') {
					const value = interaction.values[0];
					if (value === '__next__') {
						session.startPage = 1;
					} else if (value === '__prev__') {
						session.startPage = 0;
					} else {
						session.startTime = value;
						session.startPage = getTimePage(value);
					}
				} else if (interaction.customId === 'subscribe-select-end-time') {
					const value = interaction.values[0];
					if (value === '__next__') {
						session.endPage = 1;
					} else if (value === '__prev__') {
						session.endPage = 0;
					} else {
						session.endTime = value;
						session.endPage = getTimePage(value);
					}
				} else if (interaction.customId === 'subscribe-select-mode') {
					session.mode = interaction.values[0];
				}
		const summary = renderSubscribeSummary(session, entries);
				await interaction.update({
					content: summary,
					components: buildSubscribeComponents(entries, session)
				});
				return;
			}
			if (interaction.customId === 'listvote-select-entry') {
				const entries = getVoteUrlEntries();
				if (entries.length === 0) {
					await interaction.update({ content: tr('Aucune entrée disponible.', 'No entries available.'), components: [] });
					return;
				}
				const selectedId = interaction.values?.[0];
				if (!selectedId) {
					await interaction.reply({ content: tr('Sélection invalide.', 'Invalid selection.'), ephemeral: true });
					return;
				}
				const entry = entries.find(e => e.id === selectedId);
				if (!entry) {
					await interaction.reply({ content: tr('Entrée introuvable.', 'Entry not found.'), ephemeral: true });
					return;
				}
				const session = listVoteSessions.get(interaction.user.id) || {};
				session.selectedId = selectedId;
				listVoteSessions.set(interaction.user.id, session);
				await interaction.update({
					content: renderListVoteSummary(entry),
					components: buildListVoteComponents(entries, selectedId)
				});
				return;
			}
			if (interaction.customId === 'unsubscribe-select') {
				const session = interaction.values?.[0];
				if (!session) {
					await interaction.update({ content: tr('Sélection invalide.', 'Invalid selection.'), components: [] });
					return;
				}
				const mapping = statusSessions.get(interaction.user.id) || {};
				mapping.unsubscribeChoice = session;
				statusSessions.set(interaction.user.id, mapping);
				await interaction.update({
					content: session === 'all'
						? tr('Choisissez l’abonnement à supprimer (ou Tous).\nSélection : tous vos abonnements.', 'Choose which subscription to delete (or All).\nSelection: all subscriptions.')
						: tr('Choisissez l’abonnement à supprimer (ou Tous).\nSélection : {id}', 'Choose which subscription to delete (or All).\nSelection: {id}', { id: session }),
					components: buildUnsubscribeComponents(interaction.user.id, session)
				});
				return;
			}
			if (interaction.customId === 'status-select-subscription') {
				const subs = subscriptions.filter(sub => sub.userId === interaction.user.id);
				if (subs.length === 0) {
					await interaction.update({ content: tr('Aucun abonnement.', 'No subscriptions.'), components: [] });
					return;
				}
				const selectedId = interaction.values?.[0];
				if (!selectedId) {
					await interaction.reply({ content: tr('Sélection invalide.', 'Invalid selection.'), ephemeral: true });
					return;
				}
				const sub = subs.find(s => s.id === selectedId);
				if (!sub) {
					await interaction.reply({ content: tr('Abonnement introuvable.', 'Subscription not found.'), ephemeral: true });
					return;
				}
				const mapping = statusSessions.get(interaction.user.id) || {};
				mapping.selectedId = selectedId;
				statusSessions.set(interaction.user.id, mapping);
				await interaction.update({
					content: formatStatusMessage(interaction.user.id),
					components: buildStatusComponents(interaction.user.id, selectedId)
				});
				return;
			}
		} catch (err) {
			log('error', 'Select menu error', { error: serializeError(err) });
			if (!interaction.replied && !interaction.deferred) {
				try {
					await interaction.reply({ content: tr('Erreur interne. Merci de réessayer.', 'Internal error. Please try again.'), ephemeral: true });
				} catch {
					// ignore
				}
			}
		}
		return;
	}

	if (interaction.isButton()) {
		try {
			if (interaction.customId.startsWith('reminder-reset|')) {
				const [, subId] = interaction.customId.split('|');
				const sub = subscriptions.find(s => s.id === subId);
				if (!sub) {
					await interaction.reply({ content: tr('Abonnement introuvable ou expiré.', 'Subscription not found or expired.'), ephemeral: true });
					return;
				}
				if (interaction.user.id !== sub.userId) {
					await interaction.reply({ content: tr('Ce bouton est réservé au destinataire du rappel.', 'This button is reserved for the reminder recipient.'), ephemeral: true });
					return;
				}
				const user = await client.users.fetch(sub.userId);
				const displayName = await getDisplayNameForUser(sub.guildId, sub.userId, user.username);
				const voteTarget = buildVoteUrlForUser(displayName, sub.voteUrlId);
				if (!voteTarget) {
					await interaction.reply({ content: tr('Aucune URL de vote configurée.', 'No vote URL configured.'), ephemeral: true });
					return;
				}
				sub.lastVotedAt = Date.now();
				saveSubscriptions(subscriptions);
				scheduleSubscription(sub);
				log('info', 'Vote marque via bouton', { userId: sub.userId, subscriptionId: sub.id });
				const replyPayload = {
					content: tr('Timer relancé. Cliquez sur “Voter maintenant” pour ouvrir la page.', 'Timer reset. Use “Vote now” to open the page.')
				};
				if (interaction.inGuild()) {
					replyPayload.ephemeral = true;
				}
				await interaction.reply(replyPayload);
				return;
			}
			if (interaction.customId === 'subscribe-confirm') {
				const session = subscribeSessions.get(interaction.user.id);
				if (!session) {
					await interaction.update({ content: tr('Session expirée. Relancez /subscribe.', 'Session expired. Run /subscribe again.'), components: [] });
					return;
				}
				syncSubscribeSessionWindow(session);
				const entries = getVoteUrlEntries();
				const voteEntry = session.voteUrlId ? entries.find(e => e.id === session.voteUrlId) : null;
				if (!voteEntry) {
					await interaction.reply({ content: tr('Merci de sélectionner un serveur.', 'Please select a server.'), ephemeral: true });
					return;
				}
				if (!session.windowStart || !session.windowEnd) {
					await interaction.reply({ content: tr('Merci de sélectionner une plage horaire.', 'Please select a reminder window.'), ephemeral: true });
					return;
				}
				if (!isHalfHour(session.windowStart) || !isHalfHour(session.windowEnd)) {
					await interaction.reply({ content: tr('Les horaires doivent être au format HH:MM et multiples de 30 minutes.', 'Times must be HH:MM and in 30-minute increments.'), ephemeral: true });
					return;
				}
				let channelId = undefined;
				if (session.mode === 'channel') {
					if (!voteEntry.channelId) {
						await interaction.reply({ content: tr('Aucun salon configuré pour ce serveur. Choisissez MP ou configurez un salon.', 'No channel configured for this server. Pick DM or configure a channel.'), ephemeral: true });
						return;
					}
					channelId = voteEntry.channelId;
				}
				const fields = {
					window: { start: session.windowStart, end: session.windowEnd },
					mode: session.mode,
					channelId: session.mode === 'channel' ? channelId : undefined,
					guildId: session.guildId || interaction.guildId || undefined,
					lastKnownDisplayName: interaction.member?.displayName || interaction.user.username,
					lastVotedAt: Date.now() - getCooldownMsForEntry(voteEntry),
					voteUrlId: voteEntry.id
				};
				const record = addSubscription(subscriptions, { userId: interaction.user.id, ...fields });
				saveSubscriptions(subscriptions);
				scheduleSubscription(record);
				log('info', 'Utilisateur inscrit aux rappels', {
					subscriptionId: record.id,
					userId: interaction.user.id,
					mode: fields.mode,
					channelId: fields.channelId || null,
					guildId: fields.guildId || null,
					window: fields.window || null,
					voteUrlId: fields.voteUrlId
				});
			subscribeSessions.delete(interaction.user.id);
				await interaction.update({
					content: [
						tr('Abonnement créé.', 'Subscription created.'),
						tr('Serveur : {label} ({id})', 'Server: {label} ({id})', { label: voteEntry.label, id: voteEntry.id }),
						tr('Plage : {start}-{end}', 'Window: {start}-{end}', { start: fields.window.start, end: fields.window.end }),
						fields.mode === 'channel' && fields.channelId
							? tr('Mode : Ping <#{channel}>', 'Mode: Ping <#{channel}>', { channel: fields.channelId })
							: tr('Mode : MP', 'Mode: DM')
					].join('\n'),
					components: []
				});
				return;
			}
			if (interaction.customId === 'subscribe-cancel') {
				subscribeSessions.delete(interaction.user.id);
				await interaction.update({ content: tr('Formulaire annulé.', 'Form cancelled.'), components: [] });
				return;
			}
			if (interaction.customId === 'listvote-edit') {
				const session = listVoteSessions.get(interaction.user.id);
				if (!session?.selectedId) {
					await interaction.update({ content: tr('Sélectionnez une entrée avant de modifier.', 'Select an entry before editing.'), components: [] });
					return;
			}
				const entry = getVoteUrlEntries().find(e => e.id === session.selectedId);
				if (!entry) {
					await interaction.update({ content: tr('Entrée introuvable. Relancez /listvote.', 'Entry not found. Run /listvote again.'), components: [] });
					return;
				}
			const modal = new ModalBuilder()
				.setCustomId('listvote-edit-modal')
				.setTitle(tr('Modifier une URL de vote', 'Edit a vote URL'))
				.addComponents(
					new ActionRowBuilder().addComponents(
						new TextInputBuilder()
							.setCustomId('edit_display_name')
							.setLabel(tr('Nom', 'Name'))
							.setStyle(TextInputStyle.Short)
							.setRequired(true)
							.setValue(entry.label)
					),
					new ActionRowBuilder().addComponents(
							new TextInputBuilder()
								.setCustomId('edit_vote_url')
								.setLabel('URL')
								.setStyle(TextInputStyle.Short)
								.setRequired(true)
								.setValue(entry.url)
						),
						new ActionRowBuilder().addComponents(
							new TextInputBuilder()
								.setCustomId('edit_cooldown')
								.setLabel(tr('Délai (minutes)', 'Cooldown (minutes)'))
								.setStyle(TextInputStyle.Short)
								.setRequired(true)
								.setValue(String(entry.cooldownMinutes))
						),
					new ActionRowBuilder().addComponents(
						new TextInputBuilder()
							.setCustomId('edit_channel_id')
							.setLabel(tr('ID du salon (optionnel)', 'Channel ID (optional)'))
							.setStyle(TextInputStyle.Short)
							.setRequired(false)
							.setValue(entry.channelId || '')
					)
				);
				await interaction.showModal(modal);
				return;
			}
		if (interaction.customId === 'listvote-delete') {
			const session = listVoteSessions.get(interaction.user.id);
			if (!session?.selectedId) {
				await interaction.update({ content: tr('Sélectionnez une entrée avant de supprimer.', 'Select an entry before deleting.'), components: [] });
				return;
				}
				const entries = getVoteUrlEntries();
				const entry = entries.find(e => e.id === session.selectedId);
				if (!entry) {
					await interaction.update({ content: tr('Entrée introuvable. Relancez /listvote.', 'Entry not found. Run /listvote again.'), components: [] });
					return;
				}
				const remaining = entries.filter(e => e.id !== entry.id);
				config.voteUrls = remaining;
				if (!remaining.find(e => e.id === config.defaultVoteUrlId)) {
					config.defaultVoteUrlId = remaining[0]?.id || null;
				}
				syncLegacyVoteBaseUrl();
				saveConfig(config);
				let updated = 0;
				const fallbackEntry = config.defaultVoteUrlId ? remaining.find(e => e.id === config.defaultVoteUrlId) : remaining[0] || null;
				for (let i = subscriptions.length - 1; i >= 0; i -= 1) {
					const sub = subscriptions[i];
					if (sub.voteUrlId === entry.id) {
						if (fallbackEntry) {
							sub.voteUrlId = fallbackEntry.id;
							if (sub.mode === 'channel') {
								sub.channelId = fallbackEntry.channelId || null;
							}
							scheduleSubscription(sub);
						} else {
							stopSubscriptionTask(sub.id);
							subscriptions.splice(i, 1);
						}
						updated += 1;
					}
				}
				if (updated > 0) {
					saveSubscriptions(subscriptions);
				}
				scheduleAll();
			listVoteSessions.delete(interaction.user.id);
		await interaction.update({
			content: tr('Entrée {label} supprimée.{extra}', 'Entry {label} deleted.{extra}', {
				label: entry.label,
				extra: updated > 0 ? tr(' {count} abonnés mis à jour.', ' {count} subscribers updated.', { count: updated }) : ''
			}),
			components: []
		});
		return;
	}
		if (interaction.customId === 'unsubscribe-confirm') {
			const mapping = statusSessions.get(interaction.user.id) || {};
			const choice = mapping.unsubscribeChoice || 'all';
			let removed = 0;
			if (choice === 'all') {
				const userSubs = subscriptions.filter(sub => sub.userId === interaction.user.id);
				for (const sub of userSubs) {
					stopSubscriptionTask(sub.id);
				}
				removed = removeAllSubscriptionsForUser(subscriptions, interaction.user.id);
			} else {
				const target = subscriptions.find(sub => sub.id === choice && sub.userId === interaction.user.id);
				if (!target) {
					await interaction.update({ content: tr('Abonnement introuvable.', 'Subscription not found.'), components: [] });
					return;
				}
				stopSubscriptionTask(target.id);
				if (removeSubscription(subscriptions, target.id)) {
					removed = 1;
				}
			}
			if (removed > 0) {
				saveSubscriptions(subscriptions);
				scheduleAll();
			}
			statusSessions.delete(interaction.user.id);
			log('info', 'Utilisateur desinscrit', { userId: interaction.user.id, removed, scope: choice });
			await interaction.update({
				content: removed > 0
					? tr('Abonnement{plural} supprimé{plural}.', 'Subscription{plural} deleted.', { plural: removed > 1 ? 's' : '' })
					: tr('Aucun abonnement supprimé.', 'No subscription deleted.'),
				components: []
			});
			return;
		}
		if (interaction.customId === 'unsubscribe-cancel') {
			statusSessions.delete(interaction.user.id);
			await interaction.update({ content: tr('Opération annulée.', 'Operation cancelled.'), components: [] });
			return;
		}
		if (interaction.customId === 'status-edit') {
			const subs = subscriptions.filter(sub => sub.userId === interaction.user.id);
			if (subs.length === 0) {
				await interaction.update({ content: tr('Aucun abonnement actif.', 'No active subscriptions.'), components: [] });
				return;
			}
			const mapping = statusSessions.get(interaction.user.id) || {};
			if (!mapping.selectedId || !subscriptions.find(sub => sub.id === mapping.selectedId && sub.userId === interaction.user.id)) {
				mapping.selectedId = subs[0].id;
			}
			statusSessions.set(interaction.user.id, mapping);
			const sub = subscriptions.find(s => s.id === mapping.selectedId && s.userId === interaction.user.id);
			if (!sub) {
				await interaction.update({ content: tr('Abonnement introuvable.', 'Subscription not found.'), components: [] });
				return;
			}
			const defaultStart = sub.window?.start || '08:00';
			const defaultEnd = sub.window?.end || '20:00';
			const editSession = {
				subscriptionId: sub.id,
				startTime: defaultStart,
				endTime: defaultEnd,
				startPage: getTimePage(defaultStart),
				endPage: getTimePage(defaultEnd),
				mode: sub.mode === 'channel' ? 'channel' : 'dm'
			};
			syncSubscribeSessionWindow(editSession);
			mapping.editSession = editSession;
			statusSessions.set(interaction.user.id, mapping);
			await interaction.update({
				content: renderStatusEditSummary(sub, editSession),
				components: buildStatusEditComponents(editSession)
			});
			return;
		}
		if (interaction.customId === 'status-edit-confirm') {
			const mapping = statusSessions.get(interaction.user.id) || {};
			const editSession = mapping.editSession;
			if (!editSession) {
				await interaction.update({ content: tr('Session de modification expirée. Relancez /status.', 'Edit session expired. Run /status again.'), components: [] });
				return;
			}
			const sub = subscriptions.find(s => s.id === editSession.subscriptionId && s.userId === interaction.user.id);
			if (!sub) {
				delete mapping.editSession;
				statusSessions.set(interaction.user.id, mapping);
				await interaction.update({ content: tr('Abonnement introuvable. Relancez /status.', 'Subscription not found. Run /status again.'), components: [] });
				return;
			}
			if (!editSession.windowStart || !editSession.windowEnd) {
				await interaction.reply({ content: tr('Merci de sélectionner une plage horaire.', 'Please select a reminder window.'), ephemeral: true });
				return;
			}
			if (!isHalfHour(editSession.windowStart) || !isHalfHour(editSession.windowEnd)) {
				await interaction.reply({ content: tr('Les horaires doivent être au format HH:MM et multiples de 30 minutes.', 'Times must be HH:MM and in 30-minute increments.'), ephemeral: true });
				return;
			}
			const voteEntry = getVoteUrlEntryById(sub.voteUrlId);
			let channelId = undefined;
			if (editSession.mode === 'channel') {
				if (!voteEntry?.channelId) {
					await interaction.reply({ content: tr('Aucun salon configuré pour ce serveur. Choisissez MP ou configurez un salon.', 'No channel configured for this server. Pick DM or configure a channel.'), ephemeral: true });
					return;
				}
				channelId = voteEntry.channelId;
			}
			sub.window = { start: editSession.windowStart, end: editSession.windowEnd };
			sub.mode = editSession.mode;
			sub.channelId = editSession.mode === 'channel' ? channelId : undefined;
			saveSubscriptions(subscriptions);
			scheduleSubscription(sub);
			log('info', 'Abonnement modifie via status', {
				userId: interaction.user.id,
				subscriptionId: sub.id,
				mode: sub.mode,
				channelId: sub.channelId || null,
				window: sub.window
			});
			delete mapping.editSession;
			mapping.selectedId = sub.id;
			statusSessions.set(interaction.user.id, mapping);
			const content = `${tr('Modifications enregistrées.', 'Changes saved.')}\n\n${formatStatusMessage(interaction.user.id)}`;
			await interaction.update({
				content,
				components: buildStatusComponents(interaction.user.id, sub.id)
			});
			return;
		}
		if (interaction.customId === 'status-edit-cancel') {
			const mapping = statusSessions.get(interaction.user.id) || {};
			delete mapping.editSession;
			statusSessions.set(interaction.user.id, mapping);
			const userSubs = subscriptions.filter(sub => sub.userId === interaction.user.id);
			if (userSubs.length === 0) {
				await interaction.update({ content: tr('Aucun abonnement actif.', 'No active subscriptions.'), components: [] });
				return;
			}
			const selectedId = mapping.selectedId && userSubs.some(sub => sub.id === mapping.selectedId)
				? mapping.selectedId
				: userSubs[0].id;
			mapping.selectedId = selectedId;
			statusSessions.set(interaction.user.id, mapping);
			await interaction.update({
				content: formatStatusMessage(interaction.user.id),
				components: buildStatusComponents(interaction.user.id, selectedId)
			});
			return;
		}
		if (interaction.customId === 'status-delete') {
			const subs = subscriptions.filter(sub => sub.userId === interaction.user.id);
			if (subs.length === 0) {
				await interaction.update({ content: tr('Aucun abonnement actif.', 'No active subscriptions.'), components: [] });
				return;
			}
			const mapping = statusSessions.get(interaction.user.id) || {};
			let selectedId = mapping.selectedId;
			if (!selectedId || !subs.find(sub => sub.id === selectedId)) {
				selectedId = subs[0].id;
			}
			const target = subscriptions.find(sub => sub.id === selectedId && sub.userId === interaction.user.id);
			if (!target) {
				await interaction.update({ content: tr('Abonnement introuvable.', 'Subscription not found.'), components: [] });
				return;
			}
			stopSubscriptionTask(target.id);
			removeSubscription(subscriptions, target.id);
			saveSubscriptions(subscriptions);
			scheduleAll();
			log('info', 'Abonnement supprime via status', { userId: interaction.user.id, subscriptionId: target.id });
			const remaining = subscriptions.filter(sub => sub.userId === interaction.user.id);
			if (remaining.length === 0) {
				statusSessions.delete(interaction.user.id);
				await interaction.update({ content: tr('Tous vos abonnements ont été supprimés.', 'All of your subscriptions have been removed.'), components: [] });
				return;
			}
			const newSelected = remaining[0].id;
			const mappingAfterDelete = statusSessions.get(interaction.user.id) || {};
			mappingAfterDelete.selectedId = newSelected;
			statusSessions.set(interaction.user.id, mappingAfterDelete);
			await interaction.update({
				content: formatStatusMessage(interaction.user.id),
				components: buildStatusComponents(interaction.user.id, newSelected)
			});
			return;
		}
		} catch (err) {
			log('error', 'Button handler error', { error: serializeError(err) });
			if (!interaction.replied && !interaction.deferred) {
				try {
					await interaction.reply({ content: tr('Erreur interne. Merci de réessayer.', 'Internal error. Please try again.'), ephemeral: true });
				} catch {
					// ignore
				}
			}
		}
		return;
	}

	if (!interaction.isChatInputCommand()) return;

	const { commandName } = interaction;

	if (commandName === 'addvote') {
		const modal = new ModalBuilder()
			.setCustomId('addvote-modal')
			.setTitle(tr('Nouvelle URL de vote', 'New vote URL'));
		const nameInput = new TextInputBuilder()
			.setCustomId('display_name')
			.setLabel(tr('Nom', 'Name'))
			.setStyle(TextInputStyle.Short)
			.setRequired(true);
		const urlInput = new TextInputBuilder()
			.setCustomId('vote_url')
			.setLabel(tr('URL de vote', 'Vote URL'))
			.setStyle(TextInputStyle.Short)
			.setRequired(true);
		const cooldownInput = new TextInputBuilder()
			.setCustomId('cooldown')
			.setLabel(tr('Délai (minutes)', 'Cooldown (minutes)'))
			.setStyle(TextInputStyle.Short)
			.setRequired(true)
			.setPlaceholder(tr('60, 120, 180, 240, 720, 1440', '60, 120, 180, 240, 720, 1440'));
		const channelInput = new TextInputBuilder()
			.setCustomId('channel_id')
			.setLabel(tr('ID du salon (optionnel)', 'Channel ID (optional)'))
			.setStyle(TextInputStyle.Short)
			.setRequired(false)
			.setPlaceholder(tr('ex : 123456789012345678', 'e.g. 123456789012345678'));
		modal.addComponents(
			new ActionRowBuilder().addComponents(nameInput),
			new ActionRowBuilder().addComponents(urlInput),
			new ActionRowBuilder().addComponents(cooldownInput),
			new ActionRowBuilder().addComponents(channelInput)
		);
		await interaction.showModal(modal);
		return;
	}

	if (commandName === 'listvote') {
		const entries = getVoteUrlEntries();
		if (entries.length === 0) {
			await interaction.reply({ content: tr('Aucune URL enregistrée.', 'No vote URL stored.'), ephemeral: true });
			return;
		}
		listVoteSessions.set(interaction.user.id, { selectedId: null });
		await interaction.reply({
			content: tr('Sélectionnez une entrée pour la modifier ou la supprimer.', 'Select an entry to edit or delete it.'),
			components: buildListVoteComponents(entries, null),
			ephemeral: true
		});
		return;
	}

	if (commandName === 'subscribe') {
		const entries = getVoteUrlEntries();
		if (entries.length === 0) {
			await interaction.reply({ content: tr('Aucune URL de vote n’est configurée. Demandez à un administrateur.', 'No vote URL is configured. Please ask an administrator.'), ephemeral: true });
			return;
		}
		const defaultVote = config.defaultVoteUrlId && entries.find(e => e.id === config.defaultVoteUrlId)
			? config.defaultVoteUrlId
			: entries[0].id;
		const defaultStart = '08:00';
		const defaultEnd = '20:00';
	const session = {
		userId: interaction.user.id,
		guildId: interaction.guildId || undefined,
		voteUrlId: defaultVote,
		startTime: defaultStart,
		endTime: defaultEnd,
		startPage: getTimePage(defaultStart),
		endPage: getTimePage(defaultEnd),
		mode: 'dm'
	};
		syncSubscribeSessionWindow(session);
		subscribeSessions.set(interaction.user.id, session);
		await interaction.reply({
			content: renderSubscribeSummary(session, entries),
			components: buildSubscribeComponents(entries, session),
			ephemeral: true
		});
		return;
	}

	if (commandName === 'unsubscribe') {
		const mySubs = subscriptions.filter(sub => sub.userId === interaction.user.id);
		if (mySubs.length === 0) {
			await interaction.reply({ content: tr('Aucun abonnement actif.', 'No active subscriptions.'), ephemeral: true });
			return;
		}
		const defaultChoice = mySubs[0]?.id || 'all';
		statusSessions.set(interaction.user.id, { unsubscribeChoice: defaultChoice });
		await interaction.reply({
			content: tr('Choisissez l’abonnement à supprimer (ou Tous).', 'Choose which subscription to delete (or All).'),
			components: buildUnsubscribeComponents(interaction.user.id, defaultChoice),
			ephemeral: true
		});
		return;
	}

	if (commandName === 'status') {
		const mySubs = subscriptions.filter(sub => sub.userId === interaction.user.id);
		if (mySubs.length === 0) {
			await interaction.reply({ content: tr('Aucun abonnement actif.', 'No active subscriptions.'), ephemeral: true });
			return;
		}
		const selectedId = mySubs[0]?.id || null;
		statusSessions.set(interaction.user.id, { selectedId });
		await interaction.reply({
			content: formatStatusMessage(interaction.user.id),
			components: buildStatusComponents(interaction.user.id, selectedId),
			ephemeral: true
		});
		return;
	}
});

// Minimal web server for vote redirect
const app = express();
app.get('/', (_req, res) => res.status(200).send('OK'));
app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
app.get('/v', async (req, res) => {
	try {
		const t = req.query.t;
		if (!t) return res.status(400).send('Missing token');
		const payload = verifyToken(String(t));
		if (!payload?.uid) return res.status(400).send('Invalid token');
		const sub = subscriptions.find(s => s.userId === payload.uid);
		if (!sub) return res.status(404).send('Not subscribed');
		// Update last voted time
		sub.lastVotedAt = Date.now();
		saveSubscriptions(subscriptions);
		// Build redirect URL with current display name
		const user = await client.users.fetch(sub.userId);
		const displayName = await getDisplayNameForUser(sub.guildId, sub.userId, user.username);
		const target = buildVoteUrlForUser(displayName, sub.voteUrlId);
		if (!target) {
			return res.status(503).send('Vote URL not configured');
		}
		log('info', 'Redirection de vote', { userId: sub.userId, guildId: sub.guildId || null });
		res.redirect(target);
	} catch (e) {
		log('error', 'Erreur lors de la redirection de vote', { error: serializeError(e) });
		res.status(500).send('Server error (redirect)');
	}
});

client.login(token);

// Start HTTP server
app.listen(PORT, () => {
	log('info', 'HTTP redirect server listening', { port: PORT });
});




