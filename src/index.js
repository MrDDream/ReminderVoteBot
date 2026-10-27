import './env.js';
import { Client, GatewayIntentBits, Partials, ButtonBuilder, ButtonStyle, ActionRowBuilder, Events, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, time, TimestampStyles } from 'discord.js';
import cron from 'node-cron';
import express from 'express';
import { loadSubscriptions, saveSubscriptions, addSubscription, removeSubscription, removeAllSubscriptionsForUser } from './storage.js';
import { loadConfig, saveConfig } from './config.js';
import { isReminderDue, computeNextReminderAt, parseTimeInput, isValidTimezone } from './schedule.js';
import { signToken, verifyToken } from './token.js';
import { MAX_VOTE_URL_LENGTH, isValidVoteUrl, isValidPublicBaseUrl, generateVoteUrlId, buildVoteUrl } from './voteUrl.js';

function exitWithConfigError(message) {
	console.error(`[CONFIG] ${message}`);
	process.exit(1);
}

const token = process.env.DISCORD_TOKEN;
// The bot serves a single Discord server: admin commands only work there.
const GUILD_ID = process.env.GUILD_ID;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, '') : null;
const MARK_SECRET = process.env.MARK_SECRET;
if (!token) exitWithConfigError('DISCORD_TOKEN manquant dans .env');
if (!GUILD_ID) exitWithConfigError('GUILD_ID manquant : indiquez l’ID du serveur Discord du bot.');
if (PUBLIC_BASE_URL) {
	if (!isValidPublicBaseUrl(PUBLIC_BASE_URL)) {
		exitWithConfigError(`PUBLIC_BASE_URL invalide (${PUBLIC_BASE_URL}) : URL complète attendue, ex. https://vote.example.com`);
	}
	if (!MARK_SECRET || MARK_SECRET.length < 32) {
		exitWithConfigError('MARK_SECRET doit faire au moins 32 caractères quand PUBLIC_BASE_URL est défini (ex. : openssl rand -hex 32).');
	}
}
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

// Subscription changes are written at most once per second: a burst of reminders
// or clicks rewrites the file once instead of once per change.
const SAVE_DELAY_MS = 1000;
let saveTimer = null;

function persistSubscriptions() {
	if (!saveTimer) saveTimer = setTimeout(flushSubscriptions, SAVE_DELAY_MS);
}

function flushSubscriptions() {
	if (!saveTimer) return;
	clearTimeout(saveTimer);
	saveTimer = null;
	try {
		saveSubscriptions(subscriptions);
	} catch (err) {
		log('error', 'Echec de la sauvegarde des abonnements, nouvel essai', { error: serializeError(err) });
		persistSubscriptions();
	}
}
const DEFAULT_COOLDOWN_MINUTES = 120;
const MAX_VOTE_ENTRIES = 25; // Discord select menus show at most 25 options
// Repeated hits of the same /v link within this delay do not record the vote again.
const VOTE_DEDUP_MS = 60 * 1000;
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

function tr(frText, enText, params = {}) {
	const template = BOT_LANG === 'en' ? enText : frText;
	return template.replace(/\{(\w+)\}/g, (_, key) => (params[key] ?? `{${key}}`));
}

function getVoteUrlEntryById(id) {
	return getVoteUrlEntries().find(entry => entry.id === id) || null;
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

function getCooldownMsForEntry(entry) {
	const minutes = typeof entry?.cooldownMinutes === 'number' && entry.cooldownMinutes > 0 ? entry.cooldownMinutes : DEFAULT_COOLDOWN_MINUTES;
	return minutes * 60 * 1000;
}

function getCooldownMsForSubscriber(sub) {
	const entry = getVoteUrlEntryById(sub?.voteUrlId);
	return getCooldownMsForEntry(entry);
}

function getSubscriptionTimezone(sub) {
	return sub?.timezone && isValidTimezone(sub.timezone) ? sub.timezone : config.timezone;
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

function buildWindowModal(formId, windowObj) {
	return new ModalBuilder()
		.setCustomId(`window-modal|${formId}`)
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

// ---------- Forms (subscribe + edit) ----------

// Each open form gets its own id (the id of the interaction that opened it), carried by
// all its components: two messages opened by the same user never share state.
const FORM_TTL_MS = 30 * 60 * 1000;
const forms = new Map(); // formId -> { kind, userId, createdAt, ...form fields }

function openForm(interaction, state) {
	forms.set(interaction.id, { ...state, userId: interaction.user.id, createdAt: Date.now() });
	return interaction.id;
}

function getForm(formId, userId) {
	const form = forms.get(formId);
	return form && form.userId === userId ? form : null;
}

function sweepExpiredForms(now = Date.now()) {
	for (const [formId, form] of forms) {
		if (now - form.createdAt > FORM_TTL_MS) forms.delete(formId);
	}
}

function getUserSubscriptions(userId) {
	return subscriptions.filter(sub => sub.userId === userId);
}

function findUserSubscription(userId, subscriptionId) {
	return subscriptions.find(sub => sub.id === subscriptionId && sub.userId === userId) || null;
}

function isAlreadySubscribed(userId, voteUrlId) {
	return subscriptions.some(sub => sub.userId === userId && sub.voteUrlId === voteUrlId);
}

function voteEntryLabel(voteUrlId) {
	return getVoteUrlEntryById(voteUrlId)?.label || tr('Serveur inconnu', 'Unknown server');
}

function renderSubscribeForm(formId, form) {
	const entries = getVoteUrlEntries();
	const entry = getVoteUrlEntryById(form.voteUrlId);
	if (form.mode === 'channel' && !entry?.channelId) form.mode = 'dm';
	const duplicate = entry ? isAlreadySubscribed(form.userId, entry.id) : false;
	const description = [tr('Choisissez vos options avec les menus ci-dessous, puis cliquez sur **Valider**.', 'Pick your options with the menus below, then click **Confirm**.')];
	if (duplicate) {
		description.push(tr('⚠️ Vous êtes déjà abonné à **{label}**. Utilisez `/status` pour modifier cet abonnement.', '⚠️ You are already subscribed to **{label}**. Use `/status` to edit that subscription.', { label: entry.label }));
	}
	const preview = { window: form.window, lastVotedAt: null, lastReminderAt: null, voteUrlId: form.voteUrlId, timezone: form.timezone };
	const embed = new EmbedBuilder()
		.setColor(duplicate ? COLOR_WARNING : COLOR_REMINDER)
		.setTitle(tr('🔔 Nouvel abonnement aux rappels', '🔔 New reminder subscription'))
		.setDescription(description.join('\n\n'))
		.addFields(
			{ name: tr('Serveur', 'Server'), value: entry ? entry.label : tr('(aucun)', '(none)'), inline: true },
			{ name: tr('Rappel toutes les', 'Remind every'), value: entry ? cooldownLabel(entry.cooldownMinutes) : '-', inline: true },
			{ name: 'Mode', value: modeLabel(form.mode, entry?.channelId), inline: true },
			{ name: tr('Plage horaire', 'Time window'), value: windowLabel(form.window), inline: true },
			{ name: tr('Fuseau horaire', 'Timezone'), value: timezoneLabel(form.timezone), inline: true },
			{ name: tr('Premier rappel', 'First reminder'), value: entry ? nextReminderText(preview) : '-', inline: true }
		);
	const voteMenu = new StringSelectMenuBuilder()
		.setCustomId(`subscribe-vote|${formId}`)
		.setPlaceholder(tr('Choisissez un serveur', 'Choose a server'))
		.addOptions(entries.slice(0, MAX_VOTE_ENTRIES).map(e => ({
			label: e.label.slice(0, 100),
			value: e.id,
			description: isAlreadySubscribed(form.userId, e.id)
				? tr('✅ Déjà abonné', '✅ Already subscribed')
				: tr('Rappel toutes les {cooldown}', 'Reminder every {cooldown}', { cooldown: cooldownLabel(e.cooldownMinutes) }),
			default: e.id === form.voteUrlId
		})));
	return {
		embeds: [embed],
		components: [
			new ActionRowBuilder().addComponents(voteMenu),
			new ActionRowBuilder().addComponents(buildWindowSelect(`subscribe-window|${formId}`, form.window)),
			new ActionRowBuilder().addComponents(buildModeSelect(`subscribe-mode|${formId}`, form.mode, entry)),
			new ActionRowBuilder().addComponents(buildTimezoneSelect(`subscribe-timezone|${formId}`, form.timezone)),
			new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId(`subscribe-confirm|${formId}`).setLabel(tr('Valider', 'Confirm')).setStyle(ButtonStyle.Success).setDisabled(!entry || duplicate),
				new ButtonBuilder().setCustomId(`subscribe-cancel|${formId}`).setLabel(tr('Annuler', 'Cancel')).setStyle(ButtonStyle.Secondary)
			)
		]
	};
}

function renderEditForm(formId, form, sub) {
	const entry = getVoteUrlEntryById(sub.voteUrlId);
	if (form.mode === 'channel' && !entry?.channelId) form.mode = 'dm';
	const embed = new EmbedBuilder()
		.setColor(COLOR_REMINDER)
		.setTitle(tr('✏️ Modifier l’abonnement : {label}', '✏️ Edit subscription: {label}', { label: voteEntryLabel(sub.voteUrlId) }).slice(0, 256))
		.setDescription(tr('Utilisez les menus puis cliquez sur **Valider** ou **Annuler**.', 'Use the menus then press **Confirm** or **Cancel**.'))
		.addFields(
			{ name: tr('Plage horaire', 'Time window'), value: windowLabel(form.window), inline: true },
			{ name: tr('Fuseau horaire', 'Timezone'), value: timezoneLabel(form.timezone), inline: true },
			{ name: 'Mode', value: modeLabel(form.mode, entry?.channelId), inline: true }
		);
	return {
		embeds: [embed],
		components: [
			new ActionRowBuilder().addComponents(buildWindowSelect(`edit-window|${formId}`, form.window)),
			new ActionRowBuilder().addComponents(buildModeSelect(`edit-mode|${formId}`, form.mode, entry)),
			new ActionRowBuilder().addComponents(buildTimezoneSelect(`edit-timezone|${formId}`, form.timezone)),
			new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId(`edit-confirm|${formId}`).setLabel(tr('Valider', 'Confirm')).setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId(`edit-cancel|${formId}`).setLabel(tr('Annuler', 'Cancel')).setStyle(ButtonStyle.Secondary)
			)
		]
	};
}

// Renders an open form, or null when its subscription no longer exists.
function renderForm(formId, form) {
	if (form.kind === 'subscribe') return renderSubscribeForm(formId, form);
	const sub = findUserSubscription(form.userId, form.subscriptionId);
	return sub ? renderEditForm(formId, form, sub) : null;
}

// ---------- /status ----------

// Discord rejects embeds over 6000 characters in total.
const EMBED_CHAR_BUDGET = 5500;

function buildSubscriptionField(sub, index, selectedId) {
	const entry = getVoteUrlEntryById(sub.voteUrlId);
	const lines = [
		`🕗 ${windowLabel(sub.window)} · ${timezoneLabel(getSubscriptionTimezone(sub))}`,
		modeLabel(sub.mode, sub.channelId),
		tr('⏱️ Rappel toutes les {cooldown} tant que vous n’avez pas voté', '⏱️ Reminder every {cooldown} until you vote', {
			cooldown: entry ? cooldownLabel(entry.cooldownMinutes) : '?'
		}),
		sub.lastVotedAt
			? tr('🗳️ Dernier vote : {when}', '🗳️ Last vote: {when}', { when: relativeTs(sub.lastVotedAt) })
			: tr('🗳️ Dernier vote : jamais enregistré', '🗳️ Last vote: never recorded'),
		sub.paused
			? tr('⚠️ **En pause** : rappels non délivrés', '⚠️ **Paused**: reminders not delivered')
			: tr('🔔 Prochain rappel : {next}', '🔔 Next reminder: {next}', { next: nextReminderText(sub) })
	];
	return {
		name: `${sub.id === selectedId ? '👉 ' : ''}${index + 1}. ${voteEntryLabel(sub.voteUrlId)}${sub.paused ? ' ⏸️' : ''}`.slice(0, 256),
		value: lines.join('\n').slice(0, 1024)
	};
}

function subscriptionOption(sub, index, isDefault) {
	return {
		label: `${index + 1}. ${voteEntryLabel(sub.voteUrlId)}`.slice(0, 100),
		value: sub.id,
		emoji: sub.paused ? '⏸️' : (sub.mode === 'channel' ? '📢' : '📨'),
		description: `${windowLabel(sub.window)} · ${nextReminderPlain(sub)}`.slice(0, 100),
		default: isDefault
	};
}

function renderStatus(userId, selectedId, notice = null) {
	const subs = getUserSubscriptions(userId).slice(0, 25);
	if (subs.length === 0) {
		return { content: [notice, MSG.noSubscriptions()].filter(Boolean).join('\n') };
	}
	const selected = subs.find(sub => sub.id === selectedId) || subs[0];
	const title = tr('📋 Vos abonnements ({count})', '📋 Your subscriptions ({count})', { count: subs.length });
	const description = [notice, tr('Sélectionnez un abonnement dans le menu pour le modifier ou le supprimer.', 'Select a subscription in the menu to edit or delete it.')];
	if (subs.some(sub => sub.paused)) {
		description.push(tr('⏸️ Un abonnement en pause n’a pas pu recevoir ses rappels (MP fermés ?). Vérifiez vos paramètres de confidentialité, sélectionnez-le puis cliquez sur **Réactiver**.', '⏸️ A paused subscription could not receive its reminders (DMs closed?). Check your privacy settings, select it, then click **Resume**.'));
	}
	let size = title.length + description.join('\n\n').length + 100;
	const fields = [];
	for (const [idx, sub] of subs.entries()) {
		const field = buildSubscriptionField(sub, idx, selected.id);
		size += field.name.length + field.value.length;
		if (size > EMBED_CHAR_BUDGET) break;
		fields.push(field);
	}
	if (fields.length < subs.length) {
		description.push(tr('… et {count} autre(s) : utilisez le menu pour les voir.', '… and {count} more: use the menu to see them.', { count: subs.length - fields.length }));
	}
	const embed = new EmbedBuilder()
		.setColor(subs.some(sub => sub.paused) ? COLOR_WARNING : COLOR_REMINDER)
		.setTitle(title)
		.setDescription(description.filter(Boolean).join('\n\n'))
		.addFields(fields);
	const select = new StringSelectMenuBuilder()
		.setCustomId('status-select')
		.setPlaceholder(tr('Choisissez un abonnement à gérer', 'Choose a subscription to manage'))
		.addOptions(subs.map((sub, idx) => subscriptionOption(sub, idx, sub.id === selected.id)));
	const buttons = [
		new ButtonBuilder().setCustomId(`status-edit|${selected.id}`).setLabel(tr('Modifier', 'Edit')).setEmoji('✏️').setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(`status-delete|${selected.id}`).setLabel(tr('Supprimer', 'Delete')).setEmoji('🗑️').setStyle(ButtonStyle.Danger)
	];
	if (selected.paused) {
		buttons.unshift(new ButtonBuilder().setCustomId(`status-resume|${selected.id}`).setLabel(tr('Réactiver', 'Resume')).setEmoji('▶️').setStyle(ButtonStyle.Success));
	}
	return {
		embeds: [embed],
		components: [
			new ActionRowBuilder().addComponents(select),
			new ActionRowBuilder().addComponents(...buttons)
		]
	};
}

// ---------- /unsubscribe ----------

function renderUnsubscribe(userId, choice) {
	const subs = getUserSubscriptions(userId).slice(0, 24); // keep room for "all"
	if (subs.length === 0) return { content: MSG.noSubscriptions() };
	const selected = subs.find(sub => sub.id === choice);
	const selectedChoice = selected ? selected.id : 'all';
	const select = new StringSelectMenuBuilder()
		.setCustomId('unsubscribe-select')
		.setPlaceholder(tr('Choisissez un abonnement à supprimer', 'Choose a subscription to delete'))
		.addOptions(subs.map((sub, idx) => subscriptionOption(sub, idx, sub.id === selectedChoice)))
		.addOptions({
			label: tr('Tous mes abonnements', 'All my subscriptions'),
			value: 'all',
			emoji: '🗑️',
			default: selectedChoice === 'all'
		});
	const selectionText = selected
		? `**${voteEntryLabel(selected.voteUrlId)}** (${windowLabel(selected.window)})`
		: tr('tous vos abonnements ({count})', 'all your subscriptions ({count})', { count: getUserSubscriptions(userId).length });
	return {
		content: tr('Choisissez l’abonnement à supprimer (ou Tous).\nSélection : {selection}', 'Choose which subscription to delete (or All).\nSelection: {selection}', { selection: selectionText }),
		components: [
			new ActionRowBuilder().addComponents(select),
			new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId(`unsubscribe-confirm|${selectedChoice}`).setLabel(tr('Confirmer', 'Confirm')).setStyle(ButtonStyle.Danger),
				new ButtonBuilder().setCustomId('unsubscribe-cancel').setLabel(tr('Annuler', 'Cancel')).setStyle(ButtonStyle.Secondary)
			)
		]
	};
}

// ---------- /listvote ----------

function renderListVote(selectedId, notice = null) {
	const entries = getVoteUrlEntries();
	if (entries.length === 0) {
		return { content: [notice, tr('Aucune URL enregistrée. Utilisez /addvote.', 'No vote URL stored. Use /addvote.')].filter(Boolean).join('\n') };
	}
	const entry = getVoteUrlEntryById(selectedId);
	const lines = [notice];
	if (!entry) {
		lines.push(tr('Sélectionnez une entrée pour la modifier ou la supprimer.', 'Select an entry to edit or delete it.'));
	} else {
		const subscriberCount = subscriptions.filter(sub => sub.voteUrlId === entry.id).length;
		lines.push(
			`**${entry.label}** (\`${entry.id}\`)`,
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
				.setCustomId('listvote-select')
				.setPlaceholder(tr('Choisissez une entrée à gérer', 'Choose an entry to manage'))
				.addOptions(entries.slice(0, MAX_VOTE_ENTRIES).map(e => ({
					label: e.label.slice(0, 100),
					value: e.id,
					description: e.url.slice(0, 100),
					default: e.id === entry?.id
				})))
		)
	];
	if (entry) {
		rows.push(
			new ActionRowBuilder().addComponents(buildCooldownSelect(`listvote-cooldown|${entry.id}`, entry.cooldownMinutes)),
			new ActionRowBuilder().addComponents(buildChannelSelect(`listvote-channel|${entry.id}`, entry.channelId)),
			new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId(`listvote-edit|${entry.id}`).setLabel(tr('Modifier nom / URL', 'Edit name / URL')).setEmoji('✏️').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId(`listvote-delete|${entry.id}`).setLabel(tr('Supprimer', 'Delete')).setEmoji('🗑️').setStyle(ButtonStyle.Danger)
			)
		);
	}
	return { content: lines.filter(line => line !== null).join('\n'), components: rows };
}

function buildCooldownSelect(customId, minutes) {
	const select = new StringSelectMenuBuilder()
		.setCustomId(customId)
		.setPlaceholder(tr('Délai entre deux votes', 'Cooldown between votes'));
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

function updateVoteEntry(entryId, fields) {
	const entries = getVoteUrlEntries();
	const idx = entries.findIndex(entry => entry.id === entryId);
	if (idx === -1) return null;
	const updatedEntry = { ...entries[idx], ...fields };
	config.voteUrls = entries.map((entry, i) => (i === idx ? updatedEntry : entry));
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
		if (updatedSubs > 0) persistSubscriptions();
	}
	return updatedEntry;
}

// Deletes a vote entry and the subscriptions to it. Returns the number of subscriptions removed.
function deleteVoteEntry(entryId) {
	config.voteUrls = getVoteUrlEntries().filter(entry => entry.id !== entryId);
	if (!getVoteUrlEntryById(config.defaultVoteUrlId)) {
		config.defaultVoteUrlId = config.voteUrls[0]?.id || null;
	}
	syncLegacyVoteBaseUrl();
	saveConfig(config);
	const before = subscriptions.length;
	subscriptions = subscriptions.filter(sub => sub.voteUrlId !== entryId);
	const removed = before - subscriptions.length;
	if (removed > 0) persistSubscriptions();
	return removed;
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
	return buildVoteUrl(entry?.url || config.voteBaseUrl, username);
}

function buildVoteLinkUrl(sub, directVoteUrl) {
	if (!PUBLIC_BASE_URL) return directVoteUrl;
	// The subscription id is needed so the vote is recorded on the right subscription.
	const voteToken = signToken({ sid: sub.id, uid: sub.userId, iat: Date.now() }, MARK_SECRET);
	return `${PUBLIC_BASE_URL}/v?t=${encodeURIComponent(voteToken)}`;
}

function isAdminInteraction(interaction) {
	return interaction.guildId === GUILD_ID && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true;
}

function isAdminAction(interaction) {
	if (interaction.isChatInputCommand()) return ['addvote', 'listvote'].includes(interaction.commandName);
	return typeof interaction.customId === 'string' && /^(addvote|listvote)-/.test(interaction.customId);
}

// ---------- Reminder messages ----------

function reminderTitle(entry) {
	return tr('🗳️ Rappel de vote : {label}', '🗳️ Vote reminder: {label}', { label: entry ? entry.label : '?' }).slice(0, 256);
}

// In a channel, a link button would expose the subscriber's signed /v link to every member:
// a regular button checks who clicks and answers with the link privately instead.
function buildReminderButtons(sub, voteLinkUrl, inPublicChannel) {
	const voteButton = inPublicChannel && PUBLIC_BASE_URL
		? new ButtonBuilder()
			.setCustomId(`reminder-link|${sub.id}`)
			.setLabel(tr('Voter maintenant', 'Vote now'))
			.setEmoji('🗳️')
			.setStyle(ButtonStyle.Primary)
		: new ButtonBuilder()
			.setLabel(tr('Voter maintenant', 'Vote now'))
			.setStyle(ButtonStyle.Link)
			.setURL(voteLinkUrl);
	return new ActionRowBuilder().addComponents(
		voteButton,
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

function buildReminderSnoozedEmbed(sub) {
	const next = getNextReminderAt(sub);
	return new EmbedBuilder()
		.setColor(COLOR_REMINDER)
		.setTitle(reminderTitle(getVoteUrlEntryById(sub.voteUrlId)))
		.setDescription(tr('⏰ Rappel reporté : nouveau rappel {when}.', '⏰ Reminder snoozed: next reminder {when}.', { when: next ? relativeTs(next) : '-' }));
}

// Without the GuildMembers intent the member cache is never updated:
// display names are fetched again from Discord at most once per hour.
const DISPLAY_NAME_TTL_MS = 60 * 60 * 1000;
const displayNameCache = new Map(); // `${guildId}:${userId}` -> { name, fetchedAt }

async function getDisplayNameForUser(guildId, userId, fallbackUsername) {
	if (!guildId) return fallbackUsername;
	const key = `${guildId}:${userId}`;
	const cached = displayNameCache.get(key);
	if (cached && Date.now() - cached.fetchedAt < DISPLAY_NAME_TTL_MS) return cached.name;
	try {
		const guild = await client.guilds.fetch(guildId);
		const member = await guild.members.fetch({ user: userId, force: true });
		const name = member.displayName || fallbackUsername;
		displayNameCache.set(key, { name, fetchedAt: Date.now() });
		return name;
	} catch {
		return cached?.name || fallbackUsername;
	}
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
		const embeds = [buildReminderEmbed(sub, entry, now)];
		if (sub.mode === 'channel' && sub.channelId) {
			message = await deliverReminderViaChannel(sub, { embeds, components: [buildReminderButtons(sub, voteLinkUrl, true)] }, context);
			if (!message) {
				log('warn', 'Echec du rappel via channel, tentative en MP', context);
			}
		} else if (sub.mode === 'channel') {
			log('warn', 'Mode channel demande mais aucun channelId stocke', context);
		}
		if (!message) {
			message = await deliverReminderViaDm(user, { embeds, components: [buildReminderButtons(sub, voteLinkUrl, false)] }, context, sub.mode === 'channel');
		}
	} catch (err) {
		log('error', 'Erreur lors de la preparation du rappel', { ...context, error: serializeError(err) });
	}
	// Counted as an attempt even on failure, so a failing route is retried after the cooldown, not every minute.
	sub.lastReminderAt = now;
	// A snooze clicked while this reminder was being sent stays in place.
	if (sub.snoozeUntil && sub.snoozeUntil <= now) sub.snoozeUntil = null;
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
	persistSubscriptions();
}

function markVoted(sub) {
	sub.lastVotedAt = Date.now();
	sub.snoozeUntil = null;
	sub.paused = false;
	sub.failedDeliveries = 0;
	persistSubscriptions();
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
let reminderCronTask = null;
const REMINDER_CONCURRENCY = 5;

function isSubscriptionDue(sub, now) {
	// Subscriptions whose vote entry no longer exists are never reminded with another server's link.
	if (!sub.userId || !getVoteUrlEntryById(sub.voteUrlId)) return false;
	try {
		return isReminderDue(sub, getCooldownMsForSubscriber(sub), now, getSubscriptionTimezone(sub));
	} catch (err) {
		log('error', 'Erreur lors du calcul du prochain rappel', { subscriptionId: sub.id, error: serializeError(err) });
		return false;
	}
}

// A single loop checks every subscription each minute: a reminder is due when the
// cooldown since the last reminder/vote has elapsed and the user is inside their window.
async function runReminderTick() {
	if (reminderTickRunning) return;
	reminderTickRunning = true;
	try {
		const now = Date.now();
		sweepExpiredForms(now);
		const due = subscriptions.filter(sub => isSubscriptionDue(sub, now));
		for (let i = 0; i < due.length; i += REMINDER_CONCURRENCY) {
			await Promise.all(due.slice(i, i + REMINDER_CONCURRENCY).map(async sub => {
				// Deleted while earlier reminders were being sent.
				if (!subscriptions.includes(sub)) return;
				try {
					await sendVoteReminder(sub);
				} catch (err) {
					log('error', 'Erreur lors de l’envoi du rappel', { subscriptionId: sub.id, userId: sub.userId, error: serializeError(err) });
				}
			}));
		}
	} finally {
		reminderTickRunning = false;
	}
}

client.once(Events.ClientReady, () => {
	log('info', 'Client pret', { tag: client.user.tag, subscriptions: subscriptions.length });
	reminderCronTask = cron.schedule('* * * * *', runReminderTick);
	runReminderTick();
});

client.on(Events.Error, err => log('error', 'Erreur du client Discord', { error: serializeError(err) }));
process.on('unhandledRejection', reason => log('error', 'Promesse rejetee non geree', { error: serializeError(reason) }));

// ---------- Interaction handlers ----------

const MSG = {
	expired: () => tr('Ce message a expiré. Relancez la commande.', 'This message has expired. Run the command again.'),
	noSubscriptions: () => tr('Aucun abonnement actif. Utilisez `/subscribe` pour en créer un.', 'No active subscriptions. Use `/subscribe` to create one.'),
	subscriptionNotFound: () => tr('Abonnement introuvable.', 'Subscription not found.'),
	entryNotFound: () => tr('Entrée introuvable. Relancez /listvote.', 'Entry not found. Run /listvote again.'),
	emptyName: () => tr('Le nom ne peut pas être vide.', 'Name cannot be empty.'),
	invalidUrl: () => tr('URL invalide : elle doit commencer par https:// et faire au plus {max} caractères (le paramètre `{pseudo}` est autorisé).', 'Invalid URL: it must start with https:// and be at most {max} characters long (the `{pseudo}` placeholder is allowed).', { max: MAX_VOTE_URL_LENGTH }),
	noChannel: () => tr('Aucun salon configuré pour ce serveur. Choisissez MP.', 'No channel configured for this server. Pick DM.'),
	reservedToRecipient: () => tr('Ce bouton est réservé au destinataire du rappel.', 'This button is reserved for the reminder recipient.'),
	adminOnly: () => tr('Réservé aux membres ayant la permission « Gérer le serveur » sur le serveur du bot.', 'Reserved to members with the “Manage Server” permission on the bot’s server.')
};

// Updates the message the interaction comes from, or replies when there is none.
async function respond(interaction, payload) {
	if (interaction.isMessageComponent() || (interaction.isModalSubmit() && interaction.isFromMessage())) {
		await interaction.update(asUpdate(payload));
	} else {
		await interaction.reply(asReply(payload));
	}
}

function readVoteForm(interaction, nameField, urlField) {
	const label = interaction.fields.getTextInputValue(nameField)?.trim();
	const url = interaction.fields.getTextInputValue(urlField)?.trim();
	if (!label) return { error: MSG.emptyName() };
	if (!isValidVoteUrl(url)) return { error: MSG.invalidUrl() };
	return { label, url };
}

async function handleAddVoteModal(interaction, cooldownRaw, channelRaw) {
	const { label, url, error } = readVoteForm(interaction, 'display_name', 'vote_url');
	if (error) {
		await interaction.reply(asReply({ content: error }));
		return;
	}
	const allEntries = getVoteUrlEntries();
	if (allEntries.length >= MAX_VOTE_ENTRIES) {
		await interaction.reply(asReply({ content: tr('Limite de {max} URLs de vote atteinte. Supprimez-en une avec /listvote.', 'Limit of {max} vote URLs reached. Delete one with /listvote.', { max: MAX_VOTE_ENTRIES }) }));
		return;
	}
	const entry = {
		id: generateVoteUrlId(label, new Set(allEntries.map(e => e.id))),
		label,
		url,
		cooldownMinutes: parseInt(cooldownRaw, 10) || DEFAULT_COOLDOWN_MINUTES,
		channelId: channelRaw || null
	};
	config.voteUrls = [...allEntries, entry];
	if (!config.defaultVoteUrlId) {
		config.defaultVoteUrlId = entry.id;
		// Subscriptions migrated from the single-URL era have no vote entry yet.
		const orphans = subscriptions.filter(sub => !sub.voteUrlId);
		for (const sub of orphans) {
			sub.voteUrlId = entry.id;
			if (sub.mode === 'channel') sub.channelId = entry.channelId;
		}
		if (orphans.length > 0) persistSubscriptions();
	}
	syncLegacyVoteBaseUrl();
	saveConfig(config);
	log('info', 'URL ajoutee via /addvote', { userId: interaction.user.id, id: entry.id, url: entry.url, cooldownMinutes: entry.cooldownMinutes, channelId: entry.channelId });
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
}

async function handleListVoteEditModal(interaction, entryId) {
	if (!getVoteUrlEntryById(entryId)) {
		await respond(interaction, { content: MSG.entryNotFound() });
		return;
	}
	const { label, url, error } = readVoteForm(interaction, 'edit_display_name', 'edit_vote_url');
	if (error) {
		await interaction.reply(asReply({ content: error }));
		return;
	}
	updateVoteEntry(entryId, { label, url });
	log('info', 'URL modifiee via /listvote', { userId: interaction.user.id, id: entryId, url });
	await respond(interaction, renderListVote(entryId, tr('✅ Entrée mise à jour.', '✅ Entry updated.')));
}

async function handleWindowModal(interaction, formId) {
	const form = getForm(formId, interaction.user.id);
	if (!form) {
		await respond(interaction, { content: MSG.expired() });
		return;
	}
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
	form.window = { start, end };
	await respond(interaction, renderForm(formId, form) || { content: MSG.subscriptionNotFound() });
}

async function handleModalSubmit(interaction) {
	const [action, ...args] = interaction.customId.split('|');
	if (action === 'addvote-modal') await handleAddVoteModal(interaction, ...args);
	else if (action === 'listvote-edit-modal') await handleListVoteEditModal(interaction, args[0]);
	else if (action === 'window-modal') await handleWindowModal(interaction, args[0]);
}

// Form selects shared by /subscribe and the /status edit form.
async function handleFormSelect(interaction, formId, field) {
	const form = getForm(formId, interaction.user.id);
	if (!form) {
		await interaction.update(asUpdate({ content: MSG.expired() }));
		return;
	}
	const value = interaction.values[0];
	if (field === 'vote') {
		form.voteUrlId = value;
	} else if (field === 'window') {
		if (applyWindowSelection(form, value) === 'custom') {
			await interaction.showModal(buildWindowModal(formId, form.window));
			return;
		}
	} else {
		applyFormSelect(form, field, value);
	}
	await interaction.update(asUpdate(renderForm(formId, form) || { content: MSG.subscriptionNotFound() }));
}

async function handleSubscribeConfirm(interaction, formId) {
	const userId = interaction.user.id;
	const form = getForm(formId, userId);
	if (!form) {
		await interaction.update(asUpdate({ content: MSG.expired() }));
		return;
	}
	const voteEntry = getVoteUrlEntryById(form.voteUrlId);
	if (!voteEntry) {
		await interaction.reply(asReply({ content: tr('Merci de sélectionner un serveur.', 'Please select a server.') }));
		return;
	}
	if (isAlreadySubscribed(userId, voteEntry.id)) {
		await interaction.reply(asReply({ content: tr('Vous êtes déjà abonné à ce serveur. Utilisez /status pour le modifier.', 'You are already subscribed to this server. Use /status to edit it.') }));
		return;
	}
	if (form.mode === 'channel' && !voteEntry.channelId) {
		await interaction.reply(asReply({ content: MSG.noChannel() }));
		return;
	}
	const record = addSubscription(subscriptions, {
		userId,
		voteUrlId: voteEntry.id,
		window: form.window,
		mode: form.mode,
		channelId: form.mode === 'channel' ? voteEntry.channelId : null,
		timezone: form.timezone,
		guildId: form.guildId || interaction.guildId || null
	});
	persistSubscriptions();
	forms.delete(formId);
	log('info', 'Utilisateur inscrit aux rappels', {
		subscriptionId: record.id,
		userId,
		mode: record.mode,
		channelId: record.channelId,
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
}

async function handleEditConfirm(interaction, formId) {
	const userId = interaction.user.id;
	const form = getForm(formId, userId);
	const sub = form ? findUserSubscription(userId, form.subscriptionId) : null;
	if (!sub) {
		await interaction.update(asUpdate(form ? renderStatus(userId, null, MSG.subscriptionNotFound()) : { content: MSG.expired() }));
		return;
	}
	const voteEntry = getVoteUrlEntryById(sub.voteUrlId);
	if (form.mode === 'channel' && !voteEntry?.channelId) {
		await interaction.reply(asReply({ content: MSG.noChannel() }));
		return;
	}
	sub.window = form.window;
	sub.timezone = form.timezone;
	sub.mode = form.mode;
	sub.channelId = form.mode === 'channel' ? voteEntry.channelId : null;
	// Changing the delivery settings is the way out of a paused subscription.
	sub.paused = false;
	sub.failedDeliveries = 0;
	persistSubscriptions();
	forms.delete(formId);
	log('info', 'Abonnement modifie via status', { userId, subscriptionId: sub.id, mode: sub.mode, channelId: sub.channelId, window: sub.window, timezone: sub.timezone });
	await interaction.update(asUpdate(renderStatus(userId, sub.id, tr('✅ Modifications enregistrées.', '✅ Changes saved.'))));
}

async function handleStatusButton(interaction, action, subscriptionId) {
	const userId = interaction.user.id;
	const sub = findUserSubscription(userId, subscriptionId);
	if (!sub) {
		await interaction.update(asUpdate(renderStatus(userId, null, MSG.subscriptionNotFound())));
		return;
	}
	if (action === 'status-edit') {
		const entry = getVoteUrlEntryById(sub.voteUrlId);
		const formId = openForm(interaction, {
			kind: 'edit',
			subscriptionId: sub.id,
			window: sub.window ? { ...sub.window } : null,
			timezone: getSubscriptionTimezone(sub),
			mode: sub.mode === 'channel' && entry?.channelId ? 'channel' : 'dm'
		});
		await interaction.update(asUpdate(renderEditForm(formId, forms.get(formId), sub)));
	} else if (action === 'status-resume') {
		sub.paused = false;
		sub.failedDeliveries = 0;
		persistSubscriptions();
		log('info', 'Abonnement reactive via status', { userId, subscriptionId: sub.id });
		await interaction.update(asUpdate(renderStatus(userId, sub.id, tr('▶️ Abonnement réactivé.', '▶️ Subscription resumed.'))));
	} else if (action === 'status-delete') {
		removeSubscription(subscriptions, sub.id);
		persistSubscriptions();
		log('info', 'Abonnement supprime via status', { userId, subscriptionId: sub.id });
		await interaction.update(asUpdate(renderStatus(userId, null, tr('🗑️ Abonnement {label} supprimé.', '🗑️ Subscription {label} deleted.', { label: voteEntryLabel(sub.voteUrlId) }))));
	}
}

async function handleUnsubscribeConfirm(interaction, choice) {
	const userId = interaction.user.id;
	let removed = 0;
	if (choice === 'all') {
		removed = removeAllSubscriptionsForUser(subscriptions, userId);
	} else if (findUserSubscription(userId, choice)) {
		removed = removeSubscription(subscriptions, choice) ? 1 : 0;
	}
	if (removed > 0) persistSubscriptions();
	log('info', 'Utilisateur desinscrit', { userId, removed, scope: choice });
	await interaction.update(asUpdate({
		content: removed > 0
			? tr('Abonnement{plural} supprimé{plural}.', 'Subscription{plural} deleted.', { plural: removed > 1 ? 's' : '' })
			: tr('Aucun abonnement supprimé.', 'No subscription deleted.')
	}));
}

async function handleListVoteComponent(interaction, action, entryId) {
	const entry = getVoteUrlEntryById(entryId);
	if (!entry) {
		await interaction.update(asUpdate({ content: MSG.entryNotFound() }));
		return;
	}
	if (action === 'listvote-cooldown') {
		const minutes = parseInt(interaction.values[0], 10);
		updateVoteEntry(entry.id, { cooldownMinutes: minutes });
		log('info', 'Delai modifie via /listvote', { userId: interaction.user.id, id: entry.id, minutes });
		await interaction.update(asUpdate(renderListVote(entry.id, tr('✅ Délai mis à jour : {cooldown}.', '✅ Cooldown updated: {cooldown}.', { cooldown: cooldownLabel(minutes) }))));
	} else if (action === 'listvote-channel') {
		const channelId = interaction.values[0] || null;
		updateVoteEntry(entry.id, { channelId });
		log('info', 'Salon modifie via /listvote', { userId: interaction.user.id, id: entry.id, channelId });
		await interaction.update(asUpdate(renderListVote(entry.id, channelId
			? tr('✅ Salon mis à jour : <#{channel}>.', '✅ Channel updated: <#{channel}>.', { channel: channelId })
			: tr('✅ Salon retiré : rappels en MP uniquement.', '✅ Channel removed: DM reminders only.'))));
	} else if (action === 'listvote-edit') {
		await interaction.showModal(new ModalBuilder()
			.setCustomId(`listvote-edit-modal|${entry.id}`)
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
						.setMaxLength(MAX_VOTE_URL_LENGTH)
						.setValue(entry.url.slice(0, MAX_VOTE_URL_LENGTH))
				)
			));
	} else if (action === 'listvote-delete') {
		const removed = deleteVoteEntry(entry.id);
		log('info', 'URL supprimee via /listvote', { userId: interaction.user.id, id: entry.id, subscriptionsRemoved: removed });
		await interaction.update(asUpdate(renderListVote(null, tr('🗑️ Entrée {label} supprimée ({count} abonnement(s) supprimé(s)).', '🗑️ Entry {label} deleted ({count} subscription(s) removed).', { label: entry.label, count: removed }))));
	}
}

async function handleReminderButton(interaction, action, subscriptionId) {
	const sub = subscriptions.find(s => s.id === subscriptionId);
	if (!sub) {
		await interaction.reply(asReply({ content: tr('Abonnement introuvable ou supprimé.', 'Subscription not found or deleted.') }));
		return;
	}
	if (interaction.user.id !== sub.userId) {
		await interaction.reply(asReply({ content: MSG.reservedToRecipient() }));
		return;
	}
	if (action === 'reminder-link') {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const { voteLinkUrl } = await buildVoteLinkForSub(sub);
		await interaction.editReply(voteLinkUrl
			? {
				content: tr('Voici votre lien de vote personnel :', 'Here is your personal vote link:'),
				components: [new ActionRowBuilder().addComponents(
					new ButtonBuilder().setLabel(tr('Voter maintenant', 'Vote now')).setStyle(ButtonStyle.Link).setURL(voteLinkUrl)
				)]
			}
			: { content: tr('Aucune URL de vote configurée.', 'No vote URL configured.') });
		return;
	}
	if (action === 'reminder-snooze') {
		sub.snoozeUntil = Date.now() + SNOOZE_MINUTES * 60 * 1000;
		persistSubscriptions();
		log('info', 'Rappel reporte', { userId: sub.userId, subscriptionId: sub.id });
		// Only the embed changes: the buttons stay as they are, no need to rebuild the vote link.
		await interaction.update({ embeds: [buildReminderSnoozedEmbed(sub)] });
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

// Components carry their target in their custom id: "<action>|<form, subscription or entry id>".
const COMPONENT_HANDLERS = {
	'subscribe-vote': (i, formId) => handleFormSelect(i, formId, 'vote'),
	'subscribe-window': (i, formId) => handleFormSelect(i, formId, 'window'),
	'subscribe-mode': (i, formId) => handleFormSelect(i, formId, 'mode'),
	'subscribe-timezone': (i, formId) => handleFormSelect(i, formId, 'timezone'),
	'subscribe-confirm': handleSubscribeConfirm,
	'subscribe-cancel': async (i, formId) => {
		forms.delete(formId);
		await i.update(asUpdate({ content: tr('Formulaire annulé.', 'Form cancelled.') }));
	},
	'edit-window': (i, formId) => handleFormSelect(i, formId, 'window'),
	'edit-mode': (i, formId) => handleFormSelect(i, formId, 'mode'),
	'edit-timezone': (i, formId) => handleFormSelect(i, formId, 'timezone'),
	'edit-confirm': handleEditConfirm,
	'edit-cancel': async (i, formId) => {
		const form = getForm(formId, i.user.id);
		forms.delete(formId);
		await i.update(asUpdate(renderStatus(i.user.id, form?.subscriptionId)));
	},
	'status-select': i => i.update(asUpdate(renderStatus(i.user.id, i.values[0]))),
	'status-edit': (i, subId) => handleStatusButton(i, 'status-edit', subId),
	'status-resume': (i, subId) => handleStatusButton(i, 'status-resume', subId),
	'status-delete': (i, subId) => handleStatusButton(i, 'status-delete', subId),
	'unsubscribe-select': i => i.update(asUpdate(renderUnsubscribe(i.user.id, i.values[0]))),
	'unsubscribe-confirm': handleUnsubscribeConfirm,
	'unsubscribe-cancel': i => i.update(asUpdate({ content: tr('Opération annulée.', 'Operation cancelled.') })),
	'listvote-select': i => i.update(asUpdate(renderListVote(i.values[0]))),
	'listvote-cooldown': (i, entryId) => handleListVoteComponent(i, 'listvote-cooldown', entryId),
	'listvote-channel': (i, entryId) => handleListVoteComponent(i, 'listvote-channel', entryId),
	'listvote-edit': (i, entryId) => handleListVoteComponent(i, 'listvote-edit', entryId),
	'listvote-delete': (i, entryId) => handleListVoteComponent(i, 'listvote-delete', entryId),
	'reminder-link': (i, subId) => handleReminderButton(i, 'reminder-link', subId),
	'reminder-snooze': (i, subId) => handleReminderButton(i, 'reminder-snooze', subId),
	'reminder-voted': (i, subId) => handleReminderButton(i, 'reminder-voted', subId),
	'reminder-reset': (i, subId) => handleReminderButton(i, 'reminder-voted', subId)
};

async function handleComponent(interaction) {
	const [action, arg] = interaction.customId.split('|');
	await COMPONENT_HANDLERS[action]?.(interaction, arg);
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
						.setMaxLength(MAX_VOTE_URL_LENGTH)
						.setPlaceholder('https://example.com/vote?user={pseudo}')
				)
			);
		await interaction.showModal(modal);
	} else if (commandName === 'listvote') {
		await interaction.reply(asReply(renderListVote(null)));
	} else if (commandName === 'subscribe') {
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
		const formId = openForm(interaction, {
			kind: 'subscribe',
			guildId: interaction.guildId || null,
			voteUrlId: defaultVote.id,
			window: { start: '08:00', end: '20:00' },
			timezone: config.timezone,
			mode: 'dm'
		});
		await interaction.reply(asReply(renderSubscribeForm(formId, forms.get(formId))));
	} else if (commandName === 'unsubscribe') {
		await interaction.reply(asReply(renderUnsubscribe(userId, getUserSubscriptions(userId)[0]?.id)));
	} else if (commandName === 'status') {
		await interaction.reply(asReply(renderStatus(userId, null)));
	}
}

client.on(Events.InteractionCreate, async (interaction) => {
	try {
		// Discord's default_member_permissions can be changed by server admins: check on our side too.
		if (isAdminAction(interaction) && !isAdminInteraction(interaction)) {
			await interaction.reply(asReply({ content: MSG.adminOnly() }));
			return;
		}
		if (interaction.isChatInputCommand()) {
			await handleCommand(interaction);
		} else if (interaction.isModalSubmit()) {
			await handleModalSubmit(interaction);
		} else if (interaction.isMessageComponent()) {
			await handleComponent(interaction);
		}
		// Components of messages sent by older versions, or forms that expired.
		if ((interaction.isMessageComponent() || interaction.isModalSubmit()) && !interaction.replied && !interaction.deferred) {
			await interaction.reply(asReply({ content: MSG.expired() }));
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
app.disable('x-powered-by');
app.get('/', (_req, res) => res.status(200).send('OK'));
app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
app.get('/v', async (req, res) => {
	try {
		if (!PUBLIC_BASE_URL) return res.status(404).send('Not found');
		const payload = verifyToken(req.query.t, MARK_SECRET);
		if (!payload) return res.status(400).send('Invalid or expired link');
		const sub = subscriptions.find(s => s.id === payload.sid && s.userId === payload.uid);
		if (!sub) return res.status(404).send('Not subscribed');
		// Build redirect URL with current display name
		const user = await client.users.fetch(sub.userId);
		const displayName = await getDisplayNameForUser(sub.guildId, sub.userId, user.username);
		const target = buildVoteUrlForUser(displayName, sub.voteUrlId);
		if (!target) {
			return res.status(503).send('Vote URL not configured');
		}
		// A replayed link (double click, link preview, script) does not rewrite data nor call Discord again.
		if (!sub.lastVotedAt || Date.now() - sub.lastVotedAt > VOTE_DEDUP_MS) {
			markVoted(sub);
			refreshLastReminderMessage(sub);
			log('info', 'Vote enregistre via redirection', { userId: sub.userId, subscriptionId: sub.id });
		}
		res.redirect(target);
	} catch (e) {
		log('error', 'Erreur lors de la redirection de vote', { error: serializeError(e) });
		res.status(500).send('Server error (redirect)');
	}
});

const server = app.listen(PORT, err => {
	if (err) {
		log('error', 'Impossible de demarrer le serveur HTTP', { port: PORT, error: serializeError(err) });
		process.exit(1);
	}
	log('info', 'HTTP redirect server listening', { port: PORT });
});

client.login(token);

// docker stop sends SIGTERM: write pending changes and disconnect cleanly.
async function shutdown(signal) {
	log('info', 'Arret du bot', { signal });
	reminderCronTask?.stop();
	flushSubscriptions();
	server.close();
	await client.destroy();
	process.exit(0);
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
