import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidVoteUrl, isValidPublicBaseUrl, generateVoteUrlId, buildVoteUrl, MAX_VOTE_URL_LENGTH } from '../src/voteUrl.js';

test('vote URLs must be https and short enough for a Discord link button', () => {
	assert.equal(isValidVoteUrl('https://site.example/vote/{pseudo}'), true);
	assert.equal(isValidVoteUrl('https://site.example/vote?u={pseudo}&x=1'), true);
	assert.equal(isValidVoteUrl('http://site.example/vote'), false);
	assert.equal(isValidVoteUrl('javascript:alert(1)'), false);
	assert.equal(isValidVoteUrl('site.example/vote'), false);
	assert.equal(isValidVoteUrl(`https://site.example/${'a'.repeat(MAX_VOTE_URL_LENGTH)}`), false);
});

test('public base URL must be an absolute http(s) URL', () => {
	assert.equal(isValidPublicBaseUrl('https://vote.example.com'), true);
	assert.equal(isValidPublicBaseUrl('vote.example.com'), false);
	assert.equal(isValidPublicBaseUrl('ftp://vote.example.com'), false);
});

test('generated ids are slugs that stay short and unique', () => {
	assert.equal(generateVoteUrlId('Serveur A !', new Set()), 'serveur-a');
	assert.equal(generateVoteUrlId('Serveur A', new Set(['serveur-a', 'serveur-a-2'])), 'serveur-a-3');
	assert.equal(generateVoteUrlId('Été 2026', new Set()), 'ete-2026');
	assert.equal(generateVoteUrlId('!!!', new Set()), 'vote');
	const long = 'a'.repeat(100);
	const first = generateVoteUrlId(long, new Set());
	const second = generateVoteUrlId(long, new Set([first]));
	assert.ok(first.length <= 60 && second.length <= 64);
});

test('buildVoteUrl fills {pseudo} or appends ?pseudo=', () => {
	assert.equal(buildVoteUrl('https://s.example/vote/{pseudo}', 'Jean Dupont'), 'https://s.example/vote/Jean%20Dupont');
	assert.equal(buildVoteUrl('https://s.example/vote?x=1', 'Jean&Co'), 'https://s.example/vote?x=1&pseudo=Jean%26Co');
	assert.equal(buildVoteUrl(null, 'x'), null);
});
