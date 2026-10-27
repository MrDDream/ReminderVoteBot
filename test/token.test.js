import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken, TOKEN_TTL_MS } from '../src/token.js';

const SECRET = 'x'.repeat(32);
const NOW = Date.UTC(2026, 0, 15);
const payload = { sid: 'sub-1', uid: '123', iat: NOW };

test('a token signed with the secret verifies', () => {
	assert.deepEqual(verifyToken(signToken(payload, SECRET), SECRET, NOW), payload);
});

test('a token signed with another secret is rejected', () => {
	assert.equal(verifyToken(signToken(payload, 'dev-secret'), SECRET, NOW), null);
});

test('a tampered payload is rejected', () => {
	const [, sig] = signToken(payload, SECRET).split('.');
	const forged = Buffer.from(JSON.stringify({ ...payload, uid: '999' })).toString('base64url');
	assert.equal(verifyToken(`${forged}.${sig}`, SECRET, NOW), null);
});

test('malformed tokens are rejected without throwing', () => {
	for (const bad of ['', 'abc', 'abc.def', 'a.b.c', '.', `${'a'.repeat(10)}.`, undefined, ['a', 'b']]) {
		assert.equal(verifyToken(bad, SECRET, NOW), null);
	}
});

test('tokens without a subscription id (old format) are rejected', () => {
	assert.equal(verifyToken(signToken({ uid: '123', iat: NOW }, SECRET), SECRET, NOW), null);
});

test('expired and future tokens are rejected', () => {
	const token = signToken(payload, SECRET);
	assert.ok(verifyToken(token, SECRET, NOW + TOKEN_TTL_MS));
	assert.equal(verifyToken(token, SECRET, NOW + TOKEN_TTL_MS + 1), null);
	assert.equal(verifyToken(token, SECRET, NOW - 2 * 60 * 1000), null);
});
