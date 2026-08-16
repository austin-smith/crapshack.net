import { createAphorismController } from './aphorism';
import { reactBlonky } from './blonky';

const HOME_BLONKY_ID = 'home-blonky';
const POST_WRITE_NOTICE_HOLD_MS = 900;

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

	const requestAnotherAphorism = async (): Promise<void> => {
		const request = ++requestSequence;
		reactBlonky(HOME_BLONKY_ID, 'notice');
		const completed = await aphorism.cycle({ erase: true });
		if (!completed || request !== requestSequence) return;
		await new Promise<void>((resolve) => window.setTimeout(resolve, POST_WRITE_NOTICE_HOLD_MS));
		if (request !== requestSequence) return;
		reactBlonky(HOME_BLONKY_ID, 'confirm');
	};

	aphorismButton.addEventListener('click', () => {
		void requestAnotherAphorism();
	}, { signal: listeners.signal });
	characterButton.addEventListener('click', () => {
		void requestAnotherAphorism();
	}, { signal: listeners.signal });

	void aphorism.cycle();

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
