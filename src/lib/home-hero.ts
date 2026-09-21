import { createAphorismController } from './aphorism';
import {
	isBlonkyEmote,
	playBlonkyEmote,
	setBlonkyPlaybackRate,
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
	let requestSequence = 0;
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
			if (document.hidden || document.documentElement.hasAttribute('data-context-menu-open')) return;
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
	root.addEventListener('context-menu-select', ((event: CustomEvent<{
		group?: string;
		value: string;
	}>) => {
		if (event.detail.group === 'speed') {
			setBlonkyPlaybackRate(HOME_BLONKY_ID, Number(event.detail.value));
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
