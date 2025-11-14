import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', 'data');
const subsPath = path.join(dataDir, 'subscriptions.json');
const legacySubsPath = path.join(dataDir, 'subscribers.json');

function ensureDataDir() {
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}
}

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
		timezone: raw.timezone || raw.tz || null,
		guildId: raw.guildId || null,
		lastKnownDisplayName: raw.lastKnownDisplayName || null,
		lastVotedAt: typeof raw.lastVotedAt === 'number' ? raw.lastVotedAt : null,
		lastReminderAt: typeof raw.lastReminderAt === 'number' ? raw.lastReminderAt : null
	};
}

// Schema v4 (per-subscription records).
// Legacy migrations handled by converting to per-subscription entries.
export function loadSubscriptions() {
	ensureDataDir();
	if (!fs.existsSync(subsPath)) {
		if (fs.existsSync(legacySubsPath)) {
			try {
				fs.copyFileSync(legacySubsPath, subsPath);
			} catch {
				fs.writeFileSync(subsPath, JSON.stringify([], null, 2), 'utf8');
			}
		} else {
			fs.writeFileSync(subsPath, JSON.stringify([], null, 2), 'utf8');
		}
	}
	try {
		const raw = fs.readFileSync(subsPath, 'utf8');
		const data = JSON.parse(raw);
		if (Array.isArray(data)) {
			if (data.length === 0) return [];
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
			if (migrated.length !== data.length) {
				saveSubscriptions(migrated);
			}
			return migrated;
		}
		return [];
	} catch {
		return [];
	}
}

export function saveSubscriptions(list) {
	ensureDataDir();
	fs.writeFileSync(subsPath, JSON.stringify(list, null, 2), 'utf8');
}

export function addSubscription(list, subscription) {
	const record = normalizeSubscription({ ...subscription, id: subscription.id || crypto.randomUUID() }, 'sub', list.length);
	list.push(record);
	return record;
}

export function updateSubscription(list, id, fields = {}) {
	const idx = list.findIndex(item => item.id === id);
	if (idx === -1) return null;
	const current = list[idx];
	const updated = normalizeSubscription({ ...current, ...fields, id }, 'sub', idx);
	list[idx] = updated;
	return updated;
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

export function getDataPaths() {
	return { dataDir, subsPath };
}
