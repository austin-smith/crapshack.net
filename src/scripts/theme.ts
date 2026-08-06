// Layout.astro's blocking script resolves and applies the theme before first
// paint. This module owns only *changes*: the toggle UI, cross-tab sync, and the
// OS preference flipping while "system" is selected.

import { registerShortcut } from '../lib/ui/shortcuts';
import {
	DEFAULT_THEME_PREFERENCE,
	isThemePreference,
	resolveTheme,
	THEME_STORAGE_KEY,
	TRUE_BLACK_STORAGE_KEY,
	type ThemePreference,
} from '../lib/theme';

class ThemeController {
	private preference: ThemePreference = DEFAULT_THEME_PREFERENCE;
	private trueBlack = false;
	private readonly systemDark = window.matchMedia('(prefers-color-scheme: dark)');

	constructor() {
		this.preference = this.readPreference();
		this.trueBlack = this.readTrueBlack();
		this.applyStateToDom();
		this.attachHandlers();

		// Track the OS preference so "system" stays live without a reload.
		this.systemDark.addEventListener('change', () => {
			if (this.preference === 'system') this.applyTheme();
		});

		// Keep other open tabs in sync.
		window.addEventListener('storage', (e) => {
			if (e.key === THEME_STORAGE_KEY) {
				const next = isThemePreference(e.newValue) ? e.newValue : DEFAULT_THEME_PREFERENCE;
				if (next === this.preference) return;
				this.preference = next;
			} else if (e.key === TRUE_BLACK_STORAGE_KEY) {
				const next = e.newValue === '1';
				if (next === this.trueBlack) return;
				this.trueBlack = next;
			} else {
				return;
			}
			this.applyTheme();
			this.applyStateToDom();
		});
	}

	private readPreference(): ThemePreference {
		// Prefer what the blocking script resolved, so a throwing storage read isn't retried.
		const applied = document.documentElement.dataset.themePreference;
		if (isThemePreference(applied)) return applied;
		try {
			const stored = localStorage.getItem(THEME_STORAGE_KEY);
			if (isThemePreference(stored)) return stored;
		} catch {
			// Storage unavailable (private mode, blocked cookies) — fall back to the default.
		}
		return DEFAULT_THEME_PREFERENCE;
	}

	private readTrueBlack(): boolean {
		const applied = document.documentElement.dataset.trueBlack;
		if (applied === '1' || applied === '0') return applied === '1';
		try {
			return localStorage.getItem(TRUE_BLACK_STORAGE_KEY) === '1';
		} catch {
			return false;
		}
	}

	private write(key: string, value: string) {
		try {
			localStorage.setItem(key, value);
		} catch {
			// Won't persist across loads; the session still works.
		}
	}

	private applyTheme() {
		const root = document.documentElement;
		const resolved = resolveTheme(this.preference, this.systemDark.matches, this.trueBlack);
		root.dataset.themePreference = this.preference;
		root.dataset.trueBlack = this.trueBlack ? '1' : '0';
		this.applyThemeColor(resolved);
		if (root.dataset.theme === resolved) return;

		// A hard cut beats a smear of independently-timed transitions.
		root.setAttribute('data-theme-switching', '');
		root.dataset.theme = resolved;

		// Flush, or both mutations collapse into one frame and nothing is suppressed.
		window.getComputedStyle(root).getPropertyValue('opacity');
		root.removeAttribute('data-theme-switching');
	}

	private applyThemeColor(resolved: string) {
		const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][data-theme-color]');
		for (const meta of metas) {
			meta.media = meta.dataset.themeColor === resolved ? 'all' : 'not all';
		}
	}

	private applyStateToDom() {
		for (const option of document.querySelectorAll('[data-theme-option]')) {
			const name = option.getAttribute('data-theme-option');
			if (!name) continue;
			const checked = name === this.preference;
			option.setAttribute('aria-checked', String(checked));
			if (checked) option.setAttribute('data-checked', '');
			else option.removeAttribute('data-checked');
			option.setAttribute('tabindex', checked ? '0' : '-1');
		}
		// Focus follows selection while it is inside the group, or the old option keeps
		// its focus ring next to the new one's selected ring and both look chosen.
		if (document.activeElement instanceof HTMLElement && document.activeElement.matches('[data-theme-option]')) {
			document.querySelector<HTMLElement>('[data-theme-option][data-checked]')?.focus();
		}

		document.querySelector('[data-true-black-toggle]')?.setAttribute('aria-checked', String(this.trueBlack));

		// Keep the swatches honest about what picking them gives.
		const darkPreview = this.trueBlack ? 'black' : 'dark';
		document.querySelector('[data-theme-preview="dark"]')?.setAttribute('data-theme', darkPreview);
		document
			.querySelector('[data-theme-preview="system"] .theme-preview-layer')
			?.setAttribute('data-theme', darkPreview);
	}

	private selectPreference(value: ThemePreference) {
		if (value === this.preference) return;
		this.preference = value;
		this.write(THEME_STORAGE_KEY, value);
		this.applyTheme();
		this.applyStateToDom();
	}

	private setTrueBlack(value: boolean) {
		if (value === this.trueBlack) return;
		this.trueBlack = value;
		this.write(TRUE_BLACK_STORAGE_KEY, value ? '1' : '0');
		this.applyTheme();
		this.applyStateToDom();
	}

	private attachHandlers() {
		// Keyed off what is rendered, not the stored preference, so it still flips
		// visibly when the preference is `system`.
		registerShortcut({
			key: 'd',
			run: () => {
				const dark = resolveTheme(this.preference, this.systemDark.matches, this.trueBlack) !== 'light';
				this.selectPreference(dark ? 'light' : 'dark');
			},
		});

		document.addEventListener('click', (e) => {
			const target = e.target as HTMLElement | null;

			const swtch = target?.closest('[data-true-black-toggle]');
			if (swtch instanceof HTMLElement) {
				e.preventDefault();
				this.setTrueBlack(swtch.getAttribute('aria-checked') !== 'true');
				return;
			}

			const option = target?.closest('[data-theme-option]');
			if (!(option instanceof HTMLElement)) return;
			const value = option.getAttribute('data-theme-option');
			if (!isThemePreference(value)) return;
			e.preventDefault();
			this.selectPreference(value);
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
				this.selectPreference(value);
				destination.focus();
			} else if (e.key === ' ' || e.key === 'Enter') {
				const value = radio.getAttribute('data-theme-option');
				if (!isThemePreference(value)) return;
				e.preventDefault();
				this.selectPreference(value);
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
