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
