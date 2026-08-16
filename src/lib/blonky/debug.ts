import { createBlonkyAnimator } from './animator';
import {
	BLONKY_EMOTES,
	isBlonkyEmote,
	type BlonkyEmoteInfo,
} from './emotes';
import { BLONKY_FPS } from './types';

const isEditableTarget = (target: EventTarget | null): boolean => (
	target instanceof HTMLElement
	&& (target.isContentEditable || target.matches('button, input, select, textarea'))
);

let lifecycleRegistered = false;
let mountedRoot: HTMLElement | null = null;
let destroyMountedPage: (() => void) | undefined;

function initBlonkyPage(root: HTMLElement): (() => void) | undefined {
	const canvas = root.querySelector<HTMLCanvasElement>('[data-blonky-page-canvas]');
	const playbackButton = root.querySelector<HTMLButtonElement>('[data-blonky-playback]');
	const playIcon = root.querySelector<HTMLElement>('[data-blonky-playback-icon="play"]');
	const pauseIcon = root.querySelector<HTMLElement>('[data-blonky-playback-icon="pause"]');
	const resetButton = root.querySelector<HTMLButtonElement>('[data-blonky-reset]');
	const headVisibilityButton = root.querySelector<HTMLButtonElement>('[data-blonky-head-visibility]');
	const bodyVisibilityButton = root.querySelector<HTMLButtonElement>('[data-blonky-body-visibility]');
	const speedDropdown = root.querySelector<HTMLElement>('#blonky-speed');
	const stateOutput = root.querySelector<HTMLOutputElement>('[data-blonky-state]');
	const timeOutput = root.querySelector<HTMLOutputElement>('[data-blonky-time]');
	const frameOutput = root.querySelector<HTMLOutputElement>('[data-blonky-frame]');
	const status = root.querySelector<HTMLElement>('[data-blonky-page-status]');
	if (
		!canvas
		|| !playbackButton
		|| !playIcon
		|| !pauseIcon
		|| !resetButton
		|| !headVisibilityButton
		|| !bodyVisibilityButton
		|| !speedDropdown
		|| !stateOutput
		|| !timeOutput
		|| !frameOutput
		|| !status
	) return;

	const emoteRows = [...root.querySelectorAll<HTMLButtonElement>('[data-blonky-emote]')];
	const filterInput = root.querySelector<HTMLInputElement>('[data-blonky-filter]');
	const listeners = new AbortController();

	let activeRow: HTMLButtonElement | null = null;
	let activeUntil = 0;
	const clearActiveRow = (): void => {
		activeRow?.removeAttribute('data-active');
		activeRow?.setAttribute('aria-pressed', 'false');
		activeRow = null;
	};

	const syncFrame = (time: number): void => {
		timeOutput.value = `${time.toFixed(3)} s`;
		frameOutput.value = String(Math.floor(time * BLONKY_FPS)).padStart(4, '0');
		if (activeRow && time >= activeUntil) clearActiveRow();
	};
	const syncPlayback = (playing: boolean): void => {
		playIcon.hidden = playing;
		pauseIcon.hidden = !playing;
		playbackButton.setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
		playbackButton.setAttribute('aria-pressed', String(playing));
		stateOutput.value = playing ? 'playing' : 'paused';
		status.textContent = playing ? 'Blonky animation playing' : 'Blonky animation paused';
	};

	const animator = createBlonkyAnimator(canvas, {
		autoPauseOffscreen: false,
		onFrame: syncFrame,
		onPlaybackChange: syncPlayback,
		view: 'debug',
	});
	if (!animator) return;

	const togglePlayback = (): void => {
		if (animator.isPlaying()) animator.pause();
		else animator.play();
	};
	const reset = (): void => {
		animator.pause();
		animator.reset();
		clearActiveRow();
	};
	const step = (frames: number): void => {
		// Seeking drops any in-flight emote, so the highlight goes with it.
		animator.step(frames);
		clearActiveRow();
	};
	const fireEmote = (row: HTMLButtonElement): void => {
		const emote = row.dataset.blonkyEmote;
		if (!isBlonkyEmote(emote)) return;
		if (activeRow === row) {
			animator.releaseEmote();
			animator.play();
			clearActiveRow();
			return;
		}
		animator.playEmote(emote);
		animator.play();
		clearActiveRow();
		activeRow = row;
		row.setAttribute('data-active', '');
		row.setAttribute('aria-pressed', 'true');
		const emoteInfo: BlonkyEmoteInfo = BLONKY_EMOTES[emote];
		activeUntil = emoteInfo.holds
			? Number.POSITIVE_INFINITY
			: animator.getTime() + emoteInfo.duration;
	};

	playbackButton.addEventListener('click', togglePlayback, { signal: listeners.signal });
	resetButton.addEventListener('click', reset, { signal: listeners.signal });
	headVisibilityButton.addEventListener('click', () => {
		const visible = !animator.isHeadVisible();
		animator.setHeadVisible(visible);
		headVisibilityButton.toggleAttribute('data-active', visible);
		headVisibilityButton.setAttribute('aria-pressed', String(visible));
		status.textContent = `Blonky head ${visible ? 'shown' : 'hidden'}`;
	}, { signal: listeners.signal });
	bodyVisibilityButton.addEventListener('click', () => {
		const visible = !animator.isBodyVisible();
		animator.setBodyVisible(visible);
		bodyVisibilityButton.toggleAttribute('data-active', visible);
		bodyVisibilityButton.setAttribute('aria-pressed', String(visible));
		status.textContent = `Blonky body ${visible ? 'shown' : 'hidden'}`;
	}, { signal: listeners.signal });
	speedDropdown.addEventListener('dropdown-change', ((event: CustomEvent<{ value: string }>) => {
		animator.setPlaybackRate(Number(event.detail.value));
	}) as EventListener, { signal: listeners.signal });

	for (const button of root.querySelectorAll<HTMLButtonElement>('[data-blonky-step]')) {
		button.addEventListener('click', () => {
			step(Number(button.dataset.blonkyStep));
		}, { signal: listeners.signal });
	}

	for (const row of emoteRows) {
		row.addEventListener('click', () => fireEmote(row), { signal: listeners.signal });
	}

	filterInput?.addEventListener('input', () => {
		const query = filterInput.value.trim().toLowerCase();
		for (const row of emoteRows) {
			row.hidden = query.length > 0 && !(row.dataset.blonkyEmote ?? '').includes(query);
		}
	}, { signal: listeners.signal });

	window.addEventListener('keydown', (event) => {
		if (isEditableTarget(event.target)) return;
		if (event.code === 'Space') {
			event.preventDefault();
			togglePlayback();
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			step(-1);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			step(1);
		}
	}, { signal: listeners.signal });

	return () => {
		listeners.abort();
		animator.destroy();
	};
}

const unmountBlonkyPage = (): void => {
	destroyMountedPage?.();
	destroyMountedPage = undefined;
	mountedRoot = null;
};

const mountBlonkyPage = (): void => {
	const root = document.querySelector<HTMLElement>('[data-blonky-page-root]');
	if (!root || root === mountedRoot) return;
	unmountBlonkyPage();
	const cleanup = initBlonkyPage(root);
	if (!cleanup) return;
	mountedRoot = root;
	destroyMountedPage = cleanup;
};

export function registerBlonkyDebugLifecycle(): void {
	mountBlonkyPage();
	if (lifecycleRegistered) return;
	lifecycleRegistered = true;
	document.addEventListener('astro:page-load', mountBlonkyPage);
	document.addEventListener('astro:before-swap', unmountBlonkyPage);
}
