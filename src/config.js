import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import './env.js';
import { readJson, writeJsonAtomic } from './jsonFile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', 'data');
const configPath = path.join(dataDir, 'config.json');

function ensureDataDir() {
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}
}

export function loadConfig() {
	ensureDataDir();
	if (!fs.existsSync(configPath)) {
		const initial = {
			voteBaseUrl: process.env.DEFAULT_VOTE_URL || null,
			intervalCron: '0 */2 * * *', // every 2 hours at minute 0
			timezone: process.env.DEFAULT_TZ || 'Europe/Paris',
			forcedDeliveryMode: process.env.FORCE_DELIVERY_MODE === 'channel' ? 'channel' : 'dm',
			voteUrls: [],
			defaultVoteUrlId: null
		};
		saveConfig(initial);
		return initial;
	}
	// readJson throws on unrecoverable corruption instead of returning defaults
	// that would overwrite the configured vote URLs on the next save.
	const cfg = readJson(configPath);
	if (!cfg.timezone) cfg.timezone = process.env.DEFAULT_TZ || 'Europe/Paris';
	if (!cfg.forcedDeliveryMode) {
		cfg.forcedDeliveryMode = process.env.FORCE_DELIVERY_MODE === 'channel' ? 'channel' : 'dm';
	}
	if (!Array.isArray(cfg.voteUrls)) {
		cfg.voteUrls = [];
	} else {
		cfg.voteUrls = cfg.voteUrls.map((entry, index) => {
			const fallbackId = entry.id || `entry-${index + 1}`;
			return {
				id: fallbackId,
				label: entry.label || entry.displayName || `Option ${index + 1}`,
				url: entry.url || cfg.voteBaseUrl || process.env.DEFAULT_VOTE_URL || null,
				cooldownMinutes: typeof entry.cooldownMinutes === 'number' && entry.cooldownMinutes > 0 ? entry.cooldownMinutes : 120,
				channelId: entry.channelId || null
			};
		});
	}
	if (cfg.voteUrls.length === 0) {
		cfg.defaultVoteUrlId = null;
		if (!cfg.voteBaseUrl) {
			cfg.voteBaseUrl = process.env.DEFAULT_VOTE_URL || null;
		}
	} else {
		if (!cfg.defaultVoteUrlId || !cfg.voteUrls.find(v => v.id === cfg.defaultVoteUrlId)) {
			cfg.defaultVoteUrlId = cfg.voteUrls[0].id;
		}
		cfg.voteBaseUrl = cfg.voteUrls.find(v => v.id === cfg.defaultVoteUrlId)?.url || cfg.voteUrls[0].url;
	}
	return cfg;
}

export function saveConfig(cfg) {
	ensureDataDir();
	writeJsonAtomic(configPath, cfg);
}

export function getDataPaths() {
	return { dataDir, configPath };
}

