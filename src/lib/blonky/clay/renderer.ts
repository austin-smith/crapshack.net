import type { BlonkyPainter } from '../animator';
import { BLONKY_BUST_WIDTH, BLONKY_FPS, BLONKY_VIEWPORTS, type BlonkyDrawOptions, type BlonkyShading } from '../types';
import {
	createClayLayers,
	HEAD_FILLET,
	SHIRT_FILLET,
	SOLIDS,
	exposureFlicker,
	LIMB_SAMPLES,
	sculptBlonky,
	VOLUME_DOMAIN,
	type ClayFigure,
	type ClayLayers,
} from './figure';
import { CONTEXT_RESTORE_TIMEOUT_MS, createGpu, createTexture, program, REQUIRED_EXTENSIONS, supportsClay, type Target } from './gpu';
import {
	FILLET_FRAGMENT,
	HEIGHT_FRAGMENT,
	SLEEVE_DEPTH_FRAGMENT,
	LIGHT_FRAGMENT,
	RESOLVE_FRAGMENT,
	TERMS_FRAGMENT,
} from './shaders';

export type ClayRenderer = BlonkyPainter;

interface BlurJob {
	source: number;
	/** Bust units per blurred texel; larger values blur at lower resolution. */
	unitsPerTexel: number;
	/** Gaussian sigma per channel, in bust units. */
	sigma: [number, number, number];
}

// Uploaded textures, in order: four masks, two detail layers, the shirt's
// paint, the volume footprints, the silhouette, the sleeves' footprint, and
// the skin's paint.
const MASK_SOURCE = 0;
const DETAIL_SOURCE = 4;
const SHIRT_PAINT_SOURCE = 6;
const VOLUME_SOURCE = 7;
const SILHOUETTE_SOURCE = 8;
const SLEEVE_SOURCE = 9;
const SKIN_PAINT_SOURCE = 10;
const SOURCE_COUNT = 11;
// The shading views, in the order the light shader numbers them.
const SHADINGS: BlonkyShading[] = ['lit', 'even', 'clay', 'paint', 'depth', 'normals', 'shadows'];
// Volume texels per texel of the softened sleeve depth.
const SLEEVE_SOFTEN_SCALE = 4;
// Shading samples per working pixel, along each axis.
const SUPERSAMPLE = 2;
// The most pixels worked per frame. Each one costs a texel in every
// screen-sized layer and target, and SUPERSAMPLE squared in the float
// shading targets, so this bounds the frame's memory whatever the canvas.
const MAX_WORK_PIXELS = 2048 ** 2;

const BLUR_JOBS: BlurJob[] = [
	// collar, cuffs, eye whites
	{ source: MASK_SOURCE, unitsPerTexel: 0.75, sigma: [3.6, 4.2, 8] },
	// brows, stubble, eyelids
	{ source: MASK_SOURCE + 1, unitsPerTexel: 0.5, sigma: [1.9, 0.8, 3.5] },
	// unused, neckline, tears
	{ source: MASK_SOURCE + 2, unitsPerTexel: 0.75, sigma: [0.35, 3, 1.6] },
	// head, neck, raised hand: where each rolls over onto what's behind it,
	// and the fillet where the head's side runs into the neck
	{ source: MASK_SOURCE + 3, unitsPerTexel: 0.75, sigma: [HEAD_FILLET, HEAD_FILLET, 4] },
	// fine grooves, fine ridges, soft grooves
	{ source: DETAIL_SOURCE, unitsPerTexel: 0.5, sigma: [0.9, 0.9, 3.2] },
	// lips and chin rolls, cheeks, the nose
	{ source: DETAIL_SOURCE + 1, unitsPerTexel: 1, sigma: [6, 10, 7] },
	// the figure's shadow on the backdrop
	{ source: SILHOUETTE_SOURCE, unitsPerTexel: 4, sigma: [22, 1, 1] },
	// the shirt's outline, pressed round
	{ source: SILHOUETTE_SOURCE, unitsPerTexel: 0.75, sigma: [0.35, SHIRT_FILLET, 0.35] },
];

/**
 * Coarse-to-fine sweeps for the volume solve, finest last. Each level starts
 * from the one below it, so the fine levels only settle local detail. The
 * counts are fixed, which keeps every exposure identical when seeking.
 */
const VOLUME_LEVELS = [
	{ spacing: 64, sweeps: 240 },
	{ spacing: 32, sweeps: 80 },
	{ spacing: 16, sweeps: 50 },
	{ spacing: 8, sweeps: 36 },
	{ spacing: 4, sweeps: 28 },
	{ spacing: 2, sweeps: 22 },
	{ spacing: 1, sweeps: 16 },
];

export interface ClayRendererOptions {
	/**
	 * Draw only the figure, over a clear background, so it sits on the page
	 * like the ink drawing: no set behind it, and no vignette.
	 */
	transparent?: boolean;
	/**
	 * After each exposure: its frame number, and the figure's outline (red)
	 * over the canvas, in its pixels.
	 */
	onExpose?: (frame: number, outline: HTMLCanvasElement) => void;
	/**
	 * Called if the renderer can no longer draw after it started: its context
	 * was lost and couldn't be restored.
	 */
	onFail?: () => void;
	/**
	 * A dot grid on the page behind the canvas, to paint onto the board so the
	 * set carries the page's pattern. Read each exposure, so it follows the
	 * canvas as the page lays out.
	 */
	pattern?: () => ClayBoardPattern | undefined;
}

/** A dot grid, as a page draws it behind the canvas. */
export interface ClayBoardPattern {
	/** The dots' colour and the ground's, as sRGB from 0 to 1: the board is darkened where the page is. */
	dot: [number, number, number];
	ground: [number, number, number];
	/** CSS pixels between dots, and each dot's radius. */
	spacing: number;
	radius: number;
	/** Where the canvas's top-left corner falls on the grid, in CSS pixels. */
	offset: { x: number; y: number };
}

/** The clay renderer's own programs, built on a context. Throws if any fails to compile or link. */
function buildPrograms(gl: WebGL2RenderingContext) {
	return {
		height: program(gl, HEIGHT_FRAGMENT),
		light: program(gl, LIGHT_FRAGMENT),
		resolve: program(gl, RESOLVE_FRAGMENT),
		fillet: program(gl, FILLET_FRAGMENT),
		sleeveDepth: program(gl, SLEEVE_DEPTH_FRAGMENT),
		terms: program(gl, TERMS_FRAGMENT),
	};
}

let programsBuilt: boolean | undefined;

// Build every program once on a throwaway canvas before the visible one is
// touched: a canvas that has handed out a WebGL context can't fall back to
// 2D ink, so a failure has to be found here.
function canBuildPrograms(): boolean {
	if (programsBuilt !== undefined) return programsBuilt;
	programsBuilt = false;
	const probe = document.createElement('canvas').getContext('webgl2');
	if (!probe) return programsBuilt;
	try {
		createGpu(probe).setup();
		buildPrograms(probe);
		programsBuilt = true;
	} catch (error) {
		console.error(error);
	}
	probe.getExtension('WEBGL_lose_context')?.loseContext();
	return programsBuilt;
}

export function createClayRenderer(canvas: HTMLCanvasElement, settings: ClayRendererOptions = {}): ClayRenderer | undefined {
	if (!supportsClay() || !canBuildPrograms()) return;
	const transparent = settings.transparent ?? false;
	const gl = canvas.getContext('webgl2', {
		alpha: transparent,
		antialias: false,
		depth: false,
		preserveDrawingBuffer: false,
		premultipliedAlpha: true,
		stencil: false,
	});
	if (!gl || !REQUIRED_EXTENSIONS.every((name) => gl.getExtension(name) !== null)) return;

	const gpu = createGpu(gl);
	const { target, bindTexture, drawTo } = gpu;
	let heightProgram: WebGLProgram;
	let lightProgram: WebGLProgram;
	let resolveProgram: WebGLProgram;
	let filletProgram: WebGLProgram;
	let sleeveDepthProgram: WebGLProgram;
	let termsProgram: WebGLProgram;
	let sources: WebGLTexture[] = [];
	let limbTexture: WebGLTexture;
	const layers: ClayLayers = createClayLayers();

	// The largest viewport the GPU draws, and the longest side a target can
	// have and still be drawn to whole: within the texture limit, and within
	// the viewport limit, which may be smaller.
	let maxViewport = [0, 0];
	let maxTargetSize = 0;

	const setup = (): void => {
		gpu.setup();
		({
			height: heightProgram,
			light: lightProgram,
			resolve: resolveProgram,
			fillet: filletProgram,
			sleeveDepth: sleeveDepthProgram,
			terms: termsProgram,
		} = buildPrograms(gl));
		sources = Array.from({ length: SOURCE_COUNT }, () => createTexture(gl));
		limbTexture = createTexture(gl);
		maxViewport = [...gl.getParameter(gl.MAX_VIEWPORT_DIMS)];
		maxTargetSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), ...maxViewport);
	};

	const blur = (job: BlurJob, index: number, pxPerUnit: number, width: number, height: number) => {
		const scale = Math.max(1, job.unitsPerTexel * pxPerUnit);
		const blurWidth = Math.max(1, Math.round(width / scale));
		const blurHeight = Math.max(1, Math.round(height / scale));
		const texelUnits = width / blurWidth / pxPerUnit;
		const sigma = job.sigma.map((value) => Math.max(0.35, value / texelUnits)) as [number, number, number];
		const radius = Math.min(160, Math.ceil(Math.max(...sigma) * 3));
		// Jobs run one after another, so same-size jobs share a scratch pass.
		return gpu.blur(`blur-v-${index}`, sources[job.source], blurWidth, blurHeight, sigma, radius, `blur-h-${blurWidth}x${blurHeight}`);
	};

	/**
	 * The footprints, with the head's side filleted into the neck, and the
	 * shirt's outline pressed round.
	 */
	const filletFootprint = (): WebGLTexture => {
		const width = VOLUME_DOMAIN.width;
		const height = VOLUME_DOMAIN.height;
		const filleted = target('fillet', width, height);
		const vertical = gpu.blur(
			'fillet-v',
			sources[VOLUME_SOURCE],
			width,
			height,
			[SHIRT_FILLET, HEAD_FILLET, 0.35],
			Math.ceil(Math.max(SHIRT_FILLET, HEAD_FILLET) * 3),
			'fillet-h',
		);
		gl.useProgram(filletProgram);
		gl.uniform2f(gl.getUniformLocation(filletProgram, 'u_sharpness'), 2.5066 * SHIRT_FILLET, 2.5066 * HEAD_FILLET);
		bindTexture(filletProgram, 'u_footprint', 0, sources[VOLUME_SOURCE]);
		bindTexture(filletProgram, 'u_sleeves', 2, sources[SLEEVE_SOURCE]);
		bindTexture(filletProgram, 'u_blurred', 1, vertical.texture);
		drawTo(filleted, width, height);
		return filleted.texture;
	};

	/** Inflates the footprints into volumes, coarsest level first. */
	const solveVolumes = () => gpu.inflate('volume', filletFootprint(), VOLUME_DOMAIN, 1, VOLUME_LEVELS);

	/**
	 * The sleeves' depth, softened: blurred at a quarter of the solve's
	 * resolution, which is ample for a swell this broad.
	 */
	const softenSleeves = (volume: Target): Target => {
		const { soften } = SOLIDS.shirt.sleeve;
		const depth = target('sleeve-depth', volume.width, volume.height);
		gl.useProgram(sleeveDepthProgram);
		bindTexture(sleeveDepthProgram, 'u_volume', 0, volume.texture);
		drawTo(depth, volume.width, volume.height);
		const width = Math.ceil(volume.width / SLEEVE_SOFTEN_SCALE);
		const height = Math.ceil(volume.height / SLEEVE_SOFTEN_SCALE);
		const sigma = soften / SLEEVE_SOFTEN_SCALE;
		return gpu.blur('sleeve-v', depth.texture, width, height, [sigma, sigma, sigma], Math.ceil(sigma * 3), 'sleeve-h');
	};

	const limbRows = (figure: ClayFigure) => figure.arms.map((arm) => arm.arm);

	const uploadLimbs = (figure: ClayFigure): void => {
		const rows = limbRows(figure);
		const data = new Float32Array(LIMB_SAMPLES * 4 * rows.length);
		rows.forEach((limb, index) => data.set(limb.profile, index * LIMB_SAMPLES * 4));
		gl.bindTexture(gl.TEXTURE_2D, limbTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LIMB_SAMPLES, rows.length, 0, gl.RGBA, gl.FLOAT, data);
	};

	// The latest exposure asked for, so a restored context can repaint it
	// even when nothing is animating.
	let latest: { time: number; options: BlonkyDrawOptions } | undefined;
	// The GPU can refuse the renderer's targets without throwing, leaving
	// nothing drawn. The first frame reports that, so whoever mounted the
	// renderer falls back to ink rather than show a blank Blonky.
	const gpuFailed = (): boolean => {
		const error = gl.getError();
		return gl.isContextLost() || error === gl.OUT_OF_MEMORY || error === gl.INVALID_FRAMEBUFFER_OPERATION;
	};
	let firstFrame = true;
	const checkFirstFrame = (): void => {
		if (!firstFrame) return;
		firstFrame = false;
		if (gpuFailed()) throw new Error('The clay renderer could not draw its first frame');
	};

	// A lost context that isn't given back in time, or a restore that can't
	// rebuild the renderer or draw with it, leaves it with nothing to show:
	// its owner is told, to fall back to ink.
	let restoreTimer: number | undefined;
	const onContextLost = (event: Event): void => {
		event.preventDefault();
		restoreTimer = window.setTimeout(() => {
			console.error(new Error('The clay renderer\'s context was not restored'));
			settings.onFail?.();
		}, CONTEXT_RESTORE_TIMEOUT_MS);
	};
	const onContextRestored = (): void => {
		window.clearTimeout(restoreTimer);
		try {
			setup();
			if (latest) draw(latest.time, latest.options);
			if (gpuFailed()) throw new Error('The clay renderer could not be restored');
		} catch (error) {
			console.error(error);
			settings.onFail?.();
		}
	};
	canvas.addEventListener('webglcontextlost', onContextLost);
	canvas.addEventListener('webglcontextrestored', onContextRestored);

	try {
		setup();
	} catch (error) {
		console.error(error);
		return;
	}

	const draw = (time: number, options: BlonkyDrawOptions = {}): void => {
		latest = { time, options };
		if (gl.isContextLost()) {
			checkFirstFrame();
			return;
		}
		const view = options.view ?? 'bust';
		const viewport = BLONKY_VIEWPORTS[view];
		// Worked at a resolution within the GPU's size limit and the pixel
		// budget: every screen-sized layer and target is this size, and only
		// the final pass scales it to the canvas.
		const workScale = Math.min(
			1,
			maxTargetSize / Math.max(canvas.width, canvas.height),
			Math.sqrt(MAX_WORK_PIXELS / (canvas.width * canvas.height)),
		);
		const width = Math.max(1, Math.floor(canvas.width * workScale));
		const height = Math.max(1, Math.floor(canvas.height * workScale));
		const px = width / viewport.width;
		// Match the ink drawing's framing for each view.
		const viewScale = view === 'portrait' ? 0.56 : 1;
		const viewOffset = view === 'debug'
			? { x: (viewport.width - BLONKY_BUST_WIDTH) / 2, y: 0 }
			: view === 'portrait' ? { x: 8, y: -5 } : { x: 0, y: 0 };
		const pxPerUnit = px * viewScale;
		const origin = { x: viewOffset.x * px, y: viewOffset.y * px };
		const frame = Math.floor(time * BLONKY_FPS);

		// The clay figure is one sculpture, so it ignores the ink lab's
		// part-by-part visibility.
		const figure = sculptBlonky(layers, frame / BLONKY_FPS, {
			emote: options.emote,
			origin,
			pxPerUnit,
			width,
			height,
			frame,
		});

		// Screen-space layers are drawn y-down; flip them to texture space.
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
		[...layers.masks, ...layers.details, layers.paint[0]].forEach((layer, index) => {
			gl.bindTexture(gl.TEXTURE_2D, sources[index]);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, layer);
		});
		gl.bindTexture(gl.TEXTURE_2D, sources[SKIN_PAINT_SOURCE]);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, layers.paint[1]);
		gl.bindTexture(gl.TEXTURE_2D, sources[SILHOUETTE_SOURCE]);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, layers.silhouette);
		// The volume footprints stay top row first: the solve and the surface
		// pass both index them from the domain's top. Premultiplied, so a
		// texel the outline half covers reads as half covered, and the solved
		// edge follows the outline smoothly instead of stepping texel by texel.
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.bindTexture(gl.TEXTURE_2D, sources[VOLUME_SOURCE]);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, layers.volumes);
		gl.bindTexture(gl.TEXTURE_2D, sources[SLEEVE_SOURCE]);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, layers.sleeves);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		uploadLimbs(figure);

		const volume = solveVolumes();
		const sleeveSwell = softenSleeves(volume);
		const blurred = BLUR_JOBS.map((job, index) => blur(job, index, pxPerUnit, width, height));

		const setShared = (programRef: WebGLProgram): void => {
			gl.uniform2f(gl.getUniformLocation(programRef, 'u_resolution'), width, height);
			gl.uniform2f(gl.getUniformLocation(programRef, 'u_origin'), origin.x, origin.y);
			gl.uniform1f(gl.getUniformLocation(programRef, 'u_pxPerUnit'), pxPerUnit);
			gl.uniform2f(gl.getUniformLocation(programRef, 'u_bodyOffset'), figure.bodyOffset.x, figure.bodyOffset.y);
			gl.uniform2f(gl.getUniformLocation(programRef, 'u_headOffset'), figure.headOffset.x, figure.headOffset.y);
		};

		// The surface and lighting are shaded at twice the working
		// resolution, then averaged down, which antialiases every edge.
		// Within the GPU's size limit, which the working size alone can reach.
		const shadeScale = Math.min(SUPERSAMPLE, maxTargetSize / Math.max(width, height));
		const shadeWidth = Math.floor(width * shadeScale);
		const shadeHeight = Math.floor(height * shadeScale);
		const surface = target('surface', shadeWidth, shadeHeight, true);
		gl.useProgram(heightProgram);
		setShared(heightProgram);
		const uniform = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(heightProgram, name);
		gl.uniform4f(uniform('u_domain'), VOLUME_DOMAIN.x, VOLUME_DOMAIN.y, VOLUME_DOMAIN.width, VOLUME_DOMAIN.height);
		gl.uniform4fv(uniform('u_limbRange'), limbRows(figure).flatMap((limb) => [limb.top, limb.bottom, 1, 0]));
		gl.uniform4fv(uniform('u_hem'), figure.arms.flatMap(({ hem }) => [hem.x, hem.y, hem.radius, 0]));
		gl.uniform4fv(uniform('u_hemLine'), figure.arms.flatMap(({ hemLine: [a, b] }) => [a.x, a.y, b.x, b.y]));
		gl.uniform2f(uniform('u_chin'), figure.chin.x, figure.chin.y);
		gl.uniform2f(uniform('u_torso'), figure.torso.x, figure.torso.y);
		const { belly } = figure;
		gl.uniform4f(uniform('u_belly'), belly.center.x, belly.center.y, belly.width, belly.height);
		gl.uniform1f(uniform('u_bellyDepth'), belly.depth);
		const hand = figure.hand ?? { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
		gl.uniform4f(uniform('u_handBox'), hand.min.x, hand.min.y, hand.max.x, hand.max.y);
		gl.uniform1fv(uniform('u_foldY'), figure.folds.flatMap((fold) => fold.y));
		gl.uniform4fv(uniform('u_foldSpan'), figure.folds.flatMap((fold) => [fold.start, fold.end, 0, 0]));
		// A fold with no roll has no depth.
		gl.uniform4fv(uniform('u_foldShape'), figure.folds.flatMap(({ shape }) => (
			shape ? [shape.depth, shape.radius, shape.reach, shape.below] : [0, 1, 1, 1]
		)));
		bindTexture(heightProgram, 'u_volume', 0, volume.texture);
		['u_mask0', 'u_mask1', 'u_mask2', 'u_mask3'].forEach((name, index) => {
			bindTexture(heightProgram, name, 1 + index, sources[MASK_SOURCE + index]);
		});
		['u_bevel0', 'u_bevel1', 'u_bevel2', 'u_bevel3', 'u_detail0', 'u_detail1'].forEach((name, index) => {
			bindTexture(heightProgram, name, 5 + index, blurred[index].texture);
		});
		bindTexture(heightProgram, 'u_limbs', 11, limbTexture);
		bindTexture(heightProgram, 'u_reach', 14, blurred[6].texture);
		bindTexture(heightProgram, 'u_sleeveSwell', 12, sleeveSwell.texture);
		drawTo(surface, shadeWidth, shadeHeight);

		// Create the outputs first: making a texture binds it to the active
		// unit, which must not clobber an input bound below.
		const termsWidth = Math.ceil(width / 2);
		const termsHeight = Math.ceil(height / 2);
		const terms = target('terms', termsWidth, termsHeight);
		const image = target('image', shadeWidth, shadeHeight);
		gl.useProgram(termsProgram);
		setShared(termsProgram);
		bindTexture(termsProgram, 'u_height', 0, surface.texture);
		drawTo(terms, termsWidth, termsHeight);

		gl.useProgram(lightProgram);
		setShared(lightProgram);
		gl.uniform1f(gl.getUniformLocation(lightProgram, 'u_exposure'), exposureFlicker(frame));
		gl.uniform1i(gl.getUniformLocation(lightProgram, 'u_transparent'), transparent ? 1 : 0);
		const pattern = settings.pattern?.();
		gl.uniform1i(gl.getUniformLocation(lightProgram, 'u_hasPattern'), pattern ? 1 : 0);
		if (pattern) {
			const shown = canvas.getBoundingClientRect().width;
			const cssPerPixel = shown > 0 ? shown / width : 1;
			const linear = (value: number): number => value ** 2.2;
			gl.uniform4f(gl.getUniformLocation(lightProgram, 'u_pattern'), pattern.spacing, pattern.radius, pattern.offset.x, pattern.offset.y);
			gl.uniform3f(
				gl.getUniformLocation(lightProgram, 'u_patternTint'),
				...pattern.dot.map((value, index) => linear(value) / Math.max(linear(pattern.ground[index]), 1e-4)) as [number, number, number],
			);
			gl.uniform2f(gl.getUniformLocation(lightProgram, 'u_patternScale'), cssPerPixel, cssPerPixel / shadeScale);
		}
		gl.uniform1i(gl.getUniformLocation(lightProgram, 'u_shading'), SHADINGS.indexOf(options.shading ?? 'lit'));
		bindTexture(lightProgram, 'u_height', 0, surface.texture);
		bindTexture(lightProgram, 'u_shirtPaint', 1, sources[SHIRT_PAINT_SOURCE]);
		bindTexture(lightProgram, 'u_skinPaint', 6, sources[SKIN_PAINT_SOURCE]);
		bindTexture(lightProgram, 'u_silhouette', 2, blurred[6].texture);
		bindTexture(lightProgram, 'u_outline', 3, sources[SILHOUETTE_SOURCE]);
		bindTexture(lightProgram, 'u_headMass', 5, blurred[3].texture);
		gl.uniform1f(gl.getUniformLocation(lightProgram, 'u_filletSharpness'), 2.5066 * HEAD_FILLET * pxPerUnit * shadeScale);
		bindTexture(lightProgram, 'u_shirtMass', 7, blurred[7].texture);
		gl.uniform1f(gl.getUniformLocation(lightProgram, 'u_shirtSharpness'), 2.5066 * SHIRT_FILLET * pxPerUnit * shadeScale);
		bindTexture(lightProgram, 'u_terms', 4, terms.texture);
		gl.uniform2f(gl.getUniformLocation(lightProgram, 'u_texel'), 1 / shadeWidth, 1 / shadeHeight);
		drawTo(image, shadeWidth, shadeHeight);

		// The canvas's drawing buffer can be larger than one viewport covers
		// (Firefox doesn't clamp it to the limit), so the resolve paints it in
		// tiles, each pixel finding its place by its own position.
		const bufferWidth = gl.drawingBufferWidth;
		const bufferHeight = gl.drawingBufferHeight;
		gl.useProgram(resolveProgram);
		gl.uniform1f(gl.getUniformLocation(resolveProgram, 'u_frame'), frame);
		gl.uniform2f(gl.getUniformLocation(resolveProgram, 'u_size'), bufferWidth, bufferHeight);
		bindTexture(resolveProgram, 'u_image', 0, image.texture);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		const [tileWidth, tileHeight] = maxViewport;
		for (let y = 0; y < bufferHeight; y += tileHeight) {
			for (let x = 0; x < bufferWidth; x += tileWidth) {
				gl.viewport(x, y, Math.min(tileWidth, bufferWidth - x), Math.min(tileHeight, bufferHeight - y));
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
		}
		checkFirstFrame();
		settings.onExpose?.(frame, layers.silhouette);
	};

	return {
		draw,
		destroy: () => {
			window.clearTimeout(restoreTimer);
			canvas.removeEventListener('webglcontextlost', onContextLost);
			canvas.removeEventListener('webglcontextrestored', onContextRestored);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		},
	};
}
