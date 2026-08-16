import {
	BLONKY_ANIMATIONS,
	BLONKY_VIEWPORTS,
	BLONKY_FPS,
	BLONKY_REACTION_TRANSITION_FRAMES,
	drawBlonky,
	sampleBlonkyReactionOffset,
	type BlonkyReaction,
	type BlonkyAnimationInfo,
	type BlonkyReactionOffset,
	type BlonkyReactionPose,
	type BlonkyView,
} from './blonky-drawing';

interface BlonkyAnimatorOptions {
	autoPauseOffscreen?: boolean;
	initiallyPaused?: boolean;
	onFrame?: (time: number) => void;
	onPlaybackChange?: (playing: boolean) => void;
	showHead?: boolean;
	view?: BlonkyView;
}

export interface BlonkyAnimator {
	destroy: () => void;
	getPlaybackRate: () => number;
	getTime: () => number;
	isPlaying: () => boolean;
	pause: () => void;
	play: () => void;
	react: (kind: BlonkyReaction) => void;
	release: () => void;
	reset: () => void;
	seek: (time: number) => void;
	setPlaybackRate: (rate: number) => void;
	step: (frames: number) => void;
}

interface ActiveReaction {
	kind: BlonkyReaction | 'rest';
	direction: -1 | 1;
	startedAt: number;
	transitionFrom?: BlonkyReactionOffset;
}

const mountedCanvases = new Map<HTMLElement, BlonkyAnimator>();
const BLONKY_REACTION_EVENT = 'blonky:react';
let lifecycleRegistered = false;

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
	let reaction: ActiveReaction | undefined;
	let reactionDirection: -1 | 1 = -1;
	let observer: IntersectionObserver | undefined;
	let reportedPlayback: boolean | undefined;

	const reportPlayback = (): void => {
		if (reportedPlayback === running) return;
		reportedPlayback = running;
		options.onPlaybackChange?.(running);
	};

	const animationTime = (now = performance.now()): number => (
		elapsed + (running ? ((now - startedAt) / 1000) * playbackRate : 0)
	);

	const reactionPoseAt = (time: number): BlonkyReactionPose | undefined => {
		if (!reaction) return;
		const reactionElapsed = Math.max(0, time - reaction.startedAt);
		if (reaction.kind === 'rest') {
			if (reactionElapsed >= BLONKY_REACTION_TRANSITION_FRAMES / BLONKY_FPS) return;
			return {
				kind: 'rest',
				elapsed: reactionElapsed,
				direction: reaction.direction,
				transitionFrom: reaction.transitionFrom,
			};
		}
		const animation: BlonkyAnimationInfo = BLONKY_ANIMATIONS[reaction.kind];
		const holds = animation.holds === true;
		if (reactionElapsed >= animation.duration && !holds) return;
		return {
			kind: reaction.kind,
			elapsed: holds ? Math.min(reactionElapsed, animation.duration) : reactionElapsed,
			direction: reaction.direction,
			heldElapsed: !holds || reactionElapsed <= animation.duration
				? undefined
				: reactionElapsed - animation.duration,
			transitionFrom: reaction.transitionFrom,
		};
	};

	const configureCanvas = (): void => {
		const ratio = Math.min(2, devicePixelRatio || 1);
		canvas.width = Math.round(viewport.width * ratio);
		canvas.height = Math.round(viewport.height * ratio);
		lastFrame = -1;
	};

	const draw = (time: number, force = false): void => {
		const nextFrame = Math.floor(time * BLONKY_FPS);
		if (!force && nextFrame === lastFrame) return;

		const reactionPose = reactionPoseAt(time);
		if (reaction && !reactionPose) reaction = undefined;

		context.setTransform(canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0);
		drawBlonky(context, time, {
			reaction: reactionPose,
			showHead: options.showHead,
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
		reaction = undefined;
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

	const step = (frames: number): void => {
		pause();
		seek(animationTime() + frames / BLONKY_FPS);
	};

	const react = (kind: BlonkyReaction): void => {
		const time = animationTime();
		const outgoingPose = reactionPoseAt(time);
		const transitionFrom = outgoingPose
			? sampleBlonkyReactionOffset(outgoingPose)
			: undefined;
		reactionDirection = reactionDirection === -1 ? 1 : -1;
		reaction = {
			kind,
			direction: reactionDirection,
			startedAt: time,
			transitionFrom,
		};
		lastFrame = -1;
		draw(time, true);
		scheduleAnimation();
	};

	const release = (): void => {
		const time = animationTime();
		const outgoingPose = reactionPoseAt(time);
		if (!outgoingPose || outgoingPose.kind === 'rest') return;
		reaction = {
			kind: 'rest',
			direction: outgoingPose.direction,
			startedAt: time,
			transitionFrom: sampleBlonkyReactionOffset(outgoingPose),
		};
		lastFrame = -1;
		draw(time, true);
		scheduleAnimation();
	};

	const destroy = (): void => {
		stopAnimation();
		observer?.disconnect();
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

	if (options.autoPauseOffscreen ?? true) {
		observer = new IntersectionObserver(([entry]) => {
			inViewport = entry?.isIntersecting ?? false;
			syncPlayback();
		}, { rootMargin: '80px 0px' });
		observer.observe(canvas);
	}

	configureCanvas();
	draw(0, true);
	syncPlayback();
	reportPlayback();

	return {
		destroy,
		getPlaybackRate: () => playbackRate,
		getTime: () => animationTime(),
		isPlaying: () => running,
		pause,
		play,
		react,
		release,
		reset,
		seek,
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

		const handleReaction = (event: Event): void => {
			if (!(event instanceof CustomEvent)) return;
			const kind = event.detail?.kind;
			if (kind === 'notice' || kind === 'confirm' || kind === 'confused') {
				animator.react(kind);
			}
		};
		root.addEventListener(BLONKY_REACTION_EVENT, handleReaction);

		mountedCanvases.set(root, {
			...animator,
			destroy: () => {
				root.removeEventListener(BLONKY_REACTION_EVENT, handleReaction);
				animator.destroy();
			},
		});
	}
}

export function unmountBlonkyCanvases(): void {
	for (const animator of mountedCanvases.values()) animator.destroy();
	mountedCanvases.clear();
}

export function reactBlonky(id: string, kind: BlonkyReaction): void {
	const root = document.querySelector<HTMLElement>(`[data-blonky-id="${CSS.escape(id)}"]`);
	root?.dispatchEvent(new CustomEvent(BLONKY_REACTION_EVENT, { detail: { kind } }));
}

export function registerBlonkyCanvasLifecycle(): void {
	mountBlonkyCanvases();
	if (lifecycleRegistered) return;
	lifecycleRegistered = true;
	document.addEventListener('astro:page-load', () => mountBlonkyCanvases());
	document.addEventListener('astro:before-swap', unmountBlonkyCanvases);
}
