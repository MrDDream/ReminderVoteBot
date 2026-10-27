import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readJson, writeJsonAtomic } from './jsonFile.js';
import { isValidTimezone } from './schedule.js';
import { dataDir, ensureDataDir } from './paths.js';

const subsPath = path.join(dataDir, 'subscriptions.json');
const legacySubsPath = path.join(dataDir, 'subscribers.json');

function normalizeWindow(window) {
	if (!window || typeof window !== 'object') return null;
	const { start, end } = window;
	if (typeof start !== 'string' || typeof end !== 'string') return null;
	return { start, end };
}

function normalizeSubscription(raw, fallbackPrefix, index) {
	const id = typeof raw.id === 'string' && raw.id ? raw.id : `${fallbackPrefix}${index}-${crypto.randomUUID()}`;
	return {
		id,
		userId: raw.userId,
		voteUrlId: raw.voteUrlId || raw.urlId || null,
		window: normalizeWindow(raw.window),
		mode: raw.mode === 'channel' ? 'channel' : 'dm',
		channelId: raw.channelId || null,
		timezone: isValidTimezone(raw.timezone || raw.tz) ? (raw.timezone || raw.tz) : null,
		guildId: raw.guildId || null,
		lastVotedAt: typeof raw.lastVotedAt === 'number' ? raw.lastVotedAt : null,
		lastReminderAt: typeof raw.lastReminderAt === 'number' ? raw.lastReminderAt : null,
		snoozeUntil: typeof raw.snoozeUntil === 'number' ? raw.snoozeUntil : null,
		failedDeliveries: typeof raw.failedDeliveries === 'number' ? raw.failedDeliveries : 0,
		paused: raw.paused === true,
		lastReminderMessage: raw.lastReminderMessage && raw.lastReminderMessage.channelId && raw.lastReminderMessage.messageId
			? { channelId: raw.lastReminderMessage.channelId, messageId: raw.lastReminderMessage.messageId }
			: null
	};
}

// Schema v4 (per-subscription records).
// Legacy migrations handled by converting to per-subscription entries.
export function loadSubscriptions() {
	ensureDataDir();
	if (!fs.existsSync(subsPath)) {
		if (fs.existsSync(legacySubsPath)) {
			fs.copyFileSync(legacySubsPath, subsPath);
		} else {
			saveSubscriptions([]);
		}
	}
	// readJson throws on unrecoverable corruption: better to stop than to
	// start with an empty list and overwrite the real data on the next save.
	const data = readJson(subsPath);
	if (!Array.isArray(data) || data.length === 0) return [];
	// Detect legacy schema
	if (typeof data[0] === 'string') {
		// v1 to v4: create basic subscription per user
		const migrated = data.map((userId, idx) => normalizeSubscription({ userId }, 'sub', idx));
		saveSubscriptions(migrated);
		return migrated;
	}
	const migrated = [];
	let idx = 0;
	for (const entry of data) {
		if (!entry) continue;
		if (Array.isArray(entry.subscriptions)) {
			for (const sub of entry.subscriptions) {
				migrated.push(normalizeSubscription({ ...sub, userId: entry.userId }, 'sub', idx++));
			}
			continue;
		}
		migrated.push(normalizeSubscription(entry, 'sub', idx++));
	}
	// Persist any normalization (new ids, migrated fields) so ids stay stable across restarts.
	if (JSON.stringify(migrated) !== JSON.stringify(data)) {
		saveSubscriptions(migrated);
	}
	return migrated;
}

export function saveSubscriptions(list) {
	ensureDataDir();
	writeJsonAtomic(subsPath, list);
}

export function addSubscription(list, subscription) {
	const record = normalizeSubscription({ ...subscription, id: subscription.id || crypto.randomUUID() }, 'sub', list.length);
	list.push(record);
	return record;
}

export function removeSubscription(list, id) {
	const idx = list.findIndex(item => item.id === id);
	if (idx === -1) return false;
	list.splice(idx, 1);
	return true;
}

export function removeAllSubscriptionsForUser(list, userId) {
	const before = list.length;
	for (let i = list.length - 1; i >= 0; i -= 1) {
		if (list[i].userId === userId) {
			list.splice(i, 1);
		}
	}
	return before - list.length;
}
