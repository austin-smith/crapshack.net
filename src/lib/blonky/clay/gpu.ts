import {
	BLUR_FRAGMENT,
	FULLSCREEN_VERTEX,
	VOLUME_EXPAND_FRAGMENT,
	VOLUME_REDUCE_FRAGMENT,
	VOLUME_RELAX_FRAGMENT,
} from './shaders';

/**
 * WebGL2 plumbing shared by everything drawn in clay: programs, render
 * targets, separable blurs, and the multigrid solve that inflates a
 * footprint into a round volume.
 */

export interface Target {
	framebuffer: WebGLFramebuffer;
	texture: WebGLTexture;
	width: number;
	height: number;
}

/** One level of an inflation solve: its texel spacing, and its sweeps. */
export interface SolveLevel {
	spacing: number;
	sweeps: number;
}

// Float targets hold the solved volumes and the surface; filtering them
// keeps the clay smooth between texels.
export const REQUIRED_EXTENSIONS = ['EXT_color_buffer_float', 'OES_texture_float_linear'];
// How long a lost context is waited for. Browsers usually give it back well
// within a second, but can refuse, as after repeated GPU resets; past this,
// clay gives way to ink rather than stay blank.
export const CONTEXT_RESTORE_TIMEOUT_MS = 3000;
let claySupport: boolean | undefined;

// Probe once on a throwaway canvas: a canvas that has handed out a WebGL
// context can no longer fall back to 2D ink.
export function supportsClay(): boolean {
	if (claySupport !== undefined) return claySupport;
	const probe = document.createElement('canvas').getContext('webgl2');
	claySupport = probe !== null && REQUIRED_EXTENSIONS.every((name) => probe.getExtension(name) !== null);
	probe?.getExtension('WEBGL_lose_context')?.loseContext();
	return claySupport;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type)!;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
		throw new Error(gl.getShaderInfoLog(shader) ?? 'Clay shader failed to compile');
	}
	return shader;
}

export function program(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
	const result = gl.createProgram()!;
	gl.attachShader(result, compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX));
	gl.attachShader(result, compile(gl, gl.FRAGMENT_SHADER, fragment));
	gl.bindAttribLocation(result, 0, 'a_position');
	gl.linkProgram(result);
	if (!gl.getProgramParameter(result, gl.LINK_STATUS) && !gl.isContextLost()) {
		throw new Error(gl.getProgramInfoLog(result) ?? 'Clay program failed to link');
	}
	return result;
}

export function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
	const texture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return texture;
}

export interface Gpu {
	gl: WebGL2RenderingContext;
	/** (Re)creates the shared programs and geometry, and drops all targets. */
	setup: () => void;
	/** A named render target, reused while its size holds. */
	target: (name: string, width: number, height: number, precise?: boolean) => Target;
	bindTexture: (programRef: WebGLProgram, name: string, unit: number, texture: WebGLTexture) => void;
	/** Runs the current program over a whole target (or the canvas). */
	drawTo: (output: Target | null, width: number, height: number) => void;
	/**
	 * Separable gaussian of `source` into a `width` x `height` target, with a
	 * sigma per channel in target texels.
	 */
	blur: (
		name: string,
		source: WebGLTexture,
		width: number,
		height: number,
		sigma: readonly [number, number, number],
		radius?: number,
		scratch?: string,
	) => Target;
	/**
	 * Inflates a footprint into round volumes, per channel, coarsest level
	 * first. The finest level is the footprint itself, `unitsPerTexel` units
	 * a texel; each level's depths come out in those units squared.
	 */
	inflate: (
		name: string,
		footprint: WebGLTexture,
		size: { width: number; height: number },
		unitsPerTexel: number,
		levels: readonly SolveLevel[],
	) => Target;
}

export function createGpu(gl: WebGL2RenderingContext): Gpu {
	let blurProgram: WebGLProgram;
	let reduceProgram: WebGLProgram;
	let relaxProgram: WebGLProgram;
	let expandProgram: WebGLProgram;
	let targets = new Map<string, Target>();

	const setup = (): void => {
		// Extensions are reset along with a lost context.
		for (const name of REQUIRED_EXTENSIONS) gl.getExtension(name);
		blurProgram = program(gl, BLUR_FRAGMENT);
		reduceProgram = program(gl, VOLUME_REDUCE_FRAGMENT);
		relaxProgram = program(gl, VOLUME_RELAX_FRAGMENT);
		expandProgram = program(gl, VOLUME_EXPAND_FRAGMENT);
		gl.bindVertexArray(gl.createVertexArray());
		gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		targets = new Map();
	};

	const target = (name: string, width: number, height: number, precise = false): Target => {
		const existing = targets.get(name);
		if (existing && existing.width === width && existing.height === height) return existing;
		if (existing) {
			gl.deleteFramebuffer(existing.framebuffer);
			gl.deleteTexture(existing.texture);
		}
		const texture = createTexture(gl);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			precise ? gl.RGBA32F : gl.RGBA16F,
			width,
			height,
			0,
			gl.RGBA,
			precise ? gl.FLOAT : gl.HALF_FLOAT,
			null,
		);
		const framebuffer = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		const created = { framebuffer, texture, width, height };
		targets.set(name, created);
		return created;
	};

	const bindTexture = (programRef: WebGLProgram, name: string, unit: number, texture: WebGLTexture): void => {
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(gl.getUniformLocation(programRef, name), unit);
	};

	const drawTo = (output: Target | null, width: number, height: number): void => {
		gl.bindFramebuffer(gl.FRAMEBUFFER, output?.framebuffer ?? null);
		gl.viewport(0, 0, width, height);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	};

	const blur: Gpu['blur'] = (name, source, width, height, sigma, radius, scratch) => {
		const horizontal = target(scratch ?? `${name}-h`, width, height);
		const vertical = target(name, width, height);
		gl.useProgram(blurProgram);
		gl.uniform3f(gl.getUniformLocation(blurProgram, 'u_sigma'), sigma[0], sigma[1], sigma[2]);
		gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_radius'), radius ?? Math.ceil(Math.max(...sigma) * 3));
		bindTexture(blurProgram, 'u_source', 0, source);
		gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_step'), 1 / width, 0);
		drawTo(horizontal, width, height);
		bindTexture(blurProgram, 'u_source', 0, horizontal.texture);
		gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_step'), 0, 1 / height);
		drawTo(vertical, width, height);
		return vertical;
	};

	const inflate: Gpu['inflate'] = (name, footprint, size, unitsPerTexel, levels) => {
		const sizes = levels.map(({ spacing }) => ({
			width: Math.ceil(size.width / spacing),
			height: Math.ceil(size.height / spacing),
		}));
		// Footprints at every level, each averaged down from the one above.
		const finest = sizes.length - 1;
		const masks: WebGLTexture[] = [];
		masks[finest] = footprint;
		gl.useProgram(reduceProgram);
		for (let level = finest - 1; level >= 0; level--) {
			const { width, height } = sizes[level];
			const reduced = target(`${name}-mask-${levels[level].spacing}`, width, height);
			bindTexture(reduceProgram, 'u_source', 0, masks[level + 1]);
			drawTo(reduced, width, height);
			masks[level] = reduced.texture;
		}

		let solution: Target | undefined;
		levels.forEach(({ spacing, sweeps }, level) => {
			const { width, height } = sizes[level];
			const buffers = [
				target(`${name}-a-${spacing}`, width, height, true),
				target(`${name}-b-${spacing}`, width, height, true),
			];
			if (solution) {
				gl.useProgram(expandProgram);
				bindTexture(expandProgram, 'u_coarse', 0, solution.texture);
				bindTexture(expandProgram, 'u_mask', 1, masks[level]);
				drawTo(buffers[0], width, height);
			} else {
				gl.bindFramebuffer(gl.FRAMEBUFFER, buffers[0].framebuffer);
				gl.clearColor(0, 0, 0, 0);
				gl.clear(gl.COLOR_BUFFER_BIT);
			}
			const texel = spacing * unitsPerTexel;
			gl.useProgram(relaxProgram);
			gl.uniform1f(gl.getUniformLocation(relaxProgram, 'u_source'), 4 * texel * texel);
			bindTexture(relaxProgram, 'u_mask', 1, masks[level]);
			for (let sweep = 0; sweep < sweeps; sweep++) {
				bindTexture(relaxProgram, 'u_volume', 0, buffers[sweep % 2].texture);
				drawTo(buffers[(sweep + 1) % 2], width, height);
			}
			solution = buffers[sweeps % 2];
		});
		return solution!;
	};

	return { gl, setup, target, bindTexture, drawTo, blur, inflate };
}
