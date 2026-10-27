// Pure scheduling helpers (no Discord / filesystem access) so they can be unit tested.

const MINUTE_MS = 60 * 1000;
const formatters = new Map();

function getFormatter(timezone) {
	let fmt = formatters.get(timezone);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
		formatters.set(timezone, fmt);
	}
	return fmt;
}

export function isValidTimezone(timezone) {
	try {
		getFormatter(timezone);
		return true;
	} catch {
		return false;
	}
}

// Minutes since local midnight in the given timezone.
export function getTzMinutes(date, timezone) {
	const parts = getFormatter(timezone).formatToParts(date);
	const hh = parseInt(parts.find(p => p.type === 'hour').value, 10);
	const mm = parseInt(parts.find(p => p.type === 'minute').value, 10);
	return hh * 60 + mm;
}

export function timeStringToMinutes(hhmm) {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
	if (!m) return null;
	return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Accepts "8", "8h", "08h30", "8:30", "08:30" and returns "HH:MM", or null.
export function parseTimeInput(input) {
	const m = /^\s*(\d{1,2})\s*(?:[:hH.]\s*(\d{2})?)?\s*$/.exec(input || '');
	if (!m) return null;
	const h = parseInt(m[1], 10);
	const min = m[2] ? parseInt(m[2], 10) : 0;
	if (h > 23 || min > 59) return null;
	return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function withinWindow(date, windowObj, timezone) {
	if (!windowObj) return true;
	const nowMin = getTzMinutes(date, timezone);
	const startMin = timeStringToMinutes(windowObj.start);
	const endMin = timeStringToMinutes(windowObj.end);
	if (startMin === null || endMin === null) return true;
	if (startMin <= endMin) {
		return nowMin >= startMin && nowMin <= endMin;
	}
	// Overnight window (e.g., 22:00-06:00)
	return nowMin >= startMin || nowMin <= endMin;
}

// Earliest time the next reminder may be sent, ignoring the time window.
// 0 means "as soon as possible" (never reminded nor voted).
// A reminder is repeated every cooldown even when it was ignored, until the user votes.
// A snooze requested after the last reminder/vote replaces the cooldown.
export function computeDueAt(sub, cooldownMs) {
	const base = Math.max(sub.lastVotedAt || 0, sub.lastReminderAt || 0);
	if (sub.snoozeUntil && sub.snoozeUntil > base) return sub.snoozeUntil;
	return base ? base + cooldownMs : 0;
}

export function isReminderDue(sub, cooldownMs, now, timezone) {
	if (sub.paused) return false;
	if (now < computeDueAt(sub, cooldownMs)) return false;
	return withinWindow(new Date(now), sub.window, timezone);
}

// Estimated timestamp of the next reminder (for display), taking the window into account.
export function computeNextReminderAt(sub, cooldownMs, now, timezone) {
	if (sub.paused) return null;
	const earliest = Math.max(computeDueAt(sub, cooldownMs), now);
	// Reminders are checked once per minute.
	const t = Math.ceil(earliest / MINUTE_MS) * MINUTE_MS;
	if (withinWindow(new Date(t), sub.window, timezone)) return t;
	const startMin = timeStringToMinutes(sub.window.start);
	const delta = (startMin - getTzMinutes(new Date(t), timezone) + 1440) % 1440;
	const candidate = t + delta * MINUTE_MS;
	// Daylight saving shifts can move the local window start by an hour.
	for (const shift of [0, -60, 60]) {
		const c = candidate + shift * MINUTE_MS;
		if (c >= t && getTzMinutes(new Date(c), timezone) === startMin) return c;
	}
	return candidate;
}
