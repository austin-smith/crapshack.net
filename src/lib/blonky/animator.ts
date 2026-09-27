import '../../styles/blonky.css';

import {
	BLONKY_EMOTES,
	blonkyTransitionSeconds,
	isBlonkyEmote,
	sampleBlonkyEmoteOffset,
	type BlonkyEmote,
	type BlonkyEmoteInfo,
	type BlonkyEmoteOffset,
	type BlonkyEmotePose,
} from './emotes';
import { DEFAULT_BLONKY_PALETTE, drawBlonky } from './drawing';
import {
	BLONKY_FPS,
	BLONKY_VIEWPORTS,
	type BlonkyDrawOptions,
	type BlonkyPalette,
	type BlonkyShading,
	type BlonkyView,
} from './types';

/** An alternate renderer that owns the canvas instead of the ink drawing. */
export interface BlonkyPainter {
	destroy: () => void;
	draw: (time: number, options: BlonkyDrawOptions) => void;
}

interface BlonkyAnimatorOptions {
	autoPauseOffscreen?: boolean;
	initiallyPaused?: boolean;
	onFrame?: (time: number) => void;
	onPlaybackChange?: (playing: boolean) => void;
	/** When an emote, or the ease back from one, starts or ends on screen. */
	onEmotingChange?: (emoting: boolean) => void;
	showArms?: boolean;
	showBody?: boolean;
	showHead?: boolean;
	/** Replaces the ink drawing; ink remains the fallback if this returns nothing. */
	painter?: (canvas: HTMLCanvasElement) => BlonkyPainter | undefined;
	view?: BlonkyView;
}

export interface BlonkyAnimator {
	destroy: () => void;
	getPlaybackRate: () => number;
	getTime: () => number;
	isArmsVisible: () => boolean;
	isBodyVisible: () => boolean;
	isHeadVisible: () => boolean;
	getShading: () => BlonkyShading;
	isPlaying: () => boolean;
	/** Whether an emote, or the ease back from one, is on screen. */
	isEmoting: () => boolean;
	pause: () => void;
	play: () => void;
	playEmote: (kind: BlonkyEmote) => void;
	releaseEmote: () => void;
	reset: () => void;
	seek: (time: number) => void;
	setArmsVisible: (visible: boolean) => void;
	setBodyVisible: (visible: boolean) => void;
	setHeadVisible: (visible: boolean) => void;
	setShading: (shading: BlonkyShading) => void;
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
/** Dispatched from a mounted Blonky's root when he starts or stops emoting. */
export const BLONKY_EMOTING_CHANGE_EVENT = 'blonky:emoting-change';
export type BlonkyEmotingChangeEvent = CustomEvent<{ emoting: boolean }>;
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
	const painter = options.painter?.(canvas);
	const context = painter ? null : canvas.getContext('2d');
	if (!painter && !context) return;

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
	let reportedEmoting: boolean | undefined;
	let palette = resolveBlonkyPalette(canvas);
	let bodyVisible = options.showBody ?? true;
	let armsVisible = options.showArms ?? bodyVisible;
	let armsVisibilityOverridden = options.showArms !== undefined;
	let headVisible = options.showHead ?? true;
	let shading: BlonkyShading = 'lit';

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
		if (time < emote.startedAt) return;
		const emoteElapsed = Math.max(0, time - emote.startedAt);
		if (emote.kind === 'rest') {
			if (emoteElapsed >= blonkyTransitionSeconds(emote.transitionFrom)) return;
			return {
				kind: 'rest',
				elapsed: emoteElapsed,
				direction: emote.direction,
				transitionFrom: emote.transitionFrom,
			};
		}
		const emoteInfo: BlonkyEmoteInfo = BLONKY_EMOTES[emote.kind];
		const holds = emoteInfo.holds === true;
		if (emoteElapsed >= Math.max(emoteInfo.duration, blonkyTransitionSeconds(emote.transitionFrom)) && !holds) return;
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

		// Keep the last performance so the lab can seek back through it. Sample
		// the pose on the same clock as the ink for reproducible exported frames.
		const emotePose = emotePoseAt(nextFrame / BLONKY_FPS);
		if ((emotePose !== undefined) !== reportedEmoting) {
			reportedEmoting = emotePose !== undefined;
			options.onEmotingChange?.(reportedEmoting);
		}

		if (painter) {
			painter.draw(time, {
				emote: emotePose,
				showArms: armsVisible,
				showBody: bodyVisible,
				showHead: headVisible,
				shading,
				view,
			});
		} else if (context) {
			context.setTransform(canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0);
			drawBlonky(context, time, {
				palette,
				emote: emotePose,
				showArms: armsVisible,
				showBody: bodyVisible,
				showHead: headVisible,
				view,
			});
		}
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
		lastFrame = -1;
		draw(nextTime, true);
	};

	const reset = (): void => {
		emote = undefined;
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

	const setShading = (nextShading: BlonkyShading): void => {
		if (shading === nextShading) return;
		shading = nextShading;
		lastFrame = -1;
		draw(animationTime(), true);
	};

	const step = (frames: number): void => {
		pause();
		const nextTime = Math.max(0, animationTime() + frames / BLONKY_FPS);
		elapsed = nextTime;
		startedAt = performance.now();
		lastFrame = -1;
		draw(nextTime, true);
	};

	const playEmote = (kind: BlonkyEmote): void => {
		const time = Math.floor(animationTime() * BLONKY_FPS) / BLONKY_FPS;
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
		if (reducedMotion && (!reducedMotionOverride || manuallyPaused)) {
			// A deliberate still expression, which remains seekable in the lab.
			const info = BLONKY_EMOTES[kind];
			const stillFrame = info.stillFrame ?? Math.round(info.duration * 0.45 * BLONKY_FPS);
			seek(time + stillFrame / BLONKY_FPS);
			return;
		}
		lastFrame = -1;
		draw(time, true);
		scheduleAnimation();
	};

	const releaseEmote = (): void => {
		const time = Math.floor(animationTime() * BLONKY_FPS) / BLONKY_FPS;
		const outgoingPose = emotePoseAt(time);
		if (!outgoingPose || outgoingPose.kind === 'rest') return;
		emote = {
			kind: 'rest',
			direction: outgoingPose.direction,
			startedAt: time,
			transitionFrom: sampleBlonkyEmoteOffset(outgoingPose),
		};
		if (reducedMotion && (!reducedMotionOverride || manuallyPaused)) {
			seek(time + blonkyTransitionSeconds(emote.transitionFrom));
			return;
		}
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
		painter?.destroy();
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
		isEmoting: () => emotePoseAt(Math.floor(animationTime() * BLONKY_FPS) / BLONKY_FPS) !== undefined,
		isArmsVisible: () => armsVisible,
		isBodyVisible: () => bodyVisible,
		isHeadVisible: () => headVisible,
		getShading: () => shading,
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
		setShading,
		setPlaybackRate,
		step,
	};
}

type BlonkyPainterFactory = NonNullable<BlonkyAnimatorOptions['painter']>;

function mountBlonkyCanvas(root: HTMLElement, painter?: BlonkyPainterFactory): BlonkyAnimator | undefined {
	const canvas = root.querySelector<HTMLCanvasElement>('[data-blonky-canvas]');
	if (!canvas) return;
	const view = canvas.dataset.blonkyView === 'bust' ? 'bust' : 'portrait';
	const animator = createBlonkyAnimator(canvas, {
		painter,
		showHead: canvas.dataset.blonkyShowHead !== 'false',
		view,
		onEmotingChange: (emoting) => {
			const change: BlonkyEmotingChangeEvent = new CustomEvent(BLONKY_EMOTING_CHANGE_EVENT, {
				detail: { emoting },
				bubbles: true,
			});
			root.dispatchEvent(change);
		},
	});
	if (!animator) return;

	const handleEmote = (event: Event): void => {
		if (!(event instanceof CustomEvent)) return;
		const kind = event.detail?.kind;
		if (isBlonkyEmote(kind)) animator.playEmote(kind);
	};
	root.addEventListener(BLONKY_EMOTE_EVENT, handleEmote);

	const mounted = {
		...animator,
		destroy: () => {
			root.removeEventListener(BLONKY_EMOTE_EVENT, handleEmote);
			animator.destroy();
		},
	};
	mountedCanvases.set(root, mounted);
	return mounted;
}

export function mountBlonkyCanvases(scope: ParentNode = document): void {
	for (const root of scope.querySelectorAll<HTMLElement>('[data-blonky-root]')) {
		if (!mountedCanvases.has(root)) mountBlonkyCanvas(root);
	}
}

/**
 * Redraws a mounted Blonky with another renderer (ink when `painter` is
 * omitted), picking up where he was. Only while he's idle: an emote in
 * progress would be cut short. Returns whether the new renderer took over;
 * if it can't run here, he stays in ink.
 */
export function setBlonkyRenderer(id: string, painter?: BlonkyPainterFactory): boolean {
	const root = document.querySelector<HTMLElement>(`[data-blonky-id="${CSS.escape(id)}"]`);
	const current = root && mountedCanvases.get(root);
	const canvas = root?.querySelector<HTMLCanvasElement>('[data-blonky-canvas]');
	if (!root || !current || !canvas || current.isEmoting()) return false;
	const time = current.getTime();
	const rate = current.getPlaybackRate();
	current.destroy();
	mountedCanvases.delete(root);
	// A canvas keeps the kind of context it first handed out, so each
	// renderer draws on a fresh one.
	const fresh = canvas.cloneNode(true) as HTMLCanvasElement;
	canvas.replaceWith(fresh);
	let painted = false;
	const next = mountBlonkyCanvas(root, painter && ((target) => {
		const result = painter(target);
		painted = result !== undefined;
		return result;
	}));
	next?.seek(time);
	next?.setPlaybackRate(rate);
	return painter === undefined || painted;
}

export function unmountBlonkyCanvases(): void {
	for (const animator of mountedCanvases.values()) animator.destroy();
	mountedCanvases.clear();
}

export function playBlonkyEmote(id: string, kind: BlonkyEmote): void {
	const root = document.querySelector<HTMLElement>(`[data-blonky-id="${CSS.escape(id)}"]`);
	root?.dispatchEvent(new CustomEvent(BLONKY_EMOTE_EVENT, { detail: { kind } }));
}

export function setBlonkyPlaybackRate(id: string, rate: number): void {
	const root = document.querySelector<HTMLElement>(`[data-blonky-id="${CSS.escape(id)}"]`);
	if (!root) return;
	mountedCanvases.get(root)?.setPlaybackRate(rate);
}

export function isBlonkyIdle(id: string): boolean {
	const root = document.querySelector<HTMLElement>(`[data-blonky-id="${CSS.escape(id)}"]`);
	const animator = root && mountedCanvases.get(root);
	return animator ? !animator.isEmoting() : false;
}

export function releaseBlonkyEmote(id: string): void {
	const root = document.querySelector<HTMLElement>(`[data-blonky-id="${CSS.escape(id)}"]`);
	if (root) mountedCanvases.get(root)?.releaseEmote();
}

export function registerBlonkyCanvasLifecycle(): void {
	mountBlonkyCanvases();
	if (lifecycleRegistered) return;
	lifecycleRegistered = true;
	document.addEventListener('astro:page-load', () => mountBlonkyCanvases());
	document.addEventListener('astro:before-swap', unmountBlonkyCanvases);
}
