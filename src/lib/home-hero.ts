import { createAphorismController } from './aphorism';
import {
	isBlonkyEmote,
	playBlonkyEmote,
	setBlonkyPlaybackRate,
	type BlonkyEmote,
} from './blonky';

const HOME_BLONKY_ID = 'home-blonky';
const POST_WRITE_NOTICE_HOLD_MS = 900;
const ALTERNATE_BLONKY_REACTIONS = [
	'cry',
	'nod-off',
	'skeptical',
	'shrug',
	'shudder',
	'sigh',
	'smh',
] as const;

function pickBlonkyReaction(): BlonkyEmote {
	if (Math.random() < 0.5) return 'confirm';
	const index = Math.floor(Math.random() * ALTERNATE_BLONKY_REACTIONS.length);
	return ALTERNATE_BLONKY_REACTIONS[index];
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

	const cycleAphorism = async (erase: boolean): Promise<void> => {
		const request = ++requestSequence;
		playBlonkyEmote(HOME_BLONKY_ID, 'notice');
		const completed = await aphorism.cycle({ erase });
		if (!completed || request !== requestSequence) return;
		await new Promise<void>((resolve) => window.setTimeout(resolve, POST_WRITE_NOTICE_HOLD_MS));
		if (request !== requestSequence) return;
		playBlonkyEmote(HOME_BLONKY_ID, pickBlonkyReaction());
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
		playBlonkyEmote(HOME_BLONKY_ID, event.detail.value);
	}) as EventListener, { signal: listeners.signal });

	void cycleAphorism(false);

	return () => {
		requestSequence += 1;
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
