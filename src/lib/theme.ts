/** True black is stored separately so it can apply to any resolved dark, `system` included. */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark' | 'black';

export const THEME_STORAGE_KEY = 'crapshack:theme';
export const TRUE_BLACK_STORAGE_KEY = 'crapshack:true-black';

/** Layout.astro's blocking script gets this via define:vars, so it cannot drift. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export function isThemePreference(value: string | null | undefined): value is ThemePreference {
	return THEME_PREFERENCES.includes(value as ThemePreference);
}

export function resolveTheme(
	preference: ThemePreference,
	systemPrefersDark: boolean,
	trueBlack: boolean,
): ResolvedTheme {
	const base = preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
	return base === 'dark' && trueBlack ? 'black' : base;
}
