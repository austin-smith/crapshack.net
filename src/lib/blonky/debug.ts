import { createBlonkyAnimator, type BlonkyAnimator } from './animator';
import {
	BLONKY_EMOTES,
	isBlonkyEmote,
	type BlonkyEmoteInfo,
} from './emotes';
import { BLONKY_FPS } from './types';
import type { ToggleChangeEvent } from '../ui/toggle';

const isTextEntry = (target: EventTarget | null): boolean => (
	target instanceof HTMLElement
	&& (target.isContentEditable || target.matches('input, select, textarea'))
);

const isButton = (target: EventTarget | null): boolean => (
	target instanceof HTMLElement && target.matches('button')
);

const isDropdownOpen = (root: HTMLElement): boolean => (
	root.querySelector('[data-dropdown-trigger][aria-expanded="true"]') !== null
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
	const armsVisibilityButton = root.querySelector<HTMLButtonElement>('[data-blonky-arms-visibility]');
	const emoteStateOutput = root.querySelector<HTMLOutputElement>('[data-blonky-emote-state]');
	const speedDropdown = root.querySelector<HTMLElement>('#blonky-speed');
	const stateOutput = root.querySelector<HTMLOutputElement>('[data-blonky-state]');
	const timeOutput = root.querySelector<HTMLOutputElement>('[data-blonky-time]');
	const frameOutput = root.querySelector<HTMLOutputElement>('[data-blonky-frame]');
	const timeline = root.querySelector<HTMLInputElement>('[data-blonky-timeline]');
	const durationOutput = root.querySelector<HTMLOutputElement>('[data-blonky-duration]');
	const loopButton = root.querySelector<HTMLButtonElement>('[data-blonky-loop]');
	const surpriseButton = root.querySelector<HTMLButtonElement>('[data-blonky-surprise]');
	const status = root.querySelector<HTMLElement>('[data-blonky-page-status]');
	if (
		!canvas
		|| !playbackButton
		|| !playIcon
		|| !pauseIcon
		|| !resetButton
		|| !headVisibilityButton
		|| !bodyVisibilityButton
		|| !armsVisibilityButton
		|| !emoteStateOutput
		|| !speedDropdown
		|| !stateOutput
		|| !timeOutput
		|| !frameOutput
		|| !timeline
		|| !durationOutput
		|| !loopButton
		|| !surpriseButton
		|| !status
	) return;

	const emoteRows = [...root.querySelectorAll<HTMLButtonElement>('[data-blonky-emote]')];
	const listeners = new AbortController();
	let activeRow: HTMLButtonElement | null = null;
	let clipEnd = 0;
	let looping = false;
	let frameAnimator: BlonkyAnimator | undefined;

	const clearActiveRow = (): void => {
		activeRow?.setAttribute('aria-pressed', 'false');
		activeRow = null;
		canvas.setAttribute('aria-label', 'Blonky, a hand-drawn character at rest');
		emoteStateOutput.value = 'idle';
		timeline.disabled = true;
		timeline.value = '0';
		durationOutput.value = '';
	};

	const syncFrame = (time: number): void => {
		timeOutput.value = `${time.toFixed(3)}\u00a0s`;
		frameOutput.value = String(Math.floor(time * BLONKY_FPS)).padStart(4, '0');
		if (!activeRow) return;
		timeline.value = String(Math.min(Math.floor(time * BLONKY_FPS), clipEnd * BLONKY_FPS));
		timeline.setAttribute('aria-valuetext', `Frame ${timeline.value} of ${timeline.max}`);
		if (time >= clipEnd && frameAnimator?.isPlaying()) {
			if (!looping) frameAnimator.pause();
			frameAnimator.seek(looping ? 0 : clipEnd);
		}
	};
	const syncPlayback = (playing: boolean): void => {
		playIcon.hidden = playing;
		pauseIcon.hidden = !playing;
		playbackButton.setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
		stateOutput.value = playing ? 'playing' : 'paused';
		status.textContent = playing ? 'Blonky animation playing' : 'Blonky animation paused';
	};

	const animator = createBlonkyAnimator(canvas, {
		autoPauseOffscreen: false,
		onFrame: syncFrame,
		onPlaybackChange: syncPlayback,
		showArms: true,
		view: 'debug',
	});
	if (!animator) return;
	frameAnimator = animator;

	const togglePlayback = (): void => {
		if (animator.isPlaying()) animator.pause();
		else {
			if (activeRow && animator.getTime() >= clipEnd) animator.seek(0);
			animator.play();
		}
	};
	const reset = (): void => {
		clearActiveRow();
		animator.pause();
		animator.reset();
	};
	const fireEmote = (row: HTMLButtonElement): void => {
		const emote = row.dataset.blonkyEmote;
		if (!isBlonkyEmote(emote)) return;
		reset();
		activeRow = row;
		row.setAttribute('aria-pressed', 'true');
		emoteStateOutput.value = BLONKY_EMOTES[emote].label;
		const emoteInfo: BlonkyEmoteInfo = BLONKY_EMOTES[emote];
		clipEnd = emoteInfo.duration + (emoteInfo.holds ? 2 : 0.5);
		timeline.max = String(Math.round(clipEnd * BLONKY_FPS));
		timeline.disabled = false;
		durationOutput.value = `${clipEnd.toFixed(3)} s`;
		canvas.setAttribute('aria-label', `Blonky: ${emoteInfo.label}`);
		animator.playEmote(emote);
		// An explicitly selected expression stays still when reduced motion is set.
		if (!matchMedia('(prefers-reduced-motion: reduce)').matches) animator.play();
		status.textContent = `Blonky ${BLONKY_EMOTES[emote].label}`;
	};
	const releaseEmote = (): void => {
		if (!activeRow) return;
		clearActiveRow();
		animator.releaseEmote();
		if (!matchMedia('(prefers-reduced-motion: reduce)').matches) animator.play();
		status.textContent = 'Blonky emote released';
	};

	const surprise = (): void => {
		const choices = emoteRows.filter((row) => row !== activeRow && row.dataset.blonkyEmote !== 'notice');
		const row = choices[Math.floor(Math.random() * choices.length)];
		if (row) fireEmote(row);
	};
	const step = (frames: number): void => {
		animator.pause();
		const frame = Math.floor(animator.getTime() * BLONKY_FPS + 1e-6) + frames;
		animator.seek(Math.min(activeRow ? clipEnd : Infinity, Math.max(0, frame / BLONKY_FPS)));
	};
	timeline.addEventListener('input', () => {
		const requestedTime = Number(timeline.value) / BLONKY_FPS;
		animator.pause();
		animator.seek(requestedTime);
	}, { signal: listeners.signal });
	loopButton.addEventListener('toggle-change', ((event: ToggleChangeEvent) => {
		looping = event.detail.pressed;
		loopButton.setAttribute('aria-pressed', String(looping));
		status.textContent = looping ? 'Loop on' : 'Loop off';
	}) as EventListener, { signal: listeners.signal });
	surpriseButton.addEventListener('click', surprise, { signal: listeners.signal });

	playbackButton.addEventListener('click', togglePlayback, { signal: listeners.signal });
	resetButton.addEventListener('click', reset, { signal: listeners.signal });
	headVisibilityButton.addEventListener('toggle-change', ((event: ToggleChangeEvent) => {
		const visible = event.detail.pressed;
		animator.setHeadVisible(visible);
		headVisibilityButton.setAttribute('aria-pressed', String(visible));
		status.textContent = `Blonky head ${visible ? 'shown' : 'hidden'}`;
	}) as EventListener, { signal: listeners.signal });
	bodyVisibilityButton.addEventListener('toggle-change', ((event: ToggleChangeEvent) => {
		const visible = event.detail.pressed;
		animator.setBodyVisible(visible);
		bodyVisibilityButton.setAttribute('aria-pressed', String(visible));
		status.textContent = `Blonky body ${visible ? 'shown' : 'hidden'}`;
	}) as EventListener, { signal: listeners.signal });
	armsVisibilityButton.addEventListener('toggle-change', ((event: ToggleChangeEvent) => {
		const visible = event.detail.pressed;
		animator.setArmsVisible(visible);
		armsVisibilityButton.setAttribute('aria-pressed', String(visible));
		status.textContent = `Blonky arms ${visible ? 'shown' : 'hidden'}`;
	}) as EventListener, { signal: listeners.signal });
	speedDropdown.addEventListener('dropdown-change', ((event: CustomEvent<{ value: string }>) => {
		animator.setPlaybackRate(Number(event.detail.value));
	}) as EventListener, { signal: listeners.signal });

	for (const button of emoteRows) {
		button.addEventListener('toggle-change', () => {
			if (button === activeRow) releaseEmote();
			else fireEmote(button);
		}, { signal: listeners.signal });
	}

	for (const button of root.querySelectorAll<HTMLButtonElement>('[data-blonky-step]')) {
		button.addEventListener('click', () => {
			step(Number(button.dataset.blonkyStep));
		}, { signal: listeners.signal });
	}

	window.addEventListener('keydown', (event) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (isTextEntry(event.target)) return;
		// An open dropdown owns the keyboard until it closes.
		if (isDropdownOpen(root) || document.documentElement.hasAttribute('data-sidebar-open')) return;
		if (event.code === 'Space') {
			// A focused button already activates on space; don't also toggle.
			if (isButton(event.target)) return;
			event.preventDefault();
			togglePlayback();
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			step(-1);
		} else if (event.key.toLowerCase() === 'r') {
			event.preventDefault();
			if (!event.repeat) surprise();
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
