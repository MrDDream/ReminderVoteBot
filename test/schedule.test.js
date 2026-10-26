import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withinWindow, isReminderDue, computeNextReminderAt, parseTimeInput } from '../src/schedule.js';

const TZ = 'Europe/Paris';
const H = 60 * 60 * 1000;
const COOLDOWN = 2 * H;
// 2026-01-15 is in winter: Paris = UTC+1
const paris = (hhmm, day = 15) => {
	const [h, m] = hhmm.split(':').map(Number);
	return Date.UTC(2026, 0, day, h - 1, m);
};

test('parseTimeInput accepts common formats', () => {
	assert.equal(parseTimeInput('8'), '08:00');
	assert.equal(parseTimeInput('8h'), '08:00');
	assert.equal(parseTimeInput('08h30'), '08:30');
	assert.equal(parseTimeInput(' 21:05 '), '21:05');
	assert.equal(parseTimeInput('24:00'), null);
	assert.equal(parseTimeInput('8:7'), null);
	assert.equal(parseTimeInput('abc'), null);
});

test('withinWindow handles normal, overnight and all-day windows', () => {
	const day = { start: '08:00', end: '20:00' };
	assert.equal(withinWindow(new Date(paris('07:59')), day, TZ), false);
	assert.equal(withinWindow(new Date(paris('08:00')), day, TZ), true);
	assert.equal(withinWindow(new Date(paris('20:00')), day, TZ), true);
	assert.equal(withinWindow(new Date(paris('20:01')), day, TZ), false);
	const night = { start: '22:00', end: '06:00' };
	assert.equal(withinWindow(new Date(paris('23:30')), night, TZ), true);
	assert.equal(withinWindow(new Date(paris('01:00')), night, TZ), true);
	assert.equal(withinWindow(new Date(paris('12:00')), night, TZ), false);
	assert.equal(withinWindow(new Date(paris('12:00')), null, TZ), true);
});

test('new subscription inside the window is due right away (not only at the window start minute)', () => {
	const sub = { window: { start: '08:00', end: '20:00' }, lastVotedAt: null, lastReminderAt: null };
	assert.equal(isReminderDue(sub, COOLDOWN, paris('10:17'), TZ), true);
	assert.equal(isReminderDue(sub, COOLDOWN, paris('21:00'), TZ), false);
	assert.equal(computeNextReminderAt(sub, COOLDOWN, paris('21:00'), TZ), paris('08:00', 16));
});

test('a missed window start (bot restarted at 08:01) still sends the reminder', () => {
	const sub = { window: { start: '08:00', end: '20:00' }, lastVotedAt: null, lastReminderAt: paris('19:00', 14) };
	assert.equal(isReminderDue(sub, COOLDOWN, paris('08:01'), TZ), true);
});

test('an ignored reminder is repeated after the cooldown', () => {
	const sub = { window: { start: '08:00', end: '20:00' }, lastVotedAt: null, lastReminderAt: paris('08:00') };
	assert.equal(isReminderDue(sub, COOLDOWN, paris('09:59'), TZ), false);
	assert.equal(isReminderDue(sub, COOLDOWN, paris('10:00'), TZ), true);
});

test('a vote restarts the cooldown', () => {
	const sub = { window: null, lastVotedAt: paris('11:00'), lastReminderAt: paris('10:00') };
	assert.equal(isReminderDue(sub, COOLDOWN, paris('12:30'), TZ), false);
	assert.equal(isReminderDue(sub, COOLDOWN, paris('13:00'), TZ), true);
	assert.equal(computeNextReminderAt(sub, COOLDOWN, paris('12:30'), TZ), paris('13:00'));
});

test('overnight window: a vote at 23:00 is reminded after midnight', () => {
	const sub = { window: { start: '22:00', end: '06:00' }, lastVotedAt: paris('23:00'), lastReminderAt: paris('22:00') };
	assert.equal(isReminderDue(sub, COOLDOWN, paris('01:00', 16), TZ), true);
});

test('cooldown ending outside the window waits for the next window start', () => {
	const sub = { window: { start: '08:00', end: '20:00' }, lastVotedAt: paris('19:30'), lastReminderAt: null };
	assert.equal(isReminderDue(sub, COOLDOWN, paris('21:30'), TZ), false);
	assert.equal(computeNextReminderAt(sub, COOLDOWN, paris('19:45'), TZ), paris('08:00', 16));
	assert.equal(isReminderDue(sub, COOLDOWN, paris('08:00', 16), TZ), true);
});

test('snooze brings the next reminder forward and expires after a new reminder', () => {
	const sub = { window: null, lastVotedAt: null, lastReminderAt: paris('10:00'), snoozeUntil: paris('10:35') };
	assert.equal(isReminderDue(sub, COOLDOWN, paris('10:34'), TZ), false);
	assert.equal(isReminderDue(sub, COOLDOWN, paris('10:35'), TZ), true);
	const after = { ...sub, lastReminderAt: paris('10:35') };
	assert.equal(isReminderDue(after, COOLDOWN, paris('11:00'), TZ), false);
});

test('paused subscriptions are never due', () => {
	const sub = { window: null, lastVotedAt: null, lastReminderAt: null, paused: true };
	assert.equal(isReminderDue(sub, COOLDOWN, paris('12:00'), TZ), false);
	assert.equal(computeNextReminderAt(sub, COOLDOWN, paris('12:00'), TZ), null);
});

test('next window start is correct across a DST change', () => {
	// Paris switches to summer time on 2026-03-29 at 02:00.
	const sub = { window: { start: '08:00', end: '20:00' }, lastVotedAt: Date.UTC(2026, 2, 28, 20, 0), lastReminderAt: null };
	const next = computeNextReminderAt(sub, COOLDOWN, Date.UTC(2026, 2, 28, 20, 0), TZ);
	assert.equal(next, Date.UTC(2026, 2, 29, 6, 0)); // 08:00 UTC+2
});
