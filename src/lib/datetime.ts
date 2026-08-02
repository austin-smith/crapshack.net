/** Shared date/time formatting helpers. */

const SHORT_DATETIME: Intl.DateTimeFormatOptions = {
	month: 'short',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit',
	hour12: true,
	timeZoneName: 'short',
};

/**
 * Formats a date like "Aug 2, 1:03 PM PDT" in the runtime's local timezone,
 * or pinned to UTC ("Aug 2, 8:03 PM UTC") when rendering timezone-agnostic
 * fallbacks at build time.
 */
export function formatShortDateTime(date: Date | string, options?: { utc?: boolean }): string {
	const value = typeof date === 'string' ? new Date(date) : date;
	return value.toLocaleString('en-US', {
		...SHORT_DATETIME,
		...(options?.utc ? { timeZone: 'UTC' } : {}),
	});
}

const RELATIVE_DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
	{ amount: 60, unit: 'second' },
	{ amount: 60, unit: 'minute' },
	{ amount: 24, unit: 'hour' },
	{ amount: 7, unit: 'day' },
	{ amount: 4.34524, unit: 'week' },
	{ amount: 12, unit: 'month' },
	{ amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

/** Formats a date relative to now, like "23 min. ago" or "in 2 hr.". */
export function formatRelativeTime(date: Date | string, now: Date = new Date()): string {
	const value = typeof date === 'string' ? new Date(date) : date;
	const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'always', style: 'short' });
	let delta = (value.getTime() - now.getTime()) / 1000;
	for (const { amount, unit } of RELATIVE_DIVISIONS) {
		if (Math.abs(delta) < amount) return formatter.format(Math.round(delta), unit);
		delta /= amount;
	}
	return formatter.format(Math.round(delta), 'year');
}
