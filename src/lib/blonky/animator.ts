import '../../styles/blonky.css';

import {
	BLONKY_EMOTES,
	isBlonkyEmote,
	sampleBlonkyEmoteOffset,
	type BlonkyEmote,
	type BlonkyEmoteInfo,
	type BlonkyEmoteOffset,
	type BlonkyEmotePose,
} from './emotes';
import { DEFAULT_BLONKY_PALETTE, drawBlonky } from './drawing';
import {
	BLONKY_EMOTE_TRANSITION_FRAMES,
	BLONKY_FPS,
	BLONKY_VIEWPORTS,
	type BlonkyPalette,
	type BlonkyView,
} from './types';

interface BlonkyAnimatorOptions {
	autoPauseOffscreen?: boolean;
	initiallyPaused?: boolean;
	onFrame?: (time: number) => void;
	onPlaybackChange?: (playing: boolean) => void;
	showArms?: boolean;
	showBody?: boolean;
	showHead?: boolean;
	view?: BlonkyView;
}

export interface BlonkyAnimator {
	destroy: () => void;
	getPlaybackRate: () => number;
	getTime: () => number;
	isArmsVisible: () => boolean;
	isBodyVisible: () => boolean;
	isHeadVisible: () => boolean;
	isPlaying: () => boolean;
	pause: () => void;
	play: () => void;
	playEmote: (kind: BlonkyEmote) => void;
	releaseEmote: () => void;
	reset: () => void;
	seek: (time: number) => void;
	setArmsVisible: (visible: boolean) => void;
	setBodyVisible: (visible: boolean) => void;
	setHeadVisible: (visible: boolean) => void;
	setPlaybackRate: (rate: number) => void;
	step: (frames: number) => void;
}

interface ActiveEmote {
	kind: BlonkyEmote | 'rest';
	direction: -1 | 1;
	startedAt: number;
	transitionFrom?: BlonkyEmoteOffset;
}

const mountedCanvases = new Map<HTMLElement, BlonkyAnimator>();
const BLONKY_EMOTE_EVENT = 'blonky:emote';
const MAX_CANVAS_DIMENSION = 4096;
const MAX_CANVAS_PIXELS = MAX_CANVAS_DIMENSION ** 2;
let lifecycleRegistered = false;

function resolveBlonkyPalette(canvas: HTMLCanvasElement): BlonkyPalette {
	const styles = getComputedStyle(canvas);
	const textureAlpha = Number.parseFloat(
		styles.getPropertyValue('--blonky-shirt-texture-alpha'),
	);
	return {
		outlineInk: styles.getPropertyValue('--blonky-outline').trim()
			|| DEFAULT_BLONKY_PALETTE.outlineInk,
		shirt: styles.getPropertyValue('--blonky-shirt').trim()
			|| DEFAULT_BLONKY_PALETTE.shirt,
		shirtTextureAlpha: Number.isFinite(textureAlpha)
			? textureAlpha
			: DEFAULT_BLONKY_PALETTE.shirtTextureAlpha,
		shirtTextureInk: styles.getPropertyValue('--blonky-shirt-texture').trim()
			|| DEFAULT_BLONKY_PALETTE.shirtTextureInk,
	};
}

export function createBlonkyAnimator(
	canvas: HTMLCanvasElement,
	options: BlonkyAnimatorOptions = {},
): BlonkyAnimator | undefined {
	const context = canvas.getContext('2d');
	if (!context) return;

	const view = options.view ?? 'bust';
	const viewport = BLONKY_VIEWPORTS[view];
	const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
	const listeners = new AbortController();
	let manuallyPaused = options.initiallyPaused ?? false;
	let reducedMotion = motionPreference.matches;
	let reducedMotionOverride = false;
	let inViewport = true;
	let pageVisible = document.visibilityState !== 'hidden';
	let running = false;
	let elapsed = 0;
	let playbackRate = 1;
	let startedAt = performance.now();
	let lastFrame = -1;
	let animationRequest: number | null = null;
	let emote: ActiveEmote | undefined;
	let emoteDirection: -1 | 1 = -1;
	let observer: IntersectionObserver | undefined;
	let resizeObserver: ResizeObserver | undefined;
	let themeObserver: MutationObserver | undefined;
	let reportedPlayback: boolean | undefined;
	let palette = resolveBlonkyPalette(canvas);
	let bodyVisible = options.showBody ?? true;
	let armsVisible = options.showArms ?? bodyVisible;
	let armsVisibilityOverridden = options.showArms !== undefined;
	let headVisible = options.showHead ?? true;

	const reportPlayback = (): void => {
		if (reportedPlayback === running) return;
		reportedPlayback = running;
		options.onPlaybackChange?.(running);
	};

	const animationTime = (now = performance.now()): number => (
		elapsed + (running ? ((now - startedAt) / 1000) * playbackRate : 0)
	);

	const emotePoseAt = (time: number): BlonkyEmotePose | undefined => {
		if (!emote) return;
		const emoteElapsed = Math.max(0, time - emote.startedAt);
		if (emote.kind === 'rest') {
			if (emoteElapsed >= BLONKY_EMOTE_TRANSITION_FRAMES / BLONKY_FPS) return;
			return {
				kind: 'rest',
				elapsed: emoteElapsed,
				direction: emote.direction,
				transitionFrom: emote.transitionFrom,
			};
		}
		const emoteInfo: BlonkyEmoteInfo = BLONKY_EMOTES[emote.kind];
		const holds = emoteInfo.holds === true;
		if (emoteElapsed >= emoteInfo.duration && !holds) return;
		return {
			kind: emote.kind,
			elapsed: holds ? Math.min(emoteElapsed, emoteInfo.duration) : emoteElapsed,
			direction: emote.direction,
			heldElapsed: !holds || emoteElapsed <= emoteInfo.duration
				? undefined
				: emoteElapsed - emoteInfo.duration,
			transitionFrom: emote.transitionFrom,
		};
	};

	const configureCanvas = (): boolean => {
		const bounds = canvas.getBoundingClientRect();
		const displayWidth = bounds.width || viewport.width;
		const displayHeight = bounds.height || viewport.height;
		const preferredScale = Math.max(1, devicePixelRatio || 1);
		const dimensionScale = Math.min(
			MAX_CANVAS_DIMENSION / displayWidth,
			MAX_CANVAS_DIMENSION / displayHeight,
		);
		const pixelScale = Math.sqrt(MAX_CANVAS_PIXELS / (displayWidth * displayHeight));
		const renderScale = Math.min(preferredScale, dimensionScale, pixelScale);
		const width = Math.max(1, Math.round(displayWidth * renderScale));
		const height = Math.max(1, Math.round(displayHeight * renderScale));
		if (canvas.width === width && canvas.height === height) return false;
		canvas.width = width;
		canvas.height = height;
		lastFrame = -1;
		return true;
	};

	const resizeCanvas = (): void => {
		if (!configureCanvas()) return;
		draw(animationTime(), true);
	};

	const draw = (time: number, force = false): void => {
		const nextFrame = Math.floor(time * BLONKY_FPS);
		if (!force && nextFrame === lastFrame) return;

		const emotePose = emotePoseAt(time);
		if (emote && !emotePose) emote = undefined;

		context.setTransform(canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0);
		drawBlonky(context, time, {
			palette,
			emote: emotePose,
			showArms: armsVisible,
			showBody: bodyVisible,
			showHead: headVisible,
			view,
		});
		lastFrame = nextFrame;
		options.onFrame?.(time);
	};

	const stopAnimation = (): void => {
		if (animationRequest === null) return;
		cancelAnimationFrame(animationRequest);
		animationRequest = null;
	};

	const shouldRun = (): boolean => (
		!manuallyPaused
		&& (!reducedMotion || reducedMotionOverride)
		&& inViewport
		&& pageVisible
	);

	const scheduleAnimation = (): void => {
		if (!running || animationRequest !== null || !canvas.isConnected) return;
		animationRequest = requestAnimationFrame(render);
	};

	const render = (now: number): void => {
		animationRequest = null;
		if (!canvas.isConnected) {
			destroy();
			return;
		}
		draw(animationTime(now));
		scheduleAnimation();
	};

	const syncPlayback = (now = performance.now()): void => {
		const nextRunning = shouldRun();
		if (nextRunning === running) {
			if (running) scheduleAnimation();
			return;
		}

		if (running) elapsed = animationTime(now);
		running = nextRunning;
		if (running) startedAt = now;
		else stopAnimation();
		lastFrame = -1;
		draw(animationTime(now), true);
		reportPlayback();
		if (running) scheduleAnimation();
	};

	const pause = (): void => {
		manuallyPaused = true;
		syncPlayback();
	};

	const play = (): void => {
		manuallyPaused = false;
		reducedMotionOverride = true;
		syncPlayback();
	};

	const seek = (time: number): void => {
		const nextTime = Number.isFinite(time) ? Math.max(0, time) : 0;
		elapsed = nextTime;
		startedAt = performance.now();
		emote = undefined;
		lastFrame = -1;
		draw(nextTime, true);
	};

	const reset = (): void => {
		seek(0);
	};

	const setPlaybackRate = (rate: number): void => {
		if (!Number.isFinite(rate) || rate <= 0) return;
		const now = performance.now();
		if (running) elapsed = animationTime(now);
		playbackRate = rate;
		startedAt = now;
		lastFrame = -1;
		draw(animationTime(now), true);
	};

	const setBodyVisible = (visible: boolean): void => {
		const bodyChanged = bodyVisible !== visible;
		const armsChanged = !armsVisibilityOverridden && armsVisible !== visible;
		if (!bodyChanged && !armsChanged) return;
		bodyVisible = visible;
		if (!armsVisibilityOverridden) armsVisible = visible;
		lastFrame = -1;
		draw(animationTime(), true);
	};

	const setArmsVisible = (visible: boolean): void => {
		armsVisibilityOverridden = true;
		if (armsVisible === visible) return;
		armsVisible = visible;
		lastFrame = -1;
		draw(animationTime(), true);
	};

	const setHeadVisible = (visible: boolean): void => {
		if (headVisible === visible) return;
		headVisible = visible;
		lastFrame = -1;
		draw(animationTime(), true);
	};

	const step = (frames: number): void => {
		pause();
		seek(animationTime() + frames / BLONKY_FPS);
	};

	const playEmote = (kind: BlonkyEmote): void => {
		const time = animationTime();
		const outgoingPose = emotePoseAt(time);
		const transitionFrom = outgoingPose
			? sampleBlonkyEmoteOffset(outgoingPose)
			: undefined;
		emoteDirection = emoteDirection === -1 ? 1 : -1;
		emote = {
			kind,
			direction: emoteDirection,
			startedAt: time,
			transitionFrom,
		};
		lastFrame = -1;
		draw(time, true);
		scheduleAnimation();
	};

	const releaseEmote = (): void => {
		const time = animationTime();
		const outgoingPose = emotePoseAt(time);
		if (!outgoingPose || outgoingPose.kind === 'rest') return;
		emote = {
			kind: 'rest',
			direction: outgoingPose.direction,
			startedAt: time,
			transitionFrom: sampleBlonkyEmoteOffset(outgoingPose),
		};
		lastFrame = -1;
		draw(time, true);
		scheduleAnimation();
	};

	const destroy = (): void => {
		stopAnimation();
		observer?.disconnect();
		resizeObserver?.disconnect();
		themeObserver?.disconnect();
		listeners.abort();
	};

	motionPreference.addEventListener('change', (event) => {
		reducedMotion = event.matches;
		reducedMotionOverride = false;
		syncPlayback();
	}, { signal: listeners.signal });

	document.addEventListener('visibilitychange', () => {
		pageVisible = document.visibilityState !== 'hidden';
		syncPlayback();
	}, { signal: listeners.signal });

	window.addEventListener('pagehide', () => {
		pageVisible = false;
		syncPlayback();
	}, { signal: listeners.signal });

	window.addEventListener('pageshow', () => {
		pageVisible = true;
		syncPlayback();
	}, { signal: listeners.signal });

	window.addEventListener('resize', resizeCanvas, { signal: listeners.signal });
	resizeObserver = new ResizeObserver(resizeCanvas);
	resizeObserver.observe(canvas);

	if (options.autoPauseOffscreen ?? true) {
		observer = new IntersectionObserver(([entry]) => {
			inViewport = entry?.isIntersecting ?? false;
			syncPlayback();
		}, { rootMargin: '80px 0px' });
		observer.observe(canvas);
	}

	themeObserver = new MutationObserver(() => {
		palette = resolveBlonkyPalette(canvas);
		lastFrame = -1;
		draw(animationTime(), true);
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-theme'],
	});

	configureCanvas();
	draw(0, true);
	syncPlayback();
	reportPlayback();

	return {
		destroy,
		getPlaybackRate: () => playbackRate,
		getTime: () => animationTime(),
		isArmsVisible: () => armsVisible,
		isBodyVisible: () => bodyVisible,
		isHeadVisible: () => headVisible,
		isPlaying: () => running,
		pause,
		play,
		playEmote,
		releaseEmote,
		reset,
		seek,
		setArmsVisible,
		setBodyVisible,
		setHeadVisible,
		setPlaybackRate,
		step,
	};
}

export function mountBlonkyCanvases(scope: ParentNode = document): void {
	for (const root of scope.querySelectorAll<HTMLElement>('[data-blonky-root]')) {
		if (mountedCanvases.has(root)) continue;
		const canvas = root.querySelector<HTMLCanvasElement>('[data-blonky-canvas]');
		if (!canvas) continue;
		const view = canvas.dataset.blonkyView === 'bust' ? 'bust' : 'portrait';
		const animator = createBlonkyAnimator(canvas, {
			showHead: canvas.dataset.blonkyShowHead !== 'false',
			view,
		});
		if (!animator) continue;

		const handleEmote = (event: Event): void => {
			if (!(event instanceof CustomEvent)) return;
			const kind = event.detail?.kind;
			if (isBlonkyEmote(kind)) animator.playEmote(kind);
		};
		root.addEventListener(BLONKY_EMOTE_EVENT, handleEmote);

		mountedCanvases.set(root, {
			...animator,
			destroy: () => {
				root.removeEventListener(BLONKY_EMOTE_EVENT, handleEmote);
				animator.destroy();
			},
		});
	}
}

export function unmountBlonkyCanvases(): void {
	for (const animator of mountedCanvases.values()) animator.destroy();
	mountedCanvases.clear();
}

export function playBlonkyEmote(id: string, kind: BlonkyEmote): void {
	const root = document.querySelector<HTMLElement>(`[data-blonky-id="${CSS.escape(id)}"]`);
	root?.dispatchEvent(new CustomEvent(BLONKY_EMOTE_EVENT, { detail: { kind } }));
}

export function registerBlonkyCanvasLifecycle(): void {
	mountBlonkyCanvases();
	if (lifecycleRegistered) return;
	lifecycleRegistered = true;
	document.addEventListener('astro:page-load', () => mountBlonkyCanvases());
	document.addEventListener('astro:before-swap', unmountBlonkyCanvases);
}
