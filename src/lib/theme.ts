export type ResolvedTheme = 'light' | 'dark';
export type ThemePreference = 'system' | ResolvedTheme;

export const THEME_STORAGE_KEY = 'crapshack:theme';

export function isThemePreference(value: string | null | undefined): value is ThemePreference {
	return value === 'system' || value === 'light' || value === 'dark';
}
