import { createAphorismController } from './aphorism';
import { setContextMenuRadioValue, type ContextMenuSelectEvent } from './ui/context-menu';
import type { ClaySet } from './blonky/clay/set';
import type { ClayWeather, ClayWeatherKind } from './blonky/clay/weather';
import {
	isBlonkyEmote,
	playBlonkyEmote,
	setBlonkyPlaybackRate,
	setBlonkyRenderer,
	releaseBlonkyEmote,
	type BlonkyEmote,
} from './blonky';

const HOME_BLONKY_ID = 'home-blonky';
// A beat to read, then eyes back to the visitor before the reaction lands.
const READ_BEAT_MS = 650;
const LOOK_BACK_MS = 375;
const IDLE_NAP_MS = 35_000;

// Only these emotes participate in automatic reactions. Each bucket's weight
// is shared equally by its members; selection is independent on every cycle.
const REACTION_BUCKETS: readonly { weight: number; emotes: readonly BlonkyEmote[] }[] = [
	{ weight: 35, emotes: ['confirm'] },
	{ weight: 45, emotes: ['shrug', 'sigh', 'skeptical', 'smh'] },
	{ weight: 20, emotes: ['nod-off', 'deny', 'cry', 'shudder'] },
];
const TOTAL_REACTION_WEIGHT = REACTION_BUCKETS.reduce((total, bucket) => total + bucket.weight, 0);

function pickBlonkyReaction(): BlonkyEmote {
	const roll = Math.random() * TOTAL_REACTION_WEIGHT;
	let cumulativeWeight = 0;
	const bucket = REACTION_BUCKETS.find(({ weight }) => {
		cumulativeWeight += weight;
		return roll < cumulativeWeight;
	}) ?? REACTION_BUCKETS[REACTION_BUCKETS.length - 1];
	return bucket.emotes[Math.floor(Math.random() * bucket.emotes.length)];
}

type BlonkyStyle = 'ink' | 'clay';

let lifecycleRegistered = false;
let mountedRoot: HTMLElement | null = null;
let destroyMountedHero: (() => void) | undefined;

function initHomeHero(root: HTMLElement): (() => void) | undefined {
	const aphorismRoot = root.querySelector<HTMLElement>('[data-aphorism-root]');
	const aphorismButton = aphorismRoot?.querySelector<HTMLButtonElement>('[data-aphorism]');
	const characterButton = root.querySelector<HTMLButtonElement>('[data-home-hero-character]');
	if (!aphorismRoot || !aphorismButton || !characterButton) return;

	const aphorism = createAphorismController(aphorismRoot);
	if (!aphorism) return;

	const listeners = new AbortController();
	const logo = root.querySelector<HTMLImageElement>('.home-hero__logo');
	let setCanvas = root.querySelector<HTMLCanvasElement>('[data-home-hero-set]');
	let set: ClaySet | undefined;
	const weatherCanvas = root.querySelector<HTMLCanvasElement>('[data-home-hero-weather]');
	let weather: ClayWeather | undefined;
	const motion = matchMedia('(prefers-reduced-motion: reduce)');
	// The page's weather setting, in clay; none when motion is reduced, as
	// in ink.
	const weatherKind = (): ClayWeatherKind | undefined => {
		const effect = document.documentElement.getAttribute('data-effect');
		return !motion.matches && (effect === 'rain' || effect === 'snow') ? effect : undefined;
	};
	const syncWeather = (): void => weather?.setKind(weatherKind());
	const weatherWatcher = new MutationObserver(syncWeather);
	weatherWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-effect'] });
	motion.addEventListener('change', syncWeather);
	let style: BlonkyStyle = 'ink';
	// The style asked for most recently. One change runs at a time, and it
	// keeps going until what's shown is what was asked for last.
	let requestedStyle: BlonkyStyle = 'ink';
	let changingStyle = false;
	let requestSequence = 0;

	/** Takes the clay set down, leaving a fresh canvas for the next one. */
	const strikeSet = (): void => {
		set?.destroy();
		set = undefined;
		weather?.destroy();
		weather = undefined;
		if (weatherCanvas) weatherCanvas.hidden = true;
		if (!setCanvas) return;
		setCanvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
		const fresh = setCanvas.cloneNode(false) as HTMLCanvasElement;
		fresh.hidden = true;
		setCanvas.replaceWith(fresh);
		setCanvas = fresh;
	};

	/**
	 * Show the page in ink or clay: Blonky, and in clay the set around him.
	 * The clay code is only loaded once it's asked for. Resolves to the style
	 * shown: ink, if clay can't run here.
	 */
	const setStyle = async (next: BlonkyStyle): Promise<BlonkyStyle> => {
		if (next === 'ink') {
			if (!setBlonkyRenderer(HOME_BLONKY_ID)) return 'clay';
			strikeSet();
			delete root.dataset.homeHeroStyle;
			return 'ink';
		}
		const [{ createClayRenderer }, { createClaySet }, { createClayWeather }] = await Promise.all([
			import('./blonky/clay/renderer'),
			import('./blonky/clay/set'),
			import('./blonky/clay/weather'),
		]);
		// Asked for ink while clay loaded, or the page has gone: leave it be.
		if (requestedStyle !== 'clay' || listeners.signal.aborted) return style;
		// The set stands in for the page's logo and aphorism, so the page only
		// turns to clay once the set is up; otherwise it stays in ink.
		if (!setCanvas || !logo) return 'ink';
		setCanvas.hidden = false;
		set = createClaySet(setCanvas, {
			logo,
			aphorism: aphorismButton,
			figure: () => root.querySelector<HTMLCanvasElement>('[data-blonky-canvas]'),
		});
		if (!set) {
			strikeSet();
			return 'ink';
		}
		const painted = setBlonkyRenderer(HOME_BLONKY_ID, (canvas) => createClayRenderer(canvas, {
			transparent: true,
			onExpose: (frame, outline) => {
				set?.expose(frame, outline);
				weather?.expose(frame);
			},
		}));
		if (!painted) {
			strikeSet();
			return 'ink';
		}
		root.dataset.homeHeroStyle = 'clay';
		// The page's own weather gives way only to clay weather that's running.
		weather = weatherCanvas ? createClayWeather(weatherCanvas) : undefined;
		if (weather && weatherCanvas) {
			weatherCanvas.hidden = false;
			syncWeather();
		}
		return 'clay';
	};
	const requestStyle = async (next: BlonkyStyle): Promise<void> => {
		requestedStyle = next;
		if (changingStyle) return;
		changingStyle = true;
		while (style !== requestedStyle && !listeners.signal.aborted) {
			const wanted = requestedStyle;
			style = await setStyle(wanted);
			// Clay can't run here: settle for what's shown.
			if (style !== wanted && requestedStyle === wanted) requestedStyle = style;
		}
		changingStyle = false;
		setContextMenuRadioValue(root, 'style', style);
	};
	let napTimer: number | undefined;
	let cancelBeat: (() => void) | undefined;

	const stopWaiting = (): void => {
		window.clearTimeout(napTimer);
		cancelBeat?.();
		cancelBeat = undefined;
	};
	const waitBeat = (milliseconds: number): Promise<boolean> => new Promise((resolve) => {
		const timer = window.setTimeout(() => {
			cancelBeat = undefined;
			resolve(true);
		}, milliseconds);
		cancelBeat = () => {
			window.clearTimeout(timer);
			resolve(false);
		};
	});
	const scheduleNap = (): void => {
		window.clearTimeout(napTimer);
		if (document.hidden) return;
		napTimer = window.setTimeout(() => {
			if (document.hidden) return;
			if (document.documentElement.hasAttribute('data-context-menu-open')) {
				scheduleNap();
				return;
			}
			playBlonkyEmote(HOME_BLONKY_ID, 'nod-off');
		}, IDLE_NAP_MS);
	};
	const cycleAphorism = async (erase: boolean): Promise<void> => {
		const request = ++requestSequence;
		stopWaiting();
		playBlonkyEmote(HOME_BLONKY_ID, 'notice');
		const completed = await aphorism.cycle({ erase });
		if (!completed || request !== requestSequence) return;
		if (!await waitBeat(READ_BEAT_MS) || request !== requestSequence) return;
		releaseBlonkyEmote(HOME_BLONKY_ID);
		if (!await waitBeat(LOOK_BACK_MS) || request !== requestSequence) return;
		playBlonkyEmote(HOME_BLONKY_ID, pickBlonkyReaction());
		scheduleNap();
	};

	aphorismButton.addEventListener('click', () => {
		void cycleAphorism(true);
	}, { signal: listeners.signal });
	characterButton.addEventListener('click', () => {
		void cycleAphorism(true);
	}, { signal: listeners.signal });
	root.addEventListener('context-menu-select', ((event: ContextMenuSelectEvent) => {
		if (event.detail.group === 'speed') {
			setBlonkyPlaybackRate(HOME_BLONKY_ID, Number(event.detail.value));
			return;
		}
		if (event.detail.group === 'style') {
			void requestStyle(event.detail.value === 'clay' ? 'clay' : 'ink');
			return;
		}
		if (!isBlonkyEmote(event.detail.value)) return;
		requestSequence += 1;
		stopWaiting();
		playBlonkyEmote(HOME_BLONKY_ID, event.detail.value);
		scheduleNap();
	}) as EventListener, { signal: listeners.signal });

	document.addEventListener('visibilitychange', scheduleNap, { signal: listeners.signal });

	void cycleAphorism(false);

	return () => {
		requestSequence += 1;
		stopWaiting();
		listeners.abort();
		weatherWatcher.disconnect();
		motion.removeEventListener('change', syncWeather);
		strikeSet();
		aphorism.destroy();
	};
}

const unmountHomeHero = (): void => {
	destroyMountedHero?.();
	destroyMountedHero = undefined;
	mountedRoot = null;
};

const mountHomeHero = (): void => {
	const root = document.querySelector<HTMLElement>('[data-home-hero-root]');
	if (!root || root === mountedRoot) return;
	unmountHomeHero();
	const cleanup = initHomeHero(root);
	if (!cleanup) return;
	mountedRoot = root;
	destroyMountedHero = cleanup;
};

export function registerHomeHeroLifecycle(): void {
	mountHomeHero();
	if (lifecycleRegistered) return;
	lifecycleRegistered = true;
	document.addEventListener('astro:page-load', mountHomeHero);
	document.addEventListener('astro:before-swap', unmountHomeHero);
}
