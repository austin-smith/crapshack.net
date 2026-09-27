import { createBlonkyAnimator, type BlonkyAnimator, type BlonkyPainter } from './animator';
import {
	BLONKY_EMOTES,
	isBlonkyEmote,
	type BlonkyEmoteInfo,
} from './emotes';
import { BLONKY_FPS, BLONKY_SHADINGS, isBlonkyShading } from './types';
import type { ToggleChangeEvent } from '../ui/toggle';
import type { ClayBoardPattern } from './clay/renderer';

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

type BlonkyPainterFactory = (canvas: HTMLCanvasElement) => BlonkyPainter | undefined;

interface BlonkyLabOptions {
	/** Renderers other than ink, keyed by the lab's data-blonky-renderer. */
	painters?: Record<string, BlonkyPainterFactory>;
}

let lifecycleRegistered = false;
const painters = new Map<string, BlonkyPainterFactory>();
let mountedRoot: HTMLElement | null = null;
let mountedPainter: BlonkyPainterFactory | undefined;
let destroyMountedPage: (() => void) | undefined;

function initBlonkyPage(root: HTMLElement, painter?: BlonkyPainterFactory): (() => void) | undefined {
	const canvas = root.querySelector<HTMLCanvasElement>('[data-blonky-page-canvas]');
	const playbackButton = root.querySelector<HTMLButtonElement>('[data-blonky-playback]');
	const playIcon = root.querySelector<HTMLElement>('[data-blonky-playback-icon="play"]');
	const pauseIcon = root.querySelector<HTMLElement>('[data-blonky-playback-icon="pause"]');
	const resetButton = root.querySelector<HTMLButtonElement>('[data-blonky-reset]');
	const headVisibilityButton = root.querySelector<HTMLButtonElement>('[data-blonky-head-visibility]');
	const bodyVisibilityButton = root.querySelector<HTMLButtonElement>('[data-blonky-body-visibility]');
	const armsVisibilityButton = root.querySelector<HTMLButtonElement>('[data-blonky-arms-visibility]');
	const shadingDropdown = root.querySelector<HTMLElement>('#blonky-shading');
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
	const restLabel = canvas.getAttribute('aria-label') ?? 'Blonky at rest';
	const listeners = new AbortController();
	let activeRow: HTMLButtonElement | null = null;
	let clipEnd = 0;
	let looping = false;
	let frameAnimator: BlonkyAnimator | undefined;

	const clearActiveRow = (): void => {
		activeRow?.setAttribute('aria-pressed', 'false');
		activeRow = null;
		canvas.setAttribute('aria-label', restLabel);
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

	let painted = false;
	const animator = createBlonkyAnimator(canvas, {
		autoPauseOffscreen: false,
		onFrame: syncFrame,
		onPlaybackChange: syncPlayback,
		painter: painter && ((target) => {
			const result = painter(target);
			painted = result !== undefined;
			return result;
		}),
		showArms: true,
		view: 'debug',
	});
	if (!animator) return;
	// The ink drawing stands in when the requested renderer is unsupported,
	// styled as the ink lab and without the controls that only the clay
	// answers to.
	const unsupported = Boolean(painter) && !painted;
	if (unsupported) root.classList.replace(`blonky-debug--${root.dataset.blonkyRenderer}`, 'blonky-debug--ink');
	const fallback = root.querySelector<HTMLElement>('[data-blonky-renderer-fallback]');
	if (fallback) fallback.hidden = !unsupported;
	for (const controls of root.querySelectorAll<HTMLElement>('[data-blonky-clay-controls]')) {
		controls.hidden = unsupported;
	}
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
	// Component toggles exist only where the figure is drawn in parts (ink).
	const components: [HTMLButtonElement | null, string, (visible: boolean) => void][] = [
		[headVisibilityButton, 'head', animator.setHeadVisible],
		[bodyVisibilityButton, 'body', animator.setBodyVisible],
		[armsVisibilityButton, 'arms', animator.setArmsVisible],
	];
	for (const [button, part, setVisible] of components) {
		button?.addEventListener('toggle-change', ((event: ToggleChangeEvent) => {
			const visible = event.detail.pressed;
			setVisible(visible);
			button.setAttribute('aria-pressed', String(visible));
			status.textContent = `Blonky ${part} ${visible ? 'shown' : 'hidden'}`;
		}) as EventListener, { signal: listeners.signal });
	}
	// Shading views exist only where the figure is lit (clay).
	shadingDropdown?.addEventListener('dropdown-change', ((event: CustomEvent<{ value: string }>) => {
		const shading = event.detail.value;
		if (!isBlonkyShading(shading)) return;
		animator.setShading(shading);
		status.textContent = `Showing ${BLONKY_SHADINGS[shading]}`;
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
	mountedPainter = undefined;
};

const mountBlonkyPage = (): void => {
	const root = document.querySelector<HTMLElement>('[data-blonky-page-root]');
	if (!root) return;
	const painter = painters.get(root.dataset.blonkyRenderer ?? '');
	if (root === mountedRoot && painter === mountedPainter) return;
	unmountBlonkyPage();
	const cleanup = initBlonkyPage(root, painter);
	if (!cleanup) return;
	mountedRoot = root;
	mountedPainter = painter;
	destroyMountedPage = cleanup;
};

/** A computed CSS colour, `rgb()` or `color(srgb ...)`, as sRGB from 0 to 1. */
function parseComputedColor(value: string): [number, number, number] | undefined {
	const srgb = value.match(/color\(srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/);
	if (srgb) return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])];
	const rgb = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
	if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
	return undefined;
}

/**
 * The lab stage's dot grid, as the clay renderer paints it onto its board:
 * read from the stage's --lab-dot-* properties, which its background uses
 * too, so the two match. Its colours are resolved again if the site theme
 * changes; where the canvas sits on the grid is read each exposure.
 */
export function labStagePattern(canvas: HTMLCanvasElement): () => ClayBoardPattern | undefined {
	let theme: string | undefined;
	let look: Omit<ClayBoardPattern, 'offset'> | undefined;
	const resolve = (stage: HTMLElement): Omit<ClayBoardPattern, 'offset'> | undefined => {
		const style = getComputedStyle(stage);
		const spacing = Number.parseFloat(style.getPropertyValue('--lab-dot-spacing'));
		const radius = Number.parseFloat(style.getPropertyValue('--lab-dot-radius'));
		// Custom properties compute to their tokens; a probe resolves the colour.
		const probe = document.createElement('span');
		probe.style.color = 'var(--lab-dot-color)';
		stage.append(probe);
		const dot = parseComputedColor(getComputedStyle(probe).color);
		probe.remove();
		const ground = parseComputedColor(style.backgroundColor);
		if (!dot || !ground || !(spacing > 0) || !(radius > 0)) return undefined;
		return { dot, ground, spacing, radius };
	};
	return () => {
		const stage = canvas.closest<HTMLElement>('[data-blonky-stage]');
		if (!stage) return undefined;
		if (!look || theme !== document.documentElement.dataset.theme) {
			theme = document.documentElement.dataset.theme;
			look = resolve(stage);
		}
		if (!look) return undefined;
		// The grid starts at the stage's padding box, as its background does.
		const stageRect = stage.getBoundingClientRect();
		const canvasRect = canvas.getBoundingClientRect();
		return {
			...look,
			offset: {
				x: canvasRect.left - stageRect.left - stage.clientLeft,
				y: canvasRect.top - stageRect.top - stage.clientTop,
			},
		};
	};
}

export function registerBlonkyDebugLifecycle(options: BlonkyLabOptions = {}): void {
	for (const [name, painter] of Object.entries(options.painters ?? {})) painters.set(name, painter);
	mountBlonkyPage();
	if (lifecycleRegistered) return;
	lifecycleRegistered = true;
	document.addEventListener('astro:page-load', mountBlonkyPage);
	document.addEventListener('astro:before-swap', unmountBlonkyPage);
}
