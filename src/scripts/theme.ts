// Theme controller for the sidebar toggle.
//
// The theme is already resolved and applied by the blocking script in Layout.astro
// before first paint; this module only owns *changes* — the toggle UI, cross-tab
// sync, and reacting to the OS preference while "system" is selected.

import {
	isThemePreference,
	THEME_STORAGE_KEY,
	type ResolvedTheme,
	type ThemePreference,
} from '../lib/theme';

class ThemeController {
	private current: ThemePreference = 'system';
	private readonly systemDark = window.matchMedia('(prefers-color-scheme: dark)');

	constructor() {
		this.current = this.readPreference();
		this.applyStateToDom();
		this.attachToggleHandlers();

		// Track the OS preference so "system" stays live without a reload.
		this.systemDark.addEventListener('change', () => {
			if (this.current === 'system') this.applyTheme();
		});

		// Keep other open tabs in sync.
		window.addEventListener('storage', (e) => {
			if (e.key !== THEME_STORAGE_KEY) return;
			const next = isThemePreference(e.newValue) ? e.newValue : 'system';
			if (next === this.current) return;
			this.current = next;
			this.applyTheme();
			this.applyStateToDom();
		});
	}

	private readPreference(): ThemePreference {
		// Prefer the value the blocking script already resolved, so a storage read
		// that threw there doesn't get retried (and throw again) here.
		const applied = document.documentElement.dataset.themePreference;
		if (isThemePreference(applied)) return applied;
		try {
			const stored = localStorage.getItem(THEME_STORAGE_KEY);
			if (isThemePreference(stored)) return stored;
		} catch {
			// Storage unavailable (private mode, blocked cookies) — fall back to system.
		}
		return 'system';
	}

	private writePreference(value: ThemePreference) {
		try {
			localStorage.setItem(THEME_STORAGE_KEY, value);
		} catch {
			// Preference simply won't persist across loads; the session still works.
		}
	}

	private resolve(): ResolvedTheme {
		if (this.current === 'system') return this.systemDark.matches ? 'dark' : 'light';
		return this.current;
	}

	private applyTheme() {
		const root = document.documentElement;
		const resolved = this.resolve();
		this.applyThemeColor(resolved);
		if (root.dataset.theme === resolved) {
			root.dataset.themePreference = this.current;
			return;
		}

		// Repainting every surface at once looks better as a hard cut than as a
		// smear of independently-timed transitions. Suppress them for one frame.
		root.setAttribute('data-theme-switching', '');
		root.dataset.theme = resolved;
		root.dataset.themePreference = this.current;

		// Force a style flush so the suppressed state is actually applied before
		// it is removed, otherwise both mutations collapse into one frame.
		window.getComputedStyle(root).getPropertyValue('opacity');
		root.removeAttribute('data-theme-switching');
	}

	private applyThemeColor(resolved: ResolvedTheme) {
		const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][data-theme-color]');
		for (const meta of metas) {
			meta.media = meta.dataset.themeColor === resolved ? 'all' : 'not all';
		}
	}

	private applyStateToDom() {
		const options = Array.from(document.querySelectorAll('[data-theme-option]'));
		for (const option of options) {
			const name = option.getAttribute('data-theme-option');
			if (!name) continue;
			const checked = name === this.current;
			option.setAttribute('aria-checked', String(checked));
			if (checked) option.setAttribute('data-checked', '');
			else option.removeAttribute('data-checked');
			option.setAttribute('tabindex', checked ? '0' : '-1');
		}
	}

	private select(value: ThemePreference) {
		if (value === this.current) return;
		this.current = value;
		this.writePreference(value);
		this.applyTheme();
		this.applyStateToDom();
	}

	private attachToggleHandlers() {
		document.addEventListener('click', (e) => {
			const target = e.target as HTMLElement | null;
			const option = target?.closest('[data-theme-option]');
			if (!(option instanceof HTMLElement)) return;
			const value = option.getAttribute('data-theme-option');
			if (!isThemePreference(value)) return;
			e.preventDefault();
			this.select(value);
		});

		// Roving-tabindex keyboard support, matching the weather radiogroup.
		document.addEventListener('keydown', (e) => {
			const target = e.target as HTMLElement | null;
			const radio = target?.closest('[data-theme-option]');
			const group = target?.closest('[role="radiogroup"]');
			if (!(radio instanceof HTMLElement) || !(group instanceof HTMLElement)) return;

			const options = Array.from(group.querySelectorAll<HTMLElement>('[data-theme-option]'));
			const index = options.indexOf(radio);
			if (index === -1) return;

			let destination: HTMLElement | undefined;
			if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
				destination = options[(index - 1 + options.length) % options.length];
			} else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
				destination = options[(index + 1) % options.length];
			} else if (e.key === 'Home') {
				destination = options[0];
			} else if (e.key === 'End') {
				destination = options[options.length - 1];
			}

			if (destination) {
				const value = destination.getAttribute('data-theme-option');
				if (!isThemePreference(value)) return;
				e.preventDefault();
				this.select(value);
				destination.focus();
			} else if (e.key === ' ' || e.key === 'Enter') {
				const value = radio.getAttribute('data-theme-option');
				if (!isThemePreference(value)) return;
				e.preventDefault();
				this.select(value);
			}
		});
	}
}

function init() {
	new ThemeController();
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
	init();
}

export {};
