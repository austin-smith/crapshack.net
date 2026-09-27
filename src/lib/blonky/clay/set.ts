import { BLONKY_VIEWPORTS } from '../types';
import { exposureFlicker } from './figure';
import { createGpu, createTexture, program, REQUIRED_EXTENSIONS, supportsClay, type SolveLevel } from './gpu';
import {
	SET_DEVELOP_FRAGMENT,
	SET_HEIGHT_FRAGMENT,
	SET_LIGHT_FRAGMENT,
	SET_ROUND_FRAGMENT,
	SET_SOFTEN_FRAGMENT,
} from './set-shaders';

/**
 * The homepage as a clay set, behind a clay Blonky: a plasticine wall in the
 * page's own colour, the logo and the aphorism rolled in clay and pressed
 * onto it, and Blonky's shadow thrown on the wall behind him, all under his
 * lamp. The page's real logo and aphorism stay where they are, invisible,
 * for layout, reading, and clicking; the set reads where they sit and what
 * the aphorism says.
 */

export interface ClaySetOptions {
	logo: HTMLImageElement;
	/** The element the aphorism is typed into. */
	aphorism: HTMLElement;
	/** Blonky's current canvas: his shadow falls from where it sits. */
	figure: () => HTMLCanvasElement | null;
	/**
	 * Called if the set can no longer be drawn after it started: its context
	 * was lost and couldn't be restored.
	 */
	onFail?: () => void;
}

export interface ClaySet {
	/**
	 * Blonky's latest exposure: its frame number, and his outline (red) over
	 * his canvas, in its pixels. The set develops each exposure with him, so
	 * the two flicker together and his shadow moves with him.
	 */
	expose: (frame: number, outline: HTMLCanvasElement) => void;
	destroy: () => void;
}

interface Domain {
	left: number;
	top: number;
	width: number;
	height: number;
}

// Page pixels per footprint texel for the rolled pieces.
const PIECE_TEXEL = 0.5;
// How far a piece's domain reaches past it, for its rounded edge and the
// fillet pressing it onto the wall, in page pixels.
const PIECE_MARGIN = 12;
// How much a drawn piece is rounded before it's rolled, and how much it's
// fattened, in page pixels: the logo is rolled in thick coils. Growing
// closes any gap narrower than about twice the growth, so it's kept small
// enough that the script's narrow notches (the r's curl, the a's bowl) stay
// open; the coils get their plumpness from their height instead.
const LOGO_ROUNDING = 1.6;
const LOGO_GROWTH = 1.2;
// The aphorism's letters are cut from a thin sheet of clay: their edges turn
// down to the wall over about this width, in page pixels.
const TEXT_BEVEL = 0.45;
// Pieces are small, so their solves start fine.
const PIECE_LEVELS: readonly SolveLevel[] = [
	{ spacing: 16, sweeps: 40 },
	{ spacing: 8, sweeps: 30 },
	{ spacing: 4, sweeps: 24 },
	{ spacing: 2, sweeps: 20 },
	{ spacing: 1, sweeps: 16 },
];
// Blonky's outline is blurred into his shadow at this fraction of his
// canvas's resolution.
const FIGURE_SCALE = 1 / 8;
// Room around his canvas for his shadow to soften into, as a fraction of
// its size on each side.
const FIGURE_PAD = 0.2;
// His shadow: how far he stands in front of the wall, as the offset of his
// shadow away from the lamp, and how soft it is, in bust units.
const FIGURE_DISTANCE = 140;
const FIGURE_SOFTNESS = 50;
// The camera is focused on him; the wall behind is out of focus by about
// this much, in page pixels.
const WALL_DEFOCUS = 2.5;
// How far the pieces' shadows and occlusion reach past them, in bust units.
const PIECE_SHADOW_REACH = 40;
// The key light's direction across the page, as in the shaders.
const TOWARD_KEY = (() => {
	const length = Math.hypot(0.62, 0.58);
	return { x: -0.62 / length, y: -0.58 / length };
})();
// Front-facing light on the wall at the pool's middle, per channel: the
// wall's clay is mixed so it comes out in the page's own colour there.
const WALL_LIGHT = [0.84, 0.8, 0.77];
const MAX_PIXEL_RATIO = 2;
// The most pixels the set is worked at, a 4K frame's worth; past that it's
// worked smaller and scaled up to the canvas. The wall is out of focus anyway.
const MAX_WORK_PIXELS = 3840 * 2160;
// How soon after one of Blonky's exposures the next is expected.
const EXPOSURE_WINDOW_MS = 250;

function parseColor(value: string): [number, number, number] {
	const match = value.match(/rgba?\(([^)]+)\)/);
	if (!match) return [0.5, 0.5, 0.5];
	const [r, g, b] = match[1].split(/[\s,/]+/).map(Number);
	return [r / 255, g / 255, b / 255];
}

const toLinear = (value: number): number => value ** 2.2;

/**
 * The drawing's colour where it's drawn: the logo is one colour of clay, so
 * the whole coil is that colour, out past the drawn line where it's grown.
 */
function averageColor(ctx: CanvasRenderingContext2D): [number, number, number] {
	const { data } = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
	const sum = [0, 0, 0];
	let weight = 0;
	for (let index = 0; index < data.length; index += 4) {
		const alpha = data[index + 3];
		if (alpha < 250) continue;
		sum[0] += data[index];
		sum[1] += data[index + 1];
		sum[2] += data[index + 2];
		weight += 1;
	}
	if (weight === 0) return [1, 0.8, 0.87];
	return [sum[0] / weight / 255, sum[1] / weight / 255, sum[2] / weight / 255];
}

/** The complementary error function (Abramowitz and Stegun 7.1.26). */
function erfc(x: number): number {
	const t = 1 / (1 + 0.3275911 * Math.abs(x));
	const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
	const value = y * Math.exp(-x * x);
	return x >= 0 ? value : 2 - value;
}

export function createClaySet(canvas: HTMLCanvasElement, options: ClaySetOptions): ClaySet | undefined {
	if (!supportsClay()) return;
	const gl = canvas.getContext('webgl2', {
		alpha: false,
		antialias: false,
		depth: false,
		preserveDrawingBuffer: false,
		premultipliedAlpha: true,
		stencil: false,
	});
	if (!gl || !REQUIRED_EXTENSIONS.every((name) => gl.getExtension(name) !== null)) return;

	const gpu = createGpu(gl);
	const { target, bindTexture, drawTo } = gpu;
	let roundProgram: WebGLProgram;
	let heightProgram: WebGLProgram;
	let lightProgram: WebGLProgram;
	let developProgram: WebGLProgram;
	let softenProgram: WebGLProgram;
	let logoFootprint: WebGLTexture;
	let textFootprint: WebGLTexture;
	// Blonky's outline as uploaded, and his shadow, blurred from it.
	let figureOutline: WebGLTexture;
	let figureShadow: WebGLTexture;
	let logoVolume: WebGLTexture;
	// The letters' footprint, softened across their bevel.
	let textShape: WebGLTexture;
	// The largest viewport the GPU draws, and the longest side a target can
	// have and still be drawn to whole.
	let maxViewport = [0, 0];
	let maxTargetSize = 0;

	const setup = (): void => {
		gpu.setup();
		maxViewport = [...gl.getParameter(gl.MAX_VIEWPORT_DIMS)];
		maxTargetSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), ...maxViewport);
		roundProgram = program(gl, SET_ROUND_FRAGMENT);
		heightProgram = program(gl, SET_HEIGHT_FRAGMENT);
		lightProgram = program(gl, SET_LIGHT_FRAGMENT);
		developProgram = program(gl, SET_DEVELOP_FRAGMENT);
		softenProgram = program(gl, SET_SOFTEN_FRAGMENT);
		logoFootprint = createTexture(gl);
		textFootprint = createTexture(gl);
		figureOutline = createTexture(gl);
		figureShadow = createTexture(gl);
		logoVolume = createTexture(gl);
		textShape = createTexture(gl);
		layoutDirty = true;
	};

	// The page, in CSS pixels, and the canvas's pixels per CSS pixel. The set
	// is worked at a size within the GPU's limits and the pixel budget, with
	// its own pixels per CSS pixel, and only developed at the canvas's.
	let viewport = { width: 1, height: 1 };
	let pixelRatio = 1;
	let work = { width: 1, height: 1 };
	let workRatio = 1;
	// Page pixels per bust unit, from Blonky's size on the page.
	let unit = 1;
	let logoDomain: Domain = { left: 0, top: 0, width: 1, height: 1 };
	let textDomain: Domain = { left: 0, top: 0, width: 1, height: 1 };
	let wall: [number, number, number] = [0.5, 0.5, 0.5];
	let textColor: [number, number, number] = [1, 1, 1];
	let logoColor: [number, number, number] = [1, 0.8, 0.87];
	let layoutDirty = true;
	let textDirty = true;
	let frame = 0;
	let hasFigure = false;
	let figureRect = { left: 0, top: 0, width: 1, height: 1 };
	let lastExposure = 0;
	let request: number | undefined;
	let fallback: number | undefined;
	const pieceCanvas = document.createElement('canvas');
	const figureCanvas = document.createElement('canvas');

	const pieceContext = (domain: Domain): CanvasRenderingContext2D => {
		pieceCanvas.width = Math.ceil(domain.width / PIECE_TEXEL);
		pieceCanvas.height = Math.ceil(domain.height / PIECE_TEXEL);
		const ctx = pieceCanvas.getContext('2d')!;
		ctx.setTransform(1 / PIECE_TEXEL, 0, 0, 1 / PIECE_TEXEL, -domain.left / PIECE_TEXEL, -domain.top / PIECE_TEXEL);
		ctx.clearRect(domain.left, domain.top, domain.width, domain.height);
		return ctx;
	};

	const upload = (texture: WebGLTexture, source: TexImageSource): void => {
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
	};

	/** Rounds a footprint's drawing, then rolls it into a volume. */
	const roll = (name: string, footprint: WebGLTexture, rounding: number, growth = 0): WebGLTexture => {
		const width = pieceCanvas.width;
		const height = pieceCanvas.height;
		const sigma = rounding / PIECE_TEXEL;
		const blurred = gpu.blur(`${name}-round-v`, footprint, width, height, [sigma, sigma, sigma]);
		const rounded = target(`${name}-rounded`, width, height);
		gl.useProgram(roundProgram);
		gl.uniform1f(gl.getUniformLocation(roundProgram, 'u_sharpness'), 2.5066 * sigma);
		// The blurred edge falls from 1 to 0 as a gaussian's tail: the level
		// at `growth` past the drawn edge.
		gl.uniform1f(gl.getUniformLocation(roundProgram, 'u_level'), 0.5 * erfc(growth / rounding / Math.SQRT2));
		bindTexture(roundProgram, 'u_blurred', 0, blurred.texture);
		drawTo(rounded, width, height);
		return gpu.inflate(name, rounded.texture, { width, height }, PIECE_TEXEL, PIECE_LEVELS).texture;
	};

	const pageRect = (element: Element): Domain => {
		const page = canvas.getBoundingClientRect();
		const rect = element.getBoundingClientRect();
		return { left: rect.left - page.left, top: rect.top - page.top, width: rect.width, height: rect.height };
	};

	const grow = (rect: Domain, margin: number): Domain => ({
		left: rect.left - margin,
		top: rect.top - margin,
		width: rect.width + 2 * margin,
		height: rect.height + 2 * margin,
	});

	const buildLogo = (): void => {
		logoDomain = grow(pageRect(options.logo), PIECE_MARGIN);
		const rect = pageRect(options.logo);
		const ctx = pieceContext(logoDomain);
		if (options.logo.complete && options.logo.naturalWidth > 0) {
			ctx.drawImage(options.logo, rect.left, rect.top, rect.width, rect.height);
			logoColor = averageColor(ctx);
		}
		ctx.globalCompositeOperation = 'source-in';
		ctx.fillStyle = '#fff';
		ctx.fillRect(logoDomain.left, logoDomain.top, logoDomain.width, logoDomain.height);
		upload(logoFootprint, pieceCanvas);
		logoVolume = roll('logo', logoFootprint, LOGO_ROUNDING, LOGO_GROWTH);
	};

	/**
	 * The aphorism as typed so far, letter by letter where the page sets it,
	 * with the cursor while it shows. Letters are cut from the bold of the
	 * page's font, so their thin strokes are sturdy enough to stand as clay.
	 */
	const buildText = (): void => {
		const container = options.aphorism.parentElement ?? options.aphorism;
		textDomain = grow(pageRect(container), PIECE_MARGIN);
		const ctx = pieceContext(textDomain);
		const style = getComputedStyle(options.aphorism);
		textColor = parseColor(style.color);
		ctx.font = `700 ${style.fontSize} ${style.fontFamily}`;
		ctx.fillStyle = '#fff';
		ctx.textBaseline = 'alphabetic';
		const metrics = ctx.measureText('M');
		const ascent = metrics.fontBoundingBoxAscent;
		const descent = metrics.fontBoundingBoxDescent;
		const page = canvas.getBoundingClientRect();
		const range = document.createRange();
		const walker = document.createTreeWalker(options.aphorism, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const text = node.textContent ?? '';
			for (let index = 0; index < text.length; index++) {
				if (text[index].trim() === '') continue;
				range.setStart(node, index);
				range.setEnd(node, index + 1);
				const rect = range.getBoundingClientRect();
				if (rect.width === 0) continue;
				const baseline = rect.top - page.top + (rect.height - ascent - descent) / 2 + ascent;
				ctx.fillText(text[index], rect.left - page.left, baseline);
			}
		}
		// The cursor, while it blinks on.
		for (const cursor of options.aphorism.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')) {
			if (Number.parseFloat(cursor.style.opacity || '1') < 0.5) continue;
			const rect = pageRect(cursor);
			ctx.fillRect(rect.left, rect.top, Math.max(rect.width, 2.5), rect.height);
		}
		upload(textFootprint, pieceCanvas);
		const sigma = TEXT_BEVEL / PIECE_TEXEL;
		textShape = gpu.blur('text-bevel', textFootprint, pieceCanvas.width, pieceCanvas.height, [sigma, sigma, sigma]).texture;
	};

	const layout = (): void => {
		const rect = canvas.getBoundingClientRect();
		viewport = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
		pixelRatio = Math.min(MAX_PIXEL_RATIO, Math.max(1, devicePixelRatio || 1));
		const width = Math.round(viewport.width * pixelRatio);
		const height = Math.round(viewport.height * pixelRatio);
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		const scale = Math.min(
			1,
			maxTargetSize / Math.max(width, height),
			Math.sqrt(MAX_WORK_PIXELS / (width * height)),
		);
		work = { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
		workRatio = pixelRatio * scale;
		const figure = options.figure();
		const view = BLONKY_VIEWPORTS.portrait;
		if (figure) unit = (figure.getBoundingClientRect().width / view.width) * 0.56;
		const background = parseColor(getComputedStyle(document.body).backgroundColor);
		wall = background.map((value, index) => toLinear(value) / WALL_LIGHT[index]) as [number, number, number];
	};

	/** Shapes and lights the set over a region of the page, if given. */
	const sculpt = (region?: Domain): void => {
		const { width, height } = work;
		const surface = target('surface', width, height, true);
		const lit = target('lit', width, height);
		if (region) {
			gl.enable(gl.SCISSOR_TEST);
			gl.scissor(
				Math.floor(region.left * workRatio),
				Math.floor((viewport.height - region.top - region.height) * workRatio),
				Math.ceil(region.width * workRatio),
				Math.ceil(region.height * workRatio),
			);
		}
		const domain = (programRef: WebGLProgram, name: string, value: Domain): void => {
			gl.uniform4f(gl.getUniformLocation(programRef, name), value.left, value.top, value.width, value.height);
		};

		gl.useProgram(heightProgram);
		gl.uniform2f(gl.getUniformLocation(heightProgram, 'u_viewport'), viewport.width, viewport.height);
		gl.uniform1f(gl.getUniformLocation(heightProgram, 'u_unit'), unit);
		domain(heightProgram, 'u_logoDomain', logoDomain);
		domain(heightProgram, 'u_textDomain', textDomain);
		bindTexture(heightProgram, 'u_logo', 0, logoVolume);
		bindTexture(heightProgram, 'u_text', 1, textShape);
		drawTo(surface, width, height);

		gl.useProgram(lightProgram);
		gl.uniform2f(gl.getUniformLocation(lightProgram, 'u_viewport'), viewport.width, viewport.height);
		gl.uniform2f(gl.getUniformLocation(lightProgram, 'u_texel'), 1 / width, 1 / height);
		gl.uniform1f(gl.getUniformLocation(lightProgram, 'u_pixel'), 1 / workRatio);
		gl.uniform1f(gl.getUniformLocation(lightProgram, 'u_unit'), unit);
		gl.uniform3f(gl.getUniformLocation(lightProgram, 'u_wall'), ...wall);
		gl.uniform3f(gl.getUniformLocation(lightProgram, 'u_textColor'), ...textColor.map(toLinear) as [number, number, number]);
		gl.uniform4f(gl.getUniformLocation(lightProgram, 'u_pool'), viewport.width / 2, viewport.height * 0.42, viewport.width * 0.6, viewport.height * 0.7);
		bindTexture(lightProgram, 'u_height', 0, surface.texture);
		gl.uniform3f(gl.getUniformLocation(lightProgram, 'u_logoColor'), ...logoColor.map(toLinear) as [number, number, number]);
		drawTo(lit, width, height);
		gl.disable(gl.SCISSOR_TEST);
		soften(lit.texture);
	};

	/** The lit wall, out of focus, at half the working resolution. */
	const soften = (lit: WebGLTexture): void => {
		const width = Math.ceil(work.width / 2);
		const height = Math.ceil(work.height / 2);
		const horizontal = target('soft-h', width, height);
		const vertical = target('soft', width, height);
		const sigma = (WALL_DEFOCUS * workRatio) / 2;
		gl.useProgram(softenProgram);
		gl.uniform1f(gl.getUniformLocation(softenProgram, 'u_sigma'), sigma);
		gl.uniform1i(gl.getUniformLocation(softenProgram, 'u_radius'), Math.ceil(sigma * 3));
		gl.uniform1i(gl.getUniformLocation(softenProgram, 'u_weigh'), 1);
		gl.uniform2f(gl.getUniformLocation(softenProgram, 'u_step'), 1 / width, 0);
		bindTexture(softenProgram, 'u_source', 0, lit);
		drawTo(horizontal, width, height);
		gl.uniform1i(gl.getUniformLocation(softenProgram, 'u_weigh'), 0);
		gl.uniform2f(gl.getUniformLocation(softenProgram, 'u_step'), 0, 1 / height);
		bindTexture(softenProgram, 'u_source', 0, horizontal.texture);
		drawTo(vertical, width, height);
	};

	/** Develops the lit set for the current exposure, onto the canvas. */
	const develop = (): void => {
		gl.useProgram(developProgram);
		gl.uniform2f(gl.getUniformLocation(developProgram, 'u_viewport'), viewport.width, viewport.height);
		gl.uniform1f(gl.getUniformLocation(developProgram, 'u_exposure'), exposureFlicker(frame));
		gl.uniform1f(gl.getUniformLocation(developProgram, 'u_frame'), frame);
		gl.uniform1f(gl.getUniformLocation(developProgram, 'u_hasFigure'), hasFigure ? 1 : 0);
		gl.uniform4f(gl.getUniformLocation(developProgram, 'u_figureRect'), figureRect.left, figureRect.top, figureRect.width, figureRect.height);
		gl.uniform2f(
			gl.getUniformLocation(developProgram, 'u_figureOffset'),
			-TOWARD_KEY.x * FIGURE_DISTANCE * unit,
			-TOWARD_KEY.y * FIGURE_DISTANCE * unit,
		);
		bindTexture(developProgram, 'u_lit', 0, target('lit', work.width, work.height).texture);
		bindTexture(developProgram, 'u_figure', 1, figureShadow);
		bindTexture(developProgram, 'u_soft', 2, target('soft', Math.ceil(work.width / 2), Math.ceil(work.height / 2)).texture);
		// The canvas's drawing buffer can be larger than one viewport covers,
		// so it's developed in tiles, each pixel finding its place by its own
		// position.
		const bufferWidth = gl.drawingBufferWidth;
		const bufferHeight = gl.drawingBufferHeight;
		gl.uniform2f(gl.getUniformLocation(developProgram, 'u_size'), bufferWidth, bufferHeight);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		const [tileWidth, tileHeight] = maxViewport;
		for (let y = 0; y < bufferHeight; y += tileHeight) {
			for (let x = 0; x < bufferWidth; x += tileWidth) {
				gl.viewport(x, y, Math.min(tileWidth, bufferWidth - x), Math.min(tileHeight, bufferHeight - y));
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
		}
	};

	const render = (): void => {
		request = undefined;
		if (gl.isContextLost()) return;
		if (layoutDirty) {
			layout();
			// His shadow was last shaded for the old layout: place it and
			// soften it again at his new size, from his last outline.
			const figure = options.figure();
			if (hasFigure && figure) {
				placeFigure(figure);
				shadeFigure();
			}
			buildLogo();
			buildText();
			sculpt();
			layoutDirty = false;
			textDirty = false;
		} else if (textDirty) {
			// Only the aphorism changed: reshape and relight around it, as far
			// as its shadow and occlusion reach.
			const before = textDomain;
			buildText();
			const reach = PIECE_SHADOW_REACH * unit;
			const left = Math.min(before.left, textDomain.left) - reach;
			const top = Math.min(before.top, textDomain.top) - reach;
			const right = Math.max(before.left + before.width, textDomain.left + textDomain.width) + reach;
			const bottom = Math.max(before.top + before.height, textDomain.top + textDomain.height) + reach;
			sculpt({ left, top, width: right - left, height: bottom - top });
			textDirty = false;
		}
		develop();
	};

	// Changes are developed with Blonky's next exposure, so the set moves in
	// his stop-motion steps. If he hasn't exposed lately (paused, or out of
	// view), they're developed straight away; if the next exposure doesn't
	// come after all, they're developed once it would have.
	const invalidate = (): void => {
		if (request !== undefined || fallback !== undefined) return;
		const wait = lastExposure + EXPOSURE_WINDOW_MS - performance.now();
		if (wait <= 0) {
			request = requestAnimationFrame(render);
			return;
		}
		fallback = window.setTimeout(() => {
			fallback = undefined;
			request = requestAnimationFrame(render);
		}, wait);
	};
	const cancelScheduled = (): void => {
		if (request !== undefined) cancelAnimationFrame(request);
		request = undefined;
		window.clearTimeout(fallback);
		fallback = undefined;
	};

	/** Blurs Blonky's outline, as last exposed, into his shadow on the wall. */
	const shadeFigure = (): void => {
		const { width, height } = figureCanvas;
		upload(figureOutline, figureCanvas);
		// Soften by his size on the page.
		const sigma = (FIGURE_SOFTNESS * unit * width) / Math.max(1, figureRect.width);
		figureShadow = gpu.blur('figure', figureOutline, width, height, [sigma, sigma, sigma]).texture;
	};

	/** Where Blonky's canvas sits on the page, with room for his shadow. */
	const placeFigure = (figure: HTMLCanvasElement): void => {
		const page = canvas.getBoundingClientRect();
		const rect = figure.getBoundingClientRect();
		const padX = rect.width * FIGURE_PAD;
		const padY = rect.height * FIGURE_PAD;
		figureRect = {
			left: rect.left - page.left - padX,
			top: rect.top - page.top - padY,
			width: rect.width + 2 * padX,
			height: rect.height + 2 * padY,
		};
	};

	const expose = (nextFrame: number, outline: HTMLCanvasElement): void => {
		frame = nextFrame;
		lastExposure = performance.now();
		const figure = options.figure();
		if (figure) {
			placeFigure(figure);
			const inner = { width: outline.width * FIGURE_SCALE, height: outline.height * FIGURE_SCALE };
			const width = Math.max(1, Math.round(inner.width * (1 + 2 * FIGURE_PAD)));
			const height = Math.max(1, Math.round(inner.height * (1 + 2 * FIGURE_PAD)));
			if (figureCanvas.width !== width) figureCanvas.width = width;
			if (figureCanvas.height !== height) figureCanvas.height = height;
			const ctx = figureCanvas.getContext('2d')!;
			ctx.clearRect(0, 0, width, height);
			ctx.drawImage(outline, inner.width * FIGURE_PAD, inner.height * FIGURE_PAD, inner.width, inner.height);
			shadeFigure();
			hasFigure = true;
		}
		cancelScheduled();
		render();
	};

	const observers: { disconnect: () => void }[] = [];
	const onLayout = (): void => {
		layoutDirty = true;
		invalidate();
	};
	const resize = new ResizeObserver(onLayout);
	resize.observe(canvas);
	observers.push(resize);
	const theme = new MutationObserver(onLayout);
	theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	observers.push(theme);
	const text = new MutationObserver(() => {
		textDirty = true;
		invalidate();
	});
	text.observe(options.aphorism, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] });
	observers.push(text);
	if (!options.logo.complete) options.logo.addEventListener('load', onLayout, { once: true });
	void document.fonts?.ready.then(onLayout);

	const onContextLost = (event: Event): void => event.preventDefault();
	// The GPU can refuse the set's targets without throwing, leaving it
	// nothing to draw.
	const gpuFailed = (): boolean => {
		const error = gl.getError();
		return gl.isContextLost() || error === gl.OUT_OF_MEMORY || error === gl.INVALID_FRAMEBUFFER_OPERATION;
	};
	const onContextRestored = (): void => {
		try {
			setup();
			// Every target was recreated empty, Blonky's shadow among them, so
			// shade it again from his last outline and repaint now rather than
			// wait for an exposure that may not come.
			if (hasFigure) shadeFigure();
			cancelScheduled();
			render();
			if (gpuFailed()) throw new Error('The clay set could not be restored');
		} catch (error) {
			// Without the set the page's own logo and aphorism must show again:
			// its owner is told, to fall back to ink.
			console.error(error);
			destroy();
			options.onFail?.();
		}
	};
	canvas.addEventListener('webglcontextlost', onContextLost);
	canvas.addEventListener('webglcontextrestored', onContextRestored);

	const destroy = (): void => {
		cancelScheduled();
		for (const observer of observers) observer.disconnect();
		options.logo.removeEventListener('load', onLayout);
		canvas.removeEventListener('webglcontextlost', onContextLost);
		canvas.removeEventListener('webglcontextrestored', onContextRestored);
	};

	try {
		setup();
	} catch (error) {
		console.error(error);
		destroy();
		return;
	}
	render();
	// Report a set that can't draw as a failure rather than show a blank wall.
	if (gpuFailed()) {
		destroy();
		return;
	}

	return { expose, destroy };
}
