// Vote URL helpers (validation, ids, per-user URL), kept free of Discord state for testing.

// Discord rejects link buttons over 512 characters; keep room for the expanded {pseudo}.
export const MAX_VOTE_URL_LENGTH = 400;
// Ids are used in select menu values and custom ids (max 100 characters with their prefix).
const MAX_VOTE_ID_LENGTH = 60;

export function isValidVoteUrl(urlStr) {
	if (typeof urlStr !== 'string' || urlStr.length > MAX_VOTE_URL_LENGTH) return false;
	try {
		return new URL(urlStr.split('{pseudo}').join('pseudo')).protocol === 'https:';
	} catch {
		return false;
	}
}

// Public base URL of the /v redirect: must be an absolute http(s) URL.
export function isValidPublicBaseUrl(urlStr) {
	try {
		const url = new URL(urlStr);
		return url.protocol === 'https:' || url.protocol === 'http:';
	} catch {
		return false;
	}
}

export function generateVoteUrlId(label, existingIds) {
	const base = label
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, MAX_VOTE_ID_LENGTH)
		.replace(/^-+|-+$/g, '') || 'vote';
	if (!existingIds.has(base)) return base;
	let counter = 2;
	while (existingIds.has(`${base}-${counter}`)) counter += 1;
	return `${base}-${counter}`;
}

// "{pseudo}" placeholder anywhere in the URL (path or query); otherwise append ?pseudo=.
export function buildVoteUrl(baseUrl, username) {
	if (!baseUrl) return null;
	if (baseUrl.includes('{pseudo}')) {
		return baseUrl.split('{pseudo}').join(encodeURIComponent(username));
	}
	const url = new URL(baseUrl);
	url.searchParams.set('pseudo', username);
	return url.toString();
}
