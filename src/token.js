// Signed tokens for the /v vote redirect: base64url(JSON payload) + "." + HMAC-SHA256.
import crypto from 'crypto';

export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Tolerated clock skew for tokens issued "in the future".
const MAX_CLOCK_SKEW_MS = 60 * 1000;

function hmac(data, secret) {
	return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function signToken(payload, secret) {
	const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${data}.${hmac(data, secret)}`;
}

// Returns { sid, uid, iat } for a valid, unexpired token, or null.
export function verifyToken(tokenStr, secret, now = Date.now(), ttlMs = TOKEN_TTL_MS) {
	if (typeof tokenStr !== 'string') return null;
	const parts = tokenStr.split('.');
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
	const [data, sig] = parts;
	const given = Buffer.from(sig);
	const expected = Buffer.from(hmac(data, secret));
	// timingSafeEqual throws on different lengths.
	if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
	let payload;
	try {
		payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
	} catch {
		return null;
	}
	if (!payload || typeof payload.sid !== 'string' || typeof payload.uid !== 'string' || typeof payload.iat !== 'number') {
		return null;
	}
	if (payload.iat > now + MAX_CLOCK_SKEW_MS || now - payload.iat > ttlMs) return null;
	return payload;
}
