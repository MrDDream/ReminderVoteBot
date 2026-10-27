import fs from 'fs';
import path from 'path';
import './env.js';
import { readJson, writeJsonAtomic } from './jsonFile.js';
import { isValidTimezone } from './schedule.js';
import { dataDir, ensureDataDir } from './paths.js';
import { DEFAULT_COOLDOWN_MINUTES } from './constants.js';

const configPath = path.join(dataDir, 'config.json');
const FALLBACK_TIMEZONE = 'Europe/Paris';

function normalizeConfig(raw) {
	const cfg = { ...raw };
	cfg.timezone = cfg.timezone || process.env.DEFAULT_TZ || FALLBACK_TIMEZONE;
	if (!isValidTimezone(cfg.timezone)) {
		console.warn(`[WARN] Fuseau horaire invalide (${cfg.timezone}), utilisation de ${FALLBACK_TIMEZONE}`);
		cfg.timezone = FALLBACK_TIMEZONE;
	}
	const entries = Array.isArray(cfg.voteUrls) ? cfg.voteUrls : [];
	// Configs from the single-URL era: the URL becomes a regular vote entry.
	const legacyUrl = cfg.voteBaseUrl || process.env.DEFAULT_VOTE_URL;
	if (entries.length === 0 && legacyUrl) {
		entries.push({ id: 'vote', label: 'Vote', url: legacyUrl });
	}
	const withoutUrl = entries.filter(entry => !entry?.url);
	if (withoutUrl.length > 0) {
		console.warn(`[WARN] ${withoutUrl.length} URL(s) de vote sans adresse ignorée(s) dans ${configPath}`);
	}
	cfg.voteUrls = entries.filter(entry => entry?.url).map((entry, index) => ({
		id: entry.id || `entry-${index + 1}`,
		label: entry.label || entry.displayName || `Option ${index + 1}`,
		url: entry.url,
		cooldownMinutes: typeof entry.cooldownMinutes === 'number' && entry.cooldownMinutes > 0 ? entry.cooldownMinutes : DEFAULT_COOLDOWN_MINUTES,
		channelId: entry.channelId || null
	}));
	if (!cfg.voteUrls.some(entry => entry.id === cfg.defaultVoteUrlId)) {
		cfg.defaultVoteUrlId = cfg.voteUrls[0]?.id || null;
	}
	// Fields of older versions that nothing reads anymore.
	delete cfg.voteBaseUrl;
	delete cfg.intervalCron;
	delete cfg.forcedDeliveryMode;
	return cfg;
}

export function loadConfig() {
	ensureDataDir();
	// readJson throws on unrecoverable corruption instead of returning defaults
	// that would overwrite the configured vote URLs on the next save.
	const raw = fs.existsSync(configPath) ? readJson(configPath) : {};
	const cfg = normalizeConfig(raw);
	if (JSON.stringify(cfg) !== JSON.stringify(raw)) saveConfig(cfg);
	return cfg;
}

export function saveConfig(cfg) {
	ensureDataDir();
	writeJsonAtomic(configPath, cfg);
}
