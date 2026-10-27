import './env.js';
import { Client, GatewayIntentBits, Partials, ButtonBuilder, ButtonStyle, ActionRowBuilder, Events, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, EmbedBuilder, MessageFlags, time, TimestampStyles } from 'discord.js';
import cron from 'node-cron';
import express from 'express';
import crypto from 'crypto';
import { loadSubscriptions, saveSubscriptions, addSubscription, removeSubscription, removeAllSubscriptionsForUser } from './storage.js';
import { loadConfig, saveConfig } from './config.js';
import { isReminderDue, computeNextReminderAt, parseTimeInput, isValidTimezone } from './schedule.js';

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
const DEFAULT_COOLDOWN_MINUTES = 120;
const SNOOZE_MINUTES = 30;
// After this many consecutive failed deliveries (DMs closed, channel deleted...), the subscription is paused.
const MAX_FAILED_DELIVERIES = 3;
const COLOR_REMINDER = 0x5865F2;
const COLOR_SUCCESS = 0x57F287;
const COLOR_WARNING = 0xFEE75C;
const COOLDOWN_CHOICES = [
	{ minutes: 60, fr: '1 heure', en: '1 hour' },
	{ minutes: 120, fr: '2 heures', en: '2 hours' },
	{ minutes: 180, fr: '3 heures', en: '3 hours' },
	{ minutes: 240, fr: '4 heures', en: '4 hours' },
	{ minutes: 720, fr: '12 heures', en: '12 hours' },
	{ minutes: 1440, fr: '24 heures', en: '24 hours' }
];
const WINDOW_PRESETS = [
	{ id: 'allday', window: null, fr: 'Toute la journée', en: 'All day' },
	{ id: 'day', window: { start: '08:00', end: '20:00' }, fr: 'Journée', en: 'Daytime' },
	{ id: 'morning', window: { start: '07:00', end: '12:00' }, fr: 'Matin', en: 'Morning' },
	{ id: 'afternoon', window: { start: '12:00', end: '18:00' }, fr: 'Après-midi', en: 'Afternoon' },
	{ id: 'evening', window: { start: '18:00', end: '23:30' }, fr: 'Soirée', en: 'Evening' }
];
const TIMEZONE_CHOICES = [
	{ tz: 'Europe/Paris', fr: 'France, Belgique, Suisse', en: 'Central Europe (Paris, Berlin)' },
	{ tz: 'Europe/London', fr: 'Royaume-Uni, Irlande, Portugal', en: 'UK, Ireland, Portugal' },
	{ tz: 'Europe/Athens', fr: 'Europe de l’Est (Athènes, Bucarest)', en: 'Eastern Europe (Athens, Bucharest)' },
	{ tz: 'Europe/Moscow', fr: 'Moscou, Istanbul', en: 'Moscow, Istanbul' },
	{ tz: 'Africa/Casablanca', fr: 'Maroc', en: 'Morocco' },
	{ tz: 'Africa/Algiers', fr: 'Algérie, Tunisie', en: 'Algeria, Tunisia' },
	{ tz: 'Africa/Abidjan', fr: 'Afrique de l’Ouest (Dakar, Abidjan)', en: 'West Africa (Dakar, Abidjan)' },
	{ tz: 'Africa/Lagos', fr: 'Afrique centrale (Douala, Kinshasa)', en: 'Central Africa (Lagos, Kinshasa)' },
	{ tz: 'Indian/Reunion', fr: 'La Réunion, Maurice', en: 'Réunion, Mauritius' },
	{ tz: 'America/Martinique', fr: 'Antilles (Martinique, Guadeloupe)', en: 'French West Indies' },
	{ tz: 'America/Cayenne', fr: 'Guyane', en: 'French Guiana' },
	{ tz: 'America/Toronto', fr: 'Québec, Est canadien', en: 'Quebec, Eastern Canada' },
	{ tz: 'America/New_York', fr: 'USA Est (New York)', en: 'US Eastern (New York)' },
	{ tz: 'America/Chicago', fr: 'USA Centre (Chicago)', en: 'US Central (Chicago)' },
	{ tz: 'America/Los_Angeles', fr: 'USA Pacifique (Los Angeles)', en: 'US Pacific (Los Angeles)' },
	{ tz: 'America/Sao_Paulo', fr: 'Brésil (São Paulo)', en: 'Brazil (São Paulo)' },
	{ tz: 'Pacific/Noumea', fr: 'Nouvelle-Calédonie', en: 'New Caledonia' },
	{ tz: 'Pacific/Tahiti', fr: 'Polynésie française', en: 'French Polynesia' },
	{ tz: 'Asia/Tokyo', fr: 'Japon, Corée', en: 'Japan, Korea' },
	{ tz: 'Australia/Sydney', fr: 'Australie Est (Sydney)', en: 'Eastern Australia (Sydney)' },
	{ tz: 'UTC', fr: 'UTC', en: 'UTC' }
];
const subscribeSessions = new Map(); // userId -> subscribe form state
const listVoteSessions = new Map(); // userId -> { selectedId?: string }
const statusSessions = new Map(); // userId -> { selectedId?, editSession?, unsubscribeChoice? }

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

function getSubscriptionTimezone(sub) {
	return sub?.timezone || config.timezone || 'Europe/Paris';
}

function getNextReminderAt(sub, now = Date.now()) {
	return computeNextReminderAt(sub, getCooldownMsForSubscriber(sub), now, getSubscriptionTimezone(sub));
}

// ---------- Formatting helpers ----------

function cooldownLabel(minutes) {
	const choice = COOLDOWN_CHOICES.find(c => c.minutes === minutes);
	if (choice) return tr(choice.fr, choice.en);
	if (minutes % 60 === 0) return tr('{h} heures', '{h} hours', { h: minutes / 60 });
	return `${minutes} min`;
}

function windowLabel(windowObj) {
	if (!windowObj) return tr('Toute la journée', 'All day');
	return `${windowObj.start} – ${windowObj.end}`;
}

function sameWindow(a, b) {
	if (!a || !b) return !a && !b;
	return a.start === b.start && a.end === b.end;
}

function getUtcOffsetLabel(timezone) {
	try {
		const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' }).formatToParts(new Date());
		const offset = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
		return offset.replace('GMT', 'UTC');
	} catch {
		return '';
	}
}

function getLocalTimeLabel(timezone) {
	try {
		return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date());
	} catch {
		return '';
	}
}

function timezoneLabel(timezone) {
	const choice = TIMEZONE_CHOICES.find(c => c.tz === timezone);
	const name = choice ? tr(choice.fr, choice.en) : timezone;
	const offset = getUtcOffsetLabel(timezone);
	return offset && offset !== name ? `${name} (${offset})` : name;
}

function getChannelName(channelId) {
	const channel = channelId ? client.channels.cache.get(channelId) : null;
	return channel?.name ? `#${channel.name}` : tr('salon configuré', 'configured channel');
}

// For embeds: channel mentions are rendered by Discord.
function modeLabel(mode, channelId) {
	if (mode === 'channel') {
		return tr('📢 Ping dans {channel}', '📢 Ping in {channel}', { channel: channelId ? `<#${channelId}>` : tr('(salon non configuré)', '(channel not set)') });
	}
	return tr('📨 Message privé', '📨 Direct message');
}

function formatDurationShort(ms) {
	const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
	const days = Math.floor(totalMinutes / 1440);
	const hours = Math.floor((totalMinutes % 1440) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) {
		return hours > 0 ? tr('{d}j {h}h', '{d}d {h}h', { d: days, h: hours }) : tr('{d}j', '{d}d', { d: days });
	}
	if (hours > 0) {
		return minutes > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : `${hours}h`;
	}
	return `${minutes} min`;
}

function relativeTs(ms) {
	return time(Math.floor(ms / 1000), TimestampStyles.RelativeTime);
}

function shortTimeTs(ms) {
	return time(Math.floor(ms / 1000), TimestampStyles.ShortTime);
}

// For embeds: Discord renders the timestamp in the reader's timezone and language.
function nextReminderText(sub, now = Date.now()) {
	if (sub.paused) {
		return tr('⏸️ En pause', '⏸️ Paused');
	}
	const next = getNextReminderAt(sub, now);
	if (next === null) return '-';
	if (next - now <= 60 * 1000) return tr('imminent', 'any moment now');
	return `${shortTimeTs(next)} (${relativeTs(next)})`;
}

// For select menu descriptions, which do not render Discord timestamps.
function nextReminderPlain(sub, now = Date.now()) {
	if (sub.paused) return tr('en pause', 'paused');
	const next = getNextReminderAt(sub, now);
	if (next === null) return '-';
	if (next - now <= 60 * 1000) return tr('rappel imminent', 'reminder any moment now');
	return tr('prochain rappel dans {d}', 'next reminder in {d}', { d: formatDurationShort(next - now) });
}

function asUpdate(payload) {
	return {
		content: payload.content || '',
		embeds: payload.embeds || [],
		components: payload.components || []
	};
}

function asReply(payload) {
	return { ...payload, flags: MessageFlags.Ephemeral };
}

// ---------- Shared form components (subscribe + status edit) ----------

function buildWindowSelect(customId, windowObj) {
	const select = new StringSelectMenuBuilder()
		.setCustomId(customId)
		.setPlaceholder(tr('Plage horaire des rappels', 'Reminder time window'))
		.setMinValues(1)
		.setMaxValues(1);
	const matchingPreset = WINDOW_PRESETS.find(p => sameWindow(p.window, windowObj));
	for (const preset of WINDOW_PRESETS) {
		select.addOptions({
			label: preset.window ? `${tr(preset.fr, preset.en)} (${windowLabel(preset.window)})` : tr(preset.fr, preset.en),
			value: `preset:${preset.id}`,
			emoji: preset.window ? '🕗' : '🌐',
			default: preset === matchingPreset
		});
	}
	if (!matchingPreset && windowObj) {
		select.addOptions({
			label: tr('Actuelle : {window}', 'Current: {window}', { window: windowLabel(windowObj) }),
			value: 'current',
			emoji: '🕗',
			default: true
		});
	}
	select.addOptions({
		label: tr('Personnalisée…', 'Custom…'),
		value: 'custom',
		emoji: '✏️',
		description: tr('Saisir une heure de début et de fin', 'Type a start and end time')
	});
	return select;
}

function buildModeSelect(customId, mode, entry) {
	const select = new StringSelectMenuBuilder()
		.setCustomId(customId)
		.setPlaceholder(tr('Mode de rappel', 'Reminder mode'))
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions({
			label: tr('Message privé', 'Direct message'),
			value: 'dm',
			emoji: '📨',
			description: tr('Recevoir le rappel en MP', 'Receive the reminder by DM'),
			default: mode !== 'channel'
		});
	if (entry?.channelId) {
		select.addOptions({
			label: tr('Ping dans {channel}', 'Ping in {channel}', { channel: getChannelName(entry.channelId) }).slice(0, 100),
			value: 'channel',
			emoji: '📢',
			description: tr('Être mentionné dans le salon du serveur', 'Get mentioned in the server channel'),
			default: mode === 'channel'
		});
	}
	return select;
}

function buildTimezoneSelect(customId, timezone) {
	const select = new StringSelectMenuBuilder()
		.setCustomId(customId)
		.setPlaceholder(tr('Fuseau horaire', 'Timezone'))
		.setMinValues(1)
		.setMaxValues(1);
	const zones = TIMEZONE_CHOICES.map(c => c.tz);
	if (timezone && !zones.includes(timezone)) zones.unshift(timezone);
	for (const tz of zones.slice(0, 25)) {
		select.addOptions({
			label: timezoneLabel(tz).slice(0, 100),
			value: tz,
			description: tr('{tz} · il est {time}', '{tz} · it is {time}', { tz, time: getLocalTimeLabel(tz) }).slice(0, 100),
			default: tz === timezone
		});
	}
	return select;
}

function buildWindowModal(target, windowObj) {
	return new ModalBuilder()
		.setCustomId(`window-modal|${target}`)
		.setTitle(tr('Plage horaire personnalisée', 'Custom time window'))
		.addComponents(
			new ActionRowBuilder().addComponents(
				new TextInputBuilder()
					.setCustomId('window_start')
					.setLabel(tr('Début (HH:MM)', 'Start (HH:MM)'))
					.setStyle(TextInputStyle.Short)
					.setRequired(true)
					.setMaxLength(5)
					.setPlaceholder('08:00')
					.setValue(windowObj?.start || '08:00')
			),
			new ActionRowBuilder().addComponents(
				new TextInputBuilder()
					.setCustomId('window_end')
					.setLabel(tr('Fin (HH:MM)', 'End (HH:MM)'))
					.setStyle(TextInputStyle.Short)
					.setRequired(true)
					.setMaxLength(5)
					.setPlaceholder('22:00')
					.setValue(windowObj?.end || '20:00')
			)
		);
}

// Applies a value picked in the window select. Returns 'custom' when the modal must be shown.
function applyWindowSelection(form, value) {
	if (value === 'custom') return 'custom';
	if (value.startsWith('preset:')) {
		const preset = WINDOW_PRESETS.find(p => `preset:${p.id}` === value);
		if (preset) form.window = preset.window ? { ...preset.window } : null;
	}
	return 'updated';
}

function applyFormSelect(form, field, value) {
	if (field === 'mode') {
		form.mode = value === 'channel' ? 'channel' : 'dm';
	} else if (field === 'timezone') {
		if (isValidTimezone(value)) form.timezone = value;
	}
}

// ---------- /subscribe ----------

function getUserSubscriptions(userId) {
	return subscriptions.filter(sub => sub.userId === userId);
}

function isAlreadySubscribed(userId, voteUrlId, exceptId = null) {
	return subscriptions.some(sub => sub.userId === userId && sub.voteUrlId === voteUrlId && sub.id !== exceptId);
}

function renderSubscribeForm(session) {
	const entries = getVoteUrlEntries();
	const entry = session.voteUrlId ? entries.find(e => e.id === session.voteUrlId) : null;
	if (session.mode === 'channel' && !entry?.channelId) session.mode = 'dm';
	const duplicate = entry ? isAlreadySubscribed(session.userId, entry.id) : false;
	const warnings = [];
	if (duplicate) {
		warnings.push(tr('⚠️ Vous êtes déjà abonné à **{label}**. Utilisez `/status` pour modifier cet abonnement.', '⚠️ You are already subscribed to **{label}**. Use `/status` to edit that subscription.', { label: entry.label }));
	}
	const preview = { window: session.window, lastVotedAt: null, lastReminderAt: null, voteUrlId: session.voteUrlId, timezone: session.timezone };
	const embed = new EmbedBuilder()
		.setColor(duplicate ? COLOR_WARNING : COLOR_REMINDER)
		.setTitle(tr('🔔 Nouvel abonnement aux rappels', '🔔 New reminder subscription'))
		.setDescription([
			tr('Choisissez vos options avec les menus ci-dessous, puis cliquez sur **Valider**.', 'Pick your options with the menus below, then click **Confirm**.'),
			...warnings
		].join('\n\n'))
		.addFields(
			{ name: tr('Serveur', 'Server'), value: entry ? entry.label : tr('(aucun)', '(none)'), inline: true },
			{ name: tr('Rappel toutes les', 'Remind every'), value: entry ? cooldownLabel(entry.cooldownMinutes) : '-', inline: true },
			{ name: tr('Mode', 'Mode'), value: modeLabel(session.mode, entry?.channelId), inline: true },
			{ name: tr('Plage horaire', 'Time window'), value: windowLabel(session.window), inline: true },
			{ name: tr('Fuseau horaire', 'Timezone'), value: timezoneLabel(session.timezone), inline: true },
			{ name: tr('Premier rappel', 'First reminder'), value: entry ? nextReminderText(preview) : '-', inline: true }
		);
	const voteOptions = [];
	if (entry) voteOptions.push(entry);
	for (const e of entries) {
		if (voteOptions.length >= 25) break;
		if (!voteOptions.includes(e)) voteOptions.push(e);
	}
	const voteMenu = new StringSelectMenuBuilder()
		.setCustomId('subscribe-select-vote')
		.setPlaceholder(tr('Choisissez un serveur', 'Choose a server'))
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(voteOptions.map(e => ({
			label: e.label.slice(0, 100),
			value: e.id,
			description: isAlreadySubscribed(session.userId, e.id)
				? tr('✅ Déjà abonné', '✅ Already subscribed')
				: tr('Rappel toutes les {cooldown}', 'Reminder every {cooldown}', { cooldown: cooldownLabel(e.cooldownMinutes) }),
			default: e.id === session.voteUrlId
		})));
	const confirmButton = new ButtonBuilder()
		.setCustomId('subscribe-confirm')
		.setLabel(tr('Valider', 'Confirm'))
		.setStyle(ButtonStyle.Success)
		.setDisabled(!entry || duplicate);
	const cancelButton = new ButtonBuilder()
		.setCustomId('subscribe-cancel')
		.setLabel(tr('Annuler', 'Cancel'))
		.setStyle(ButtonStyle.Secondary);
	return {
		embeds: [embed],
		components: [
			new ActionRowBuilder().addComponents(voteMenu),
			new ActionRowBuilder().addComponents(buildWindowSelect('subscribe-select-window', session.window)),
			new ActionRowBuilder().addComponents(buildModeSelect('subscribe-select-mode', session.mode, entry)),
			new ActionRowBuilder().addComponents(buildTimezoneSelect('subscribe-select-timezone', session.timezone)),
			new ActionRowBuilder().addComponents(confirmButton, cancelButton)
		]
	};
}

// ---------- /status ----------

function buildSubscriptionField(sub, index, selectedId) {
	const entry = getVoteUrlEntryById(sub.voteUrlId);
	const label = entry ? entry.label : tr('Serveur inconnu', 'Unknown server');
	const lines = [
		`🕗 ${windowLabel(sub.window)} · ${timezoneLabel(getSubscriptionTimezone(sub))}`,
		modeLabel(sub.mode, sub.channelId),
		tr('⏱️ Rappel toutes les {cooldown} tant que vous n’avez pas voté', '⏱️ Reminder every {cooldown} until you vote', {
			cooldown: entry ? cooldownLabel(entry.cooldownMinutes) : tr('?', '?')
		}),
		sub.lastVotedAt
			? tr('🗳️ Dernier vote : {when}', '🗳️ Last vote: {when}', { when: relativeTs(sub.lastVotedAt) })
			: tr('🗳️ Dernier vote : jamais enregistré', '🗳️ Last vote: never recorded'),
		sub.paused
			? tr('⚠️ **En pause** : les derniers rappels n’ont pas pu être délivrés (MP fermés ?). Vérifiez vos paramètres de confidentialité puis cliquez sur **Réactiver**.', '⚠️ **Paused**: the last reminders could not be delivered (DMs closed?). Check your privacy settings then click **Resume**.')
			: tr('🔔 Prochain rappel : {next}', '🔔 Next reminder: {next}', { next: nextReminderText(sub) })
	];
	return {
		name: `${sub.id === selectedId ? '👉 ' : ''}${index + 1}. ${label}${sub.paused ? ' ⏸️' : ''}`.slice(0, 256),
		value: lines.join('\n').slice(0, 1024)
	};
}

function renderStatus(userId, selectedId, notice = null) {
	const subs = getUserSubscriptions(userId);
	if (subs.length === 0) {
		return { content: notice ? `${notice}\n${tr('Aucun abonnement actif.', 'No active subscriptions.')}` : tr('Aucun abonnement actif. Utilisez `/subscribe` pour en créer un.', 'No active subscriptions. Use `/subscribe` to create one.') };
	}
	if (!selectedId || !subs.some(sub => sub.id === selectedId)) selectedId = subs[0].id;
	const shown = subs.slice(0, 25);
	const description = [
		notice,
		tr('Sélectionnez un abonnement dans le menu pour le modifier ou le supprimer.', 'Select a subscription in the menu to edit or delete it.')
	].filter(Boolean);
	if (subs.length > 25) {
		description.push(tr('Seuls les 25 premiers abonnements sont affichés.', 'Only the first 25 subscriptions are shown.'));
	}
	const embed = new EmbedBuilder()
		.setColor(subs.some(sub => sub.paused) ? COLOR_WARNING : COLOR_REMINDER)
		.setTitle(tr('📋 Vos abonnements ({count})', '📋 Your subscriptions ({count})', { count: subs.length }))
		.setDescription(description.join('\n\n'))
		.addFields(shown.map((sub, idx) => buildSubscriptionField(sub, idx, selectedId)));
	const select = new StringSelectMenuBuilder()
		.setCustomId('status-select-subscription')
		.setPlaceholder(tr('Choisissez un abonnement à gérer', 'Choose a subscription to manage'))
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(shown.map((sub, idx) => subscriptionOption(sub, idx, sub.id === selectedId)));
	const selected = subs.find(sub => sub.id === selectedId);
	const buttons = [
		new ButtonBuilder().setCustomId('status-edit').setLabel(tr('Modifier', 'Edit')).setEmoji('✏️').setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId('status-delete').setLabel(tr('Supprimer', 'Delete')).setEmoji('🗑️').setStyle(ButtonStyle.Danger)
	];
	if (selected?.paused) {
		buttons.unshift(new ButtonBuilder().setCustomId('status-resume').setLabel(tr('Réactiver', 'Resume')).setEmoji('▶️').setStyle(ButtonStyle.Success));
	}
	return {
		embeds: [embed],
		components: [
			new ActionRowBuilder().addComponents(select),
			new ActionRowBuilder().addComponents(...buttons)
		]
	};
}

function subscriptionOption(sub, index, isDefault) {
	const entry = getVoteUrlEntryById(sub.voteUrlId);
	const label = entry ? entry.label : tr('Serveur inconnu', 'Unknown server');
	return {
		label: `${index + 1}. ${label}`.slice(0, 100),
		value: sub.id,
		emoji: sub.paused ? '⏸️' : (sub.mode === 'channel' ? '📢' : '📨'),
		description: `${windowLabel(sub.window)} · ${nextReminderPlain(sub)}`.slice(0, 100),
		default: isDefault
	};
}

function renderStatusEdit(sub, editSession) {
	const entry = getVoteUrlEntryById(sub.voteUrlId);
	if (editSession.mode === 'channel' && !entry?.channelId) editSession.mode = 'dm';
	const label = entry ? entry.label : tr('Serveur inconnu', 'Unknown server');
	const embed = new EmbedBuilder()
		.setColor(COLOR_REMINDER)
		.setTitle(tr('✏️ Modifier l’abonnement : {label}', '✏️ Edit subscription: {label}', { label }).slice(0, 256))
		.setDescription(tr('Utilisez les menus puis cliquez sur **Valider** ou **Annuler**.', 'Use the menus then press **Confirm** or **Cancel**.'))
		.addFields(
			{ name: tr('Plage horaire', 'Time window'), value: windowLabel(editSession.window), inline: true },
			{ name: tr('Fuseau horaire', 'Timezone'), value: timezoneLabel(editSession.timezone), inline: true },
			{ name: tr('Mode', 'Mode'), value: modeLabel(editSession.mode, entry?.channelId), inline: true }
		);
	return {
		embeds: [embed],
		components: [
			new ActionRowBuilder().addComponents(buildWindowSelect('status-edit-window', editSession.window)),
			new ActionRowBuilder().addComponents(buildModeSelect('status-edit-mode', editSession.mode, entry)),
			new ActionRowBuilder().addComponents(buildTimezoneSelect('status-edit-timezone', editSession.timezone)),
			new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId('status-edit-confirm').setLabel(tr('Valider', 'Confirm')).setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId('status-edit-cancel').setLabel(tr('Annuler', 'Cancel')).setStyle(ButtonStyle.Secondary)
			)
		]
	};
}

// ---------- /unsubscribe ----------

function renderUnsubscribe(userId, choice) {
	const subs = getUserSubscriptions(userId);
	if (subs.length === 0) return { content: tr('Aucun abonnement actif.', 'No active subscriptions.') };
	const sanitizedChoice = subs.some(sub => sub.id === choice) ? choice : 'all';
	const limited = subs.slice(0, 24); // keep room for "all"
	const select = new StringSelectMenuBuilder()
		.setCustomId('unsubscribe-select')
		.setPlaceholder(tr('Choisissez un abonnement à supprimer', 'Choose a subscription to delete'))
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(limited.map((sub, idx) => subscriptionOption(sub, idx, sub.id === sanitizedChoice)))
		.addOptions({
			label: tr('Tous mes abonnements', 'All my subscriptions'),
			value: 'all',
			emoji: '🗑️',
			default: sanitizedChoice === 'all'
		});
	const selectedSub = subs.find(sub => sub.id === sanitizedChoice);
	const selectedEntry = selectedSub ? getVoteUrlEntryById(selectedSub.voteUrlId) : null;
	const selectionText = sanitizedChoice === 'all'
		? tr('tous vos abonnements ({count})', 'all your subscriptions ({count})', { count: subs.length })
		: `**${selectedEntry ? selectedEntry.label : tr('Serveur inconnu', 'Unknown server')}** (${windowLabel(selectedSub.window)})`;
	return {
		content: tr('Choisissez l’abonnement à supprimer (ou Tous).\nSélection : {selection}', 'Choose which subscription to delete (or All).\nSelection: {selection}', { selection: selectionText }),
		components: [
			new ActionRowBuilder().addComponents(select),
			new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId('unsubscribe-confirm').setLabel(tr('Confirmer', 'Confirm')).setStyle(ButtonStyle.Danger),
				new ButtonBuilder().setCustomId('unsubscribe-cancel').setLabel(tr('Annuler', 'Cancel')).setStyle(ButtonStyle.Secondary)
			)
		]
	};
}

// ---------- /listvote ----------

function renderListVote(selectedId, notice = null) {
	const entries = getVoteUrlEntries();
	if (entries.length === 0) {
		return { content: [notice, tr('Aucune URL enregistrée.', 'No vote URL stored.')].filter(Boolean).join('\n') };
	}
	const entry = selectedId ? entries.find(e => e.id === selectedId) : null;
	const lines = [notice];
	if (!entry) {
		lines.push(tr('Sélectionnez une entrée pour la modifier ou la supprimer.', 'Select an entry to edit or delete it.'));
	} else {
		const subscriberCount = subscriptions.filter(sub => sub.voteUrlId === entry.id).length;
		lines.push(
			tr('**{label}** (`{id}`)', '**{label}** (`{id}`)', { label: entry.label, id: entry.id }),
			`URL : ${entry.url}`,
			tr('Délai : {cooldown}', 'Cooldown: {cooldown}', { cooldown: cooldownLabel(entry.cooldownMinutes) }),
			entry.channelId
				? tr('Salon pour le mode ping : <#{channel}>', 'Channel for ping mode: <#{channel}>', { channel: entry.channelId })
				: tr('Salon pour le mode ping : aucun (MP uniquement)', 'Channel for ping mode: none (DM only)'),
			tr('Abonnés : {count}', 'Subscribers: {count}', { count: subscriberCount }),
			'',
			tr('Le délai et le salon se modifient directement avec les menus ci-dessous.', 'Cooldown and channel can be changed directly with the menus below.')
		);
	}
	const rows = [
		new ActionRowBuilder().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId('listvote-select-entry')
				.setPlaceholder(tr('Choisissez une entrée à gérer', 'Choose an entry to manage'))
				.setMinValues(1)
				.setMaxValues(1)
				.addOptions(entries.slice(0, 25).map(e => ({
					label: e.label.slice(0, 100),
					value: e.id,
					description: e.url.slice(0, 100),
					default: e.id === selectedId
				})))
		)
	];
	if (entry) {
		rows.push(
			new ActionRowBuilder().addComponents(buildCooldownSelect('listvote-cooldown', entry.cooldownMinutes)),
			new ActionRowBuilder().addComponents(buildChannelSelect('listvote-channel', entry.channelId)),
			new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId('listvote-edit').setLabel(tr('Modifier nom / URL', 'Edit name / URL')).setEmoji('✏️').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId('listvote-delete').setLabel(tr('Supprimer', 'Delete')).setEmoji('🗑️').setStyle(ButtonStyle.Danger)
			)
		);
	}
	return { content: lines.filter(line => line !== null).join('\n'), components: rows };
}

function buildCooldownSelect(customId, minutes) {
	const select = new StringSelectMenuBuilder()
		.setCustomId(customId)
		.setPlaceholder(tr('Délai entre deux votes', 'Cooldown between votes'))
		.setMinValues(1)
		.setMaxValues(1);
	const choices = COOLDOWN_CHOICES.map(c => c.minutes);
	if (!choices.includes(minutes)) choices.push(minutes);
	for (const value of choices) {
		select.addOptions({
			label: tr('Délai : {cooldown}', 'Cooldown: {cooldown}', { cooldown: cooldownLabel(value) }),
			value: String(value),
			emoji: '⏱️',
			default: value === minutes
		});
	}
	return select;
}

function buildChannelSelect(customId, channelId) {
	const select = new ChannelSelectMenuBuilder()
		.setCustomId(customId)
		.setPlaceholder(tr('Salon pour le mode ping (vide = MP uniquement)', 'Channel for ping mode (empty = DM only)'))
		.setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
		.setMinValues(0)
		.setMaxValues(1);
	if (channelId) select.setDefaultChannels(channelId);
	return select;
}

function isValidVoteUrl(urlStr) {
	try {
		const url = new URL(urlStr.split('{pseudo}').join('pseudo'));
		return url.protocol === 'https:' || url.protocol === 'http:';
	} catch {
		return false;
	}
}

function updateVoteEntry(entryId, fields) {
	const entries = getVoteUrlEntries();
	const idx = entries.findIndex(entry => entry.id === entryId);
	if (idx === -1) return null;
	const updatedEntry = { ...entries[idx], ...fields };
	const newEntries = [...entries];
	newEntries[idx] = updatedEntry;
	config.voteUrls = newEntries;
	syncLegacyVoteBaseUrl();
	saveConfig(config);
	if ('channelId' in fields) {
		let updatedSubs = 0;
		for (const sub of subscriptions) {
			if (sub.voteUrlId === entryId && sub.mode === 'channel') {
				sub.channelId = updatedEntry.channelId || null;
				updatedSubs += 1;
			}
		}
		if (updatedSubs > 0) saveSubscriptions(subscriptions);
	}
	return updatedEntry;
}

// ---------- Logging ----------

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

// ---------- Vote URLs and tokens ----------

function buildVoteUrlForUser(username, voteUrlId) {
	const entry = getVoteUrlEntryById(voteUrlId);
	const baseUrl = entry?.url || config.voteBaseUrl;
	if (!baseUrl) return null;
	// "{pseudo}" placeholder anywhere in the URL (path or query); otherwise append ?pseudo=.
	if (baseUrl.includes('{pseudo}')) {
		return baseUrl.split('{pseudo}').join(encodeURIComponent(username));
	}
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

function buildVoteLinkUrl(sub, directVoteUrl) {
	if (!PUBLIC_BASE_URL) return directVoteUrl;
	// The subscription id is needed so the vote is recorded on the right subscription.
	const token = signToken({ sid: sub.id, uid: sub.userId, iat: Date.now() });
	return `${PUBLIC_BASE_URL.replace(/\/+$/, '')}/v?t=${encodeURIComponent(token)}`;
}

// ---------- Reminder messages ----------

function reminderTitle(entry) {
	return tr('🗳️ Rappel de vote : {label}', '🗳️ Vote reminder: {label}', { label: entry ? entry.label : '?' }).slice(0, 256);
}

function buildReminderButtons(sub, voteLinkUrl) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setLabel(tr('Voter maintenant', 'Vote now'))
			.setStyle(ButtonStyle.Link)
			.setURL(voteLinkUrl),
		new ButtonBuilder()
			.setCustomId(`reminder-voted|${sub.id}`)
			.setLabel(tr('J’ai voté', 'I voted'))
			.setEmoji('✅')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId(`reminder-snooze|${sub.id}`)
			.setLabel(tr('Dans {minutes} min', 'In {minutes} min', { minutes: SNOOZE_MINUTES }))
			.setEmoji('⏰')
			.setStyle(ButtonStyle.Secondary)
	);
}

function buildReminderEmbed(sub, entry, now) {
	const nextIfIgnored = getNextReminderAt({ ...sub, lastReminderAt: now, snoozeUntil: null }, now);
	const lines = [
		tr('C’est l’heure de voter pour **{label}** !', 'Time to vote for **{label}**!', { label: entry ? entry.label : '?' }),
		PUBLIC_BASE_URL
			? tr('Le bouton **Voter maintenant** enregistre votre vote automatiquement.', 'The **Vote now** button records your vote automatically.')
			: tr('Après avoir voté, cliquez sur **J’ai voté** pour relancer le délai.', 'Once you have voted, click **I voted** to restart the timer.')
	];
	if (nextIfIgnored) {
		lines.push(tr('Sans vote, prochain rappel {when}.', 'Without a vote, next reminder {when}.', { when: relativeTs(nextIfIgnored) }));
	}
	return new EmbedBuilder()
		.setColor(COLOR_REMINDER)
		.setTitle(reminderTitle(entry))
		.setDescription(lines.join('\n'));
}

function buildReminderVotedPayload(sub) {
	const entry = getVoteUrlEntryById(sub.voteUrlId);
	const next = getNextReminderAt(sub);
	const embed = new EmbedBuilder()
		.setColor(COLOR_SUCCESS)
		.setTitle(reminderTitle(entry))
		.setDescription([
			tr('✅ Vote enregistré {when}. Merci !', '✅ Vote recorded {when}. Thanks!', { when: relativeTs(sub.lastVotedAt || Date.now()) }),
			next ? tr('Prochain rappel {when}.', 'Next reminder {when}.', { when: relativeTs(next) }) : null
		].filter(Boolean).join('\n'));
	return { embeds: [embed], components: [] };
}

function buildReminderSnoozedPayload(sub, voteLinkUrl) {
	const entry = getVoteUrlEntryById(sub.voteUrlId);
	const next = getNextReminderAt(sub);
	const embed = new EmbedBuilder()
		.setColor(COLOR_REMINDER)
		.setTitle(reminderTitle(entry))
		.setDescription(tr('⏰ Rappel reporté : nouveau rappel {when}.', '⏰ Reminder snoozed: next reminder {when}.', { when: next ? relativeTs(next) : '-' }));
	return { embeds: [embed], components: voteLinkUrl ? [buildReminderButtons(sub, voteLinkUrl)] : [] };
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

async function buildVoteLinkForSub(sub) {
	const user = await client.users.fetch(sub.userId);
	const displayName = await getDisplayNameForUser(sub.guildId, sub.userId, user.username);
	const voteTarget = buildVoteUrlForUser(displayName, sub.voteUrlId);
	return { user, displayName, voteLinkUrl: voteTarget ? buildVoteLinkUrl(sub, voteTarget) : null };
}

async function deliverReminderViaChannel(sub, payload, context) {
	try {
		const channel = await client.channels.fetch(sub.channelId);
		if (!channel) {
			log('warn', 'Channel introuvable pour le rappel', context);
			return null;
		}
		if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
			log('warn', 'Type de channel incompatible pour rappel', { ...context, channelType: channel.type });
			return null;
		}
		const message = await channel.send({
			content: `<@${sub.userId}>`,
			allowedMentions: { users: [sub.userId] },
			...payload
		});
		log('info', 'Rappel envoye sur le channel', context);
		return message;
	} catch (err) {
		log('error', 'Echec de lenvoi du rappel sur le channel', { ...context, error: serializeError(err) });
		return null;
	}
}

async function deliverReminderViaDm(user, payload, context, isFallback) {
	try {
		const message = await user.send(payload);
		log('info', isFallback ? 'Rappel envoye en MP (fallback)' : 'Rappel envoye en MP', context);
		return message;
	} catch (err) {
		log('error', 'Echec de lenvoi du rappel en MP', { ...context, error: serializeError(err) });
		return null;
	}
}

async function sendVoteReminder(sub) {
	const now = Date.now();
	const entry = getVoteUrlEntryById(sub.voteUrlId);
	const context = {
		subscriptionId: sub.id,
		userId: sub.userId,
		guildId: sub.guildId || null,
		mode: sub.mode || 'dm',
		channelId: sub.channelId || null,
		voteUrlId: sub.voteUrlId || null
	};
	let message = null;
	try {
		const { user, displayName, voteLinkUrl } = await buildVoteLinkForSub(sub);
		context.displayName = displayName;
		if (!voteLinkUrl) {
			log('warn', 'Aucune URL de vote disponible pour le rappel', context);
			return;
		}
		const payload = {
			embeds: [buildReminderEmbed(sub, entry, now)],
			components: [buildReminderButtons(sub, voteLinkUrl)]
		};
		if (sub.mode === 'channel' && sub.channelId) {
			message = await deliverReminderViaChannel(sub, payload, context);
			if (!message) {
				log('warn', 'Echec du rappel via channel, tentative en MP', context);
			}
		} else if (sub.mode === 'channel') {
			log('warn', 'Mode channel demande mais aucun channelId stocke', context);
		}
		if (!message) {
			message = await deliverReminderViaDm(user, payload, context, sub.mode === 'channel');
		}
	} catch (err) {
		log('error', 'Erreur lors de la preparation du rappel', { ...context, error: serializeError(err) });
	}
	// Counted as an attempt even on failure, so a failing route is retried after the cooldown, not every minute.
	sub.lastReminderAt = now;
	sub.snoozeUntil = null;
	if (message) {
		sub.failedDeliveries = 0;
		sub.lastReminderMessage = { channelId: message.channelId, messageId: message.id };
	} else {
		sub.failedDeliveries = (sub.failedDeliveries || 0) + 1;
		log('warn', 'Rappel non envoye: aucune route disponible', { ...context, failedDeliveries: sub.failedDeliveries });
		if (sub.failedDeliveries >= MAX_FAILED_DELIVERIES) {
			sub.paused = true;
			log('warn', 'Abonnement mis en pause apres plusieurs echecs', context);
		}
	}
	saveSubscriptions(subscriptions);
}

function markVoted(sub) {
	sub.lastVotedAt = Date.now();
	sub.snoozeUntil = null;
	sub.paused = false;
	sub.failedDeliveries = 0;
	saveSubscriptions(subscriptions);
}

// Best effort: show the vote as recorded on the last reminder message (used by the web redirect).
async function refreshLastReminderMessage(sub) {
	const ref = sub.lastReminderMessage;
	if (!ref) return;
	try {
		const channel = await client.channels.fetch(ref.channelId);
		await channel?.messages?.edit(ref.messageId, buildReminderVotedPayload(sub));
	} catch (err) {
		log('warn', 'Impossible de mettre a jour le dernier rappel', { subscriptionId: sub.id, error: serializeError(err) });
	}
}

// ---------- Scheduling ----------

let reminderTickRunning = false;

// A single loop checks every subscription each minute: a reminder is due when the
// cooldown since the last reminder/vote has elapsed and the user is inside their window.
async function runReminderTick() {
	if (reminderTickRunning) return;
	reminderTickRunning = true;
	try {
		const now = Date.now();
		for (const sub of [...subscriptions]) {
			if (!sub.userId || !sub.voteUrlId) continue;
			if (!subscriptions.includes(sub)) continue;
			try {
				if (!isReminderDue(sub, getCooldownMsForSubscriber(sub), now, getSubscriptionTimezone(sub))) continue;
				await sendVoteReminder(sub);
			} catch (err) {
				log('error', 'Erreur lors de lexecution de la tache de rappel', { subscriptionId: sub.id, userId: sub.userId, error: serializeError(err) });
			}
		}
	} finally {
		reminderTickRunning = false;
	}
}

client.once(Events.ClientReady, () => {
	log('info', 'Client pret', { tag: client.user.tag, subscriptions: subscriptions.length });
	cron.schedule('* * * * *', runReminderTick);
	runReminderTick();
});

// ---------- Interaction handlers ----------

async function handleModalSubmit(interaction) {
	if (interaction.customId.startsWith('addvote-modal|')) {
		const [, cooldownRaw, channelRaw] = interaction.customId.split('|');
		const minutes = parseInt(cooldownRaw, 10) || DEFAULT_COOLDOWN_MINUTES;
		const channelId = channelRaw || null;
		const labelRaw = interaction.fields.getTextInputValue('display_name')?.trim();
		const urlRaw = interaction.fields.getTextInputValue('vote_url')?.trim();
		if (!labelRaw) {
			await interaction.reply(asReply({ content: tr('Le nom ne peut pas être vide.', 'Name cannot be empty.') }));
			return;
		}
		if (!urlRaw || !isValidVoteUrl(urlRaw)) {
			await interaction.reply(asReply({ content: tr('URL invalide. Elle doit commencer par https:// (le paramètre `{pseudo}` est autorisé).', 'Invalid URL. It must start with https:// (the `{pseudo}` placeholder is allowed).') }));
			return;
		}
		const allEntries = getVoteUrlEntries();
		const id = generateVoteUrlId(labelRaw);
		const entry = { id, label: labelRaw, url: urlRaw, cooldownMinutes: minutes, channelId };
		config.voteUrls = [...allEntries, entry];
		if (!config.defaultVoteUrlId) {
			config.defaultVoteUrlId = id;
			let updatedSubscriptions = 0;
			for (const sub of subscriptions) {
				if (!sub.voteUrlId) {
					sub.voteUrlId = id;
					if (sub.mode === 'channel') {
						sub.channelId = channelId || null;
					}
					updatedSubscriptions += 1;
				}
			}
			if (updatedSubscriptions > 0) {
				saveSubscriptions(subscriptions);
			}
		}
		syncLegacyVoteBaseUrl();
		saveConfig(config);
		log('info', 'URL ajoutee via /addvote', {
			userId: interaction.user.id,
			label: entry.label,
			url: entry.url,
			cooldownMinutes: entry.cooldownMinutes,
			channelId: entry.channelId || null
		});
		await interaction.reply(asReply({
			content: [
				tr('✅ URL ajoutée : **{label}** (`{id}`)', '✅ Vote URL added: **{label}** (`{id}`)', { label: entry.label, id: entry.id }),
				tr('Délai : {cooldown}', 'Cooldown: {cooldown}', { cooldown: cooldownLabel(entry.cooldownMinutes) }),
				entry.channelId
					? tr('Salon pour le mode ping : <#{channel}>', 'Channel for ping mode: <#{channel}>', { channel: entry.channelId })
					: tr('Salon pour le mode ping : aucun (MP uniquement)', 'Channel for ping mode: none (DM only)'),
				entry.url.includes('{pseudo}')
					? null
					: tr('Le pseudo sera ajouté à l’URL avec `?pseudo=…`. Utilisez `{pseudo}` dans l’URL pour le placer ailleurs.', 'The username will be appended as `?pseudo=…`. Use `{pseudo}` in the URL to place it elsewhere.')
			].filter(Boolean).join('\n')
		}));
		return;
	}
	if (interaction.customId === 'listvote-edit-modal') {
		const session = listVoteSessions.get(interaction.user.id);
		const current = session?.selectedId ? getVoteUrlEntries().find(entry => entry.id === session.selectedId) : null;
		if (!current) {
			await interaction.reply(asReply({ content: tr('Entrée introuvable. Relancez /listvote.', 'Entry not found. Run /listvote again.') }));
			return;
		}
		const label = interaction.fields.getTextInputValue('edit_display_name')?.trim();
		const urlStr = interaction.fields.getTextInputValue('edit_vote_url')?.trim();
		if (!label) {
			await interaction.reply(asReply({ content: tr('Le nom ne peut pas être vide.', 'Name cannot be empty.') }));
			return;
		}
		if (!urlStr || !isValidVoteUrl(urlStr)) {
			await interaction.reply(asReply({ content: tr('URL invalide. Elle doit commencer par https:// (le paramètre `{pseudo}` est autorisé).', 'Invalid URL. It must start with https:// (the `{pseudo}` placeholder is allowed).') }));
			return;
		}
		updateVoteEntry(current.id, { label, url: urlStr });
		log('info', 'URL modifiee via /listvote', { userId: interaction.user.id, id: current.id, label, url: urlStr });
		const payload = renderListVote(current.id, tr('✅ Entrée mise à jour.', '✅ Entry updated.'));
		if (interaction.isFromMessage()) {
			await interaction.update(asUpdate(payload));
		} else {
			await interaction.reply(asReply(payload));
		}
		return;
	}
	if (interaction.customId.startsWith('window-modal|')) {
		const target = interaction.customId.split('|')[1];
		const start = parseTimeInput(interaction.fields.getTextInputValue('window_start'));
		const end = parseTimeInput(interaction.fields.getTextInputValue('window_end'));
		if (!start || !end) {
			await interaction.reply(asReply({ content: tr('Heure invalide. Utilisez le format HH:MM, par exemple 08:00 ou 21:30.', 'Invalid time. Use the HH:MM format, e.g. 08:00 or 21:30.') }));
			return;
		}
		if (start === end) {
			await interaction.reply(asReply({ content: tr('Le début et la fin doivent être différents. Pour toute la journée, choisissez « Toute la journée ».', 'Start and end must differ. For the whole day, pick “All day”.') }));
			return;
		}
		let payload;
		if (target === 'subscribe') {
			const session = subscribeSessions.get(interaction.user.id);
			if (!session) {
				await interaction.reply(asReply({ content: tr('Session expirée. Relancez /subscribe.', 'Session expired. Run /subscribe again.') }));
				return;
			}
			session.window = { start, end };
			payload = renderSubscribeForm(session);
		} else {
			const mapping = statusSessions.get(interaction.user.id) || {};
			const editSession = mapping.editSession;
			const sub = editSession ? subscriptions.find(s => s.id === editSession.subscriptionId && s.userId === interaction.user.id) : null;
			if (!sub) {
				await interaction.reply(asReply({ content: tr('Session de modification expirée. Relancez /status.', 'Edit session expired. Run /status again.') }));
				return;
			}
			editSession.window = { start, end };
			payload = renderStatusEdit(sub, editSession);
		}
		if (interaction.isFromMessage()) {
			await interaction.update(asUpdate(payload));
		} else {
			await interaction.reply(asReply(payload));
		}
	}
}

async function handleSelectMenu(interaction) {
	const value = interaction.values?.[0];
	const { customId } = interaction;
	if (customId.startsWith('subscribe-select-')) {
		const session = subscribeSessions.get(interaction.user.id);
		if (!session) {
			await interaction.update(asUpdate({ content: tr('Session expirée. Relancez /subscribe.', 'Session expired. Run /subscribe again.') }));
			return;
		}
		if (getVoteUrlEntries().length === 0) {
			subscribeSessions.delete(interaction.user.id);
			await interaction.update(asUpdate({ content: tr('Aucune URL disponible.', 'No vote URL available.') }));
			return;
		}
		if (customId === 'subscribe-select-vote') {
			session.voteUrlId = value;
		} else if (customId === 'subscribe-select-window') {
			if (applyWindowSelection(session, value) === 'custom') {
				await interaction.showModal(buildWindowModal('subscribe', session.window));
				return;
			}
		} else if (customId === 'subscribe-select-mode') {
			applyFormSelect(session, 'mode', value);
		} else if (customId === 'subscribe-select-timezone') {
			applyFormSelect(session, 'timezone', value);
		}
		await interaction.update(asUpdate(renderSubscribeForm(session)));
		return;
	}
	if (customId.startsWith('status-edit-')) {
		const mapping = statusSessions.get(interaction.user.id) || {};
		const editSession = mapping.editSession;
		const sub = editSession ? subscriptions.find(s => s.id === editSession.subscriptionId && s.userId === interaction.user.id) : null;
		if (!sub) {
			delete mapping.editSession;
			await interaction.update(asUpdate({ content: tr('Session de modification expirée. Relancez /status.', 'Edit session expired. Run /status again.') }));
			return;
		}
		if (customId === 'status-edit-window') {
			if (applyWindowSelection(editSession, value) === 'custom') {
				await interaction.showModal(buildWindowModal('status', editSession.window));
				return;
			}
		} else if (customId === 'status-edit-mode') {
			applyFormSelect(editSession, 'mode', value);
		} else if (customId === 'status-edit-timezone') {
			applyFormSelect(editSession, 'timezone', value);
		}
		await interaction.update(asUpdate(renderStatusEdit(sub, editSession)));
		return;
	}
	if (customId === 'status-select-subscription') {
		const mapping = statusSessions.get(interaction.user.id) || {};
		mapping.selectedId = value;
		statusSessions.set(interaction.user.id, mapping);
		await interaction.update(asUpdate(renderStatus(interaction.user.id, value)));
		return;
	}
	if (customId === 'unsubscribe-select') {
		const mapping = statusSessions.get(interaction.user.id) || {};
		mapping.unsubscribeChoice = value;
		statusSessions.set(interaction.user.id, mapping);
		await interaction.update(asUpdate(renderUnsubscribe(interaction.user.id, value)));
		return;
	}
	if (customId === 'listvote-select-entry') {
		listVoteSessions.set(interaction.user.id, { selectedId: value });
		await interaction.update(asUpdate(renderListVote(value)));
		return;
	}
	if (customId === 'listvote-cooldown' || customId === 'listvote-channel') {
		const session = listVoteSessions.get(interaction.user.id);
		const entry = session?.selectedId ? getVoteUrlEntries().find(e => e.id === session.selectedId) : null;
		if (!entry) {
			await interaction.update(asUpdate({ content: tr('Entrée introuvable. Relancez /listvote.', 'Entry not found. Run /listvote again.') }));
			return;
		}
		let notice;
		if (customId === 'listvote-cooldown') {
			const minutes = parseInt(value, 10);
			if (!Number.isFinite(minutes) || minutes <= 0) return;
			updateVoteEntry(entry.id, { cooldownMinutes: minutes });
			notice = tr('✅ Délai mis à jour : {cooldown}.', '✅ Cooldown updated: {cooldown}.', { cooldown: cooldownLabel(minutes) });
		} else {
			const channelId = value || null;
			updateVoteEntry(entry.id, { channelId });
			notice = channelId
				? tr('✅ Salon mis à jour : <#{channel}>.', '✅ Channel updated: <#{channel}>.', { channel: channelId })
				: tr('✅ Salon retiré : rappels en MP uniquement.', '✅ Channel removed: DM reminders only.');
		}
		log('info', 'URL modifiee via /listvote', { userId: interaction.user.id, id: entry.id, field: customId });
		await interaction.update(asUpdate(renderListVote(entry.id, notice)));
	}
}

async function handleReminderButton(interaction) {
	const [action, subId] = interaction.customId.split('|');
	const sub = subscriptions.find(s => s.id === subId);
	if (!sub) {
		await interaction.reply(asReply({ content: tr('Abonnement introuvable ou supprimé.', 'Subscription not found or deleted.') }));
		return;
	}
	if (interaction.user.id !== sub.userId) {
		await interaction.reply(asReply({ content: tr('Ce bouton est réservé au destinataire du rappel.', 'This button is reserved for the reminder recipient.') }));
		return;
	}
	if (action === 'reminder-snooze') {
		sub.snoozeUntil = Date.now() + SNOOZE_MINUTES * 60 * 1000;
		saveSubscriptions(subscriptions);
		log('info', 'Rappel reporte', { userId: sub.userId, subscriptionId: sub.id });
		const { voteLinkUrl } = await buildVoteLinkForSub(sub);
		await interaction.update(buildReminderSnoozedPayload(sub, voteLinkUrl));
		return;
	}
	// 'reminder-voted', and 'reminder-reset' from reminders sent by older versions.
	markVoted(sub);
	if (sub.lastReminderMessage?.messageId !== interaction.message?.id) {
		refreshLastReminderMessage(sub);
	}
	log('info', 'Vote marque via bouton', { userId: sub.userId, subscriptionId: sub.id });
	await interaction.update(buildReminderVotedPayload(sub));
}

async function handleButton(interaction) {
	const { customId } = interaction;
	const userId = interaction.user.id;
	if (customId.startsWith('reminder-')) {
		await handleReminderButton(interaction);
		return;
	}
	if (customId === 'subscribe-confirm') {
		const session = subscribeSessions.get(userId);
		if (!session) {
			await interaction.update(asUpdate({ content: tr('Session expirée. Relancez /subscribe.', 'Session expired. Run /subscribe again.') }));
			return;
		}
		const voteEntry = session.voteUrlId ? getVoteUrlEntries().find(e => e.id === session.voteUrlId) : null;
		if (!voteEntry) {
			await interaction.reply(asReply({ content: tr('Merci de sélectionner un serveur.', 'Please select a server.') }));
			return;
		}
		if (isAlreadySubscribed(userId, voteEntry.id)) {
			await interaction.reply(asReply({ content: tr('Vous êtes déjà abonné à ce serveur. Utilisez /status pour le modifier.', 'You are already subscribed to this server. Use /status to edit it.') }));
			return;
		}
		if (session.mode === 'channel' && !voteEntry.channelId) {
			await interaction.reply(asReply({ content: tr('Aucun salon configuré pour ce serveur. Choisissez MP.', 'No channel configured for this server. Pick DM.') }));
			return;
		}
		const record = addSubscription(subscriptions, {
			userId,
			voteUrlId: voteEntry.id,
			window: session.window,
			mode: session.mode,
			channelId: session.mode === 'channel' ? voteEntry.channelId : null,
			timezone: session.timezone,
			guildId: session.guildId || interaction.guildId || null,
			lastKnownDisplayName: interaction.member?.displayName || interaction.user.username
		});
		saveSubscriptions(subscriptions);
		subscribeSessions.delete(userId);
		log('info', 'Utilisateur inscrit aux rappels', {
			subscriptionId: record.id,
			userId,
			mode: record.mode,
			channelId: record.channelId,
			guildId: record.guildId,
			window: record.window,
			timezone: record.timezone,
			voteUrlId: record.voteUrlId
		});
		const embed = new EmbedBuilder()
			.setColor(COLOR_SUCCESS)
			.setTitle(tr('✅ Abonnement créé : {label}', '✅ Subscription created: {label}', { label: voteEntry.label }).slice(0, 256))
			.setDescription(tr('Gérez vos abonnements à tout moment avec `/status`.', 'Manage your subscriptions anytime with `/status`.'))
			.addFields(buildSubscriptionField(record, 0, null));
		await interaction.update(asUpdate({ embeds: [embed] }));
		return;
	}
	if (customId === 'subscribe-cancel') {
		subscribeSessions.delete(userId);
		await interaction.update(asUpdate({ content: tr('Formulaire annulé.', 'Form cancelled.') }));
		return;
	}
	if (customId === 'listvote-edit') {
		const session = listVoteSessions.get(userId);
		const entry = session?.selectedId ? getVoteUrlEntries().find(e => e.id === session.selectedId) : null;
		if (!entry) {
			await interaction.update(asUpdate({ content: tr('Entrée introuvable. Relancez /listvote.', 'Entry not found. Run /listvote again.') }));
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
						.setMaxLength(100)
						.setValue(entry.label)
				),
				new ActionRowBuilder().addComponents(
					new TextInputBuilder()
						.setCustomId('edit_vote_url')
						.setLabel(tr('URL (peut contenir {pseudo})', 'URL (may contain {pseudo})'))
						.setStyle(TextInputStyle.Short)
						.setRequired(true)
						.setValue(entry.url)
				)
			);
		await interaction.showModal(modal);
		return;
	}
	if (customId === 'listvote-delete') {
		const session = listVoteSessions.get(userId);
		const entries = getVoteUrlEntries();
		const entry = session?.selectedId ? entries.find(e => e.id === session.selectedId) : null;
		if (!entry) {
			await interaction.update(asUpdate({ content: tr('Entrée introuvable. Relancez /listvote.', 'Entry not found. Run /listvote again.') }));
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
				} else {
					subscriptions.splice(i, 1);
				}
				updated += 1;
			}
		}
		if (updated > 0) {
			saveSubscriptions(subscriptions);
		}
		listVoteSessions.delete(userId);
		log('info', 'URL supprimee via /listvote', { userId, id: entry.id, subscriptionsUpdated: updated });
		await interaction.update(asUpdate({
			content: tr('Entrée {label} supprimée.{extra}', 'Entry {label} deleted.{extra}', {
				label: entry.label,
				extra: updated > 0 ? tr(' {count} abonnés mis à jour.', ' {count} subscribers updated.', { count: updated }) : ''
			})
		}));
		return;
	}
	if (customId === 'unsubscribe-confirm') {
		const mapping = statusSessions.get(userId) || {};
		const choice = mapping.unsubscribeChoice || 'all';
		let removed = 0;
		if (choice === 'all') {
			removed = removeAllSubscriptionsForUser(subscriptions, userId);
		} else {
			const target = subscriptions.find(sub => sub.id === choice && sub.userId === userId);
			if (!target) {
				await interaction.update(asUpdate({ content: tr('Abonnement introuvable.', 'Subscription not found.') }));
				return;
			}
			if (removeSubscription(subscriptions, target.id)) {
				removed = 1;
			}
		}
		if (removed > 0) {
			saveSubscriptions(subscriptions);
		}
		statusSessions.delete(userId);
		log('info', 'Utilisateur desinscrit', { userId, removed, scope: choice });
		await interaction.update(asUpdate({
			content: removed > 0
				? tr('Abonnement{plural} supprimé{plural}.', 'Subscription{plural} deleted.', { plural: removed > 1 ? 's' : '' })
				: tr('Aucun abonnement supprimé.', 'No subscription deleted.')
		}));
		return;
	}
	if (customId === 'unsubscribe-cancel') {
		statusSessions.delete(userId);
		await interaction.update(asUpdate({ content: tr('Opération annulée.', 'Operation cancelled.') }));
		return;
	}
	if (customId.startsWith('status-')) {
		const mapping = statusSessions.get(userId) || {};
		statusSessions.set(userId, mapping);
		const subs = getUserSubscriptions(userId);
		const selected = subs.find(sub => sub.id === mapping.selectedId) || subs[0];
		if (customId === 'status-edit-cancel') {
			delete mapping.editSession;
			await interaction.update(asUpdate(renderStatus(userId, mapping.selectedId)));
			return;
		}
		if (customId === 'status-edit-confirm') {
			const editSession = mapping.editSession;
			const sub = editSession ? subscriptions.find(s => s.id === editSession.subscriptionId && s.userId === userId) : null;
			if (!sub) {
				delete mapping.editSession;
				await interaction.update(asUpdate({ content: tr('Session de modification expirée. Relancez /status.', 'Edit session expired. Run /status again.') }));
				return;
			}
			const voteEntry = getVoteUrlEntryById(sub.voteUrlId);
			if (editSession.mode === 'channel' && !voteEntry?.channelId) {
				await interaction.reply(asReply({ content: tr('Aucun salon configuré pour ce serveur. Choisissez MP.', 'No channel configured for this server. Pick DM.') }));
				return;
			}
			sub.window = editSession.window;
			sub.timezone = editSession.timezone;
			sub.mode = editSession.mode;
			sub.channelId = editSession.mode === 'channel' ? voteEntry.channelId : null;
			// Changing the delivery settings is the way out of a paused subscription.
			sub.paused = false;
			sub.failedDeliveries = 0;
			saveSubscriptions(subscriptions);
			log('info', 'Abonnement modifie via status', {
				userId,
				subscriptionId: sub.id,
				mode: sub.mode,
				channelId: sub.channelId || null,
				window: sub.window,
				timezone: sub.timezone
			});
			delete mapping.editSession;
			mapping.selectedId = sub.id;
			await interaction.update(asUpdate(renderStatus(userId, sub.id, tr('✅ Modifications enregistrées.', '✅ Changes saved.'))));
			return;
		}
		if (!selected) {
			await interaction.update(asUpdate({ content: tr('Aucun abonnement actif.', 'No active subscriptions.') }));
			return;
		}
		if (customId === 'status-edit') {
			const entry = getVoteUrlEntryById(selected.voteUrlId);
			mapping.selectedId = selected.id;
			mapping.editSession = {
				subscriptionId: selected.id,
				window: selected.window ? { ...selected.window } : null,
				timezone: getSubscriptionTimezone(selected),
				mode: selected.mode === 'channel' && entry?.channelId ? 'channel' : 'dm'
			};
			await interaction.update(asUpdate(renderStatusEdit(selected, mapping.editSession)));
			return;
		}
		if (customId === 'status-resume') {
			selected.paused = false;
			selected.failedDeliveries = 0;
			saveSubscriptions(subscriptions);
			log('info', 'Abonnement reactive via status', { userId, subscriptionId: selected.id });
			await interaction.update(asUpdate(renderStatus(userId, selected.id, tr('▶️ Abonnement réactivé.', '▶️ Subscription resumed.'))));
			return;
		}
		if (customId === 'status-delete') {
			removeSubscription(subscriptions, selected.id);
			saveSubscriptions(subscriptions);
			log('info', 'Abonnement supprime via status', { userId, subscriptionId: selected.id });
			const entry = getVoteUrlEntryById(selected.voteUrlId);
			mapping.selectedId = null;
			await interaction.update(asUpdate(renderStatus(userId, null, tr('🗑️ Abonnement {label} supprimé.', '🗑️ Subscription {label} deleted.', { label: entry ? entry.label : '' }))));
		}
	}
}

async function handleCommand(interaction) {
	const { commandName } = interaction;
	const userId = interaction.user.id;

	if (commandName === 'addvote') {
		const cooldown = interaction.options.getInteger('cooldown') || DEFAULT_COOLDOWN_MINUTES;
		const channel = interaction.options.getChannel('channel');
		const modal = new ModalBuilder()
			.setCustomId(`addvote-modal|${cooldown}|${channel?.id || ''}`)
			.setTitle(tr('Nouvelle URL de vote', 'New vote URL'))
			.addComponents(
				new ActionRowBuilder().addComponents(
					new TextInputBuilder()
						.setCustomId('display_name')
						.setLabel(tr('Nom', 'Name'))
						.setStyle(TextInputStyle.Short)
						.setRequired(true)
						.setMaxLength(100)
				),
				new ActionRowBuilder().addComponents(
					new TextInputBuilder()
						.setCustomId('vote_url')
						.setLabel(tr('URL de vote (peut contenir {pseudo})', 'Vote URL (may contain {pseudo})'))
						.setStyle(TextInputStyle.Short)
						.setRequired(true)
						.setPlaceholder('https://example.com/vote?user={pseudo}')
				)
			);
		await interaction.showModal(modal);
		return;
	}

	if (commandName === 'listvote') {
		if (getVoteUrlEntries().length === 0) {
			await interaction.reply(asReply({ content: tr('Aucune URL enregistrée. Utilisez /addvote.', 'No vote URL stored. Use /addvote.') }));
			return;
		}
		listVoteSessions.set(userId, { selectedId: null });
		await interaction.reply(asReply(renderListVote(null)));
		return;
	}

	if (commandName === 'subscribe') {
		const entries = getVoteUrlEntries();
		if (entries.length === 0) {
			await interaction.reply(asReply({ content: tr('Aucune URL de vote n’est configurée. Demandez à un administrateur.', 'No vote URL is configured. Please ask an administrator.') }));
			return;
		}
		const available = entries.filter(e => !isAlreadySubscribed(userId, e.id));
		if (available.length === 0) {
			await interaction.reply(asReply({ content: tr('Vous êtes déjà abonné à tous les serveurs. Utilisez /status pour modifier vos abonnements.', 'You are already subscribed to every server. Use /status to edit your subscriptions.') }));
			return;
		}
		const defaultVote = available.find(e => e.id === config.defaultVoteUrlId) || available[0];
		const session = {
			userId,
			guildId: interaction.guildId || null,
			voteUrlId: defaultVote.id,
			window: { start: '08:00', end: '20:00' },
			timezone: isValidTimezone(config.timezone) ? config.timezone : 'Europe/Paris',
			mode: 'dm'
		};
		subscribeSessions.set(userId, session);
		await interaction.reply(asReply(renderSubscribeForm(session)));
		return;
	}

	if (commandName === 'unsubscribe') {
		const mySubs = getUserSubscriptions(userId);
		if (mySubs.length === 0) {
			await interaction.reply(asReply({ content: tr('Aucun abonnement actif.', 'No active subscriptions.') }));
			return;
		}
		const defaultChoice = mySubs[0].id;
		statusSessions.set(userId, { unsubscribeChoice: defaultChoice });
		await interaction.reply(asReply(renderUnsubscribe(userId, defaultChoice)));
		return;
	}

	if (commandName === 'status') {
		const mySubs = getUserSubscriptions(userId);
		const selectedId = mySubs[0]?.id || null;
		statusSessions.set(userId, { selectedId });
		await interaction.reply(asReply(renderStatus(userId, selectedId)));
	}
}

client.on(Events.InteractionCreate, async (interaction) => {
	if (interaction.isAutocomplete()) {
		try {
			await interaction.respond([]);
		} catch (err) {
			log('error', 'Autocomplete error', { error: serializeError(err) });
		}
		return;
	}
	try {
		if (interaction.isModalSubmit()) {
			await handleModalSubmit(interaction);
		} else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
			await handleSelectMenu(interaction);
		} else if (interaction.isButton()) {
			await handleButton(interaction);
		} else if (interaction.isChatInputCommand()) {
			await handleCommand(interaction);
		}
	} catch (err) {
		log('error', 'Interaction handler error', { customId: interaction.customId, command: interaction.commandName, error: serializeError(err) });
		const errorPayload = asReply({ content: tr('Erreur interne. Merci de réessayer.', 'Internal error. Please try again.') });
		try {
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp(errorPayload);
			} else {
				await interaction.reply(errorPayload);
			}
		} catch {
			// ignore
		}
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
		// Tokens issued before the subscription id was included only carry the user id.
		const sub = payload.sid
			? subscriptions.find(s => s.id === payload.sid && s.userId === payload.uid)
			: subscriptions.find(s => s.userId === payload.uid);
		if (!sub) return res.status(404).send('Not subscribed');
		markVoted(sub);
		refreshLastReminderMessage(sub);
		// Build redirect URL with current display name
		const user = await client.users.fetch(sub.userId);
		const displayName = await getDisplayNameForUser(sub.guildId, sub.userId, user.username);
		const target = buildVoteUrlForUser(displayName, sub.voteUrlId);
		if (!target) {
			return res.status(503).send('Vote URL not configured');
		}
		log('info', 'Redirection de vote', { userId: sub.userId, subscriptionId: sub.id, guildId: sub.guildId || null });
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
