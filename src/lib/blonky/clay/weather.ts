import { createGpu, program } from './gpu';
import { LAMP } from './shaders';

/**
 * The page's weather in clay, in front of the set: rain as drops of clear
 * resin, as stop-motion rain often is, and snow as balls of white clay.
 * Each is lit by the set's lamp once,
 * into a sprite, then placed per exposure, so the weather moves in Blonky's
 * stop-motion steps: a bead jumps a little way each frame, as if the
 * animator nudged every one along its wire.
 */

export type ClayWeatherKind = 'rain' | 'snow';

export interface ClayWeather {
	/** Places the weather for an exposure. */
	expose: (frame: number) => void;
	setKind: (kind: ClayWeatherKind | undefined) => void;
	destroy: () => void;
}

// Sprites: rain beads, then snow balls, each cell this many sprite pixels
// square, and about this many sprite pixels to a page pixel where drawn.
const CELL = 64;
const SPRITE_DENSITY = 3;
const VARIANTS = 4;
const RAIN_COUNT = 100;
const SNOW_COUNT = 100;
const MAX_PIXEL_RATIO = 2;

/** One cell of the sprite sheet, lit: rain beads on the left, snow on the right. */
const SPRITE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
${LAMP}
uniform vec2 u_size;
out vec4 outColor;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

void main() {
	// Sheet pixels, y down, and which cell this is.
	vec2 px = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
	float cell = floor(px.x / ${CELL}.0);
	vec2 local = (px - vec2(cell * ${CELL}.0, 0.0)) / ${CELL}.0 - 0.5;
	bool snow = cell >= ${VARIANTS}.0;
	float variant = mod(cell, ${VARIANTS}.0);

	vec3 albedo;
	vec2 radius;
	vec2 q;
	if (snow) {
		// A little ball, pressed a touch out of round.
		radius = vec2(0.42, 0.4 + 0.03 * hash(variant + 3.0));
		q = local / radius;
		albedo = vec3(0.93, 0.94, 0.96);
	} else {
		// A drop drawn out as it falls: round below, tapering to a point on
		// top.
		radius = vec2(0.1 + 0.015 * hash(variant), 0.46);
		vec2 d = local;
		float taper = mix(1.0, 0.3, smoothstep(0.15, -0.46, d.y));
		q = vec2(d.x / (radius.x * taper), d.y / radius.y);
		albedo = vec3(0.0);
	}
	float r2 = dot(q, q);
	// Antialiased outline, about a page pixel wide where it's drawn.
	float coverage = clamp((1.0 - sqrt(r2)) * min(radius.x, radius.y) * ${CELL}.0 / ${SPRITE_DENSITY}.0, 0.0, 1.0);
	if (coverage <= 0.0) {
		outColor = vec4(0.0);
		return;
	}
	vec3 n = normalize(vec3(q.x, -q.y, sqrt(max(1.0 - r2, 0.0)) * 1.2));
	if (!snow) {
		// Clear resin: the wall shows through its middle, tinted and
		// brightened a little by what it gathers; its rim, turned away,
		// bends the light and reads darker; and the lamp catches it in one
		// bright glint.
		float rim = pow(1.0 - n.z, 1.5);
		vec3 body = mix(vec3(0.8, 0.9, 1.0), vec3(0.2, 0.3, 0.45), rim);
		float alpha = mix(0.22, 0.75, rim);
		vec3 halfway = normalize(KEY_DIR + vec3(0.0, 0.0, 1.0));
		float glint = pow(max(0.0, dot(n, halfway)), 40.0);
		vec3 color = develop(body * 0.9 + KEY * glint * 1.4, 0.0);
		alpha = clamp(alpha + glint, 0.0, 1.0) * coverage;
		outColor = vec4(color * alpha, alpha);
		return;
	}
	float keyDiffuse = max(0.0, (dot(n, KEY_DIR) + 0.05) / 1.05);
	float fillDiffuse = max(0.0, (dot(n, FILL_DIR) + 0.3) / 1.3);
	float sky = 0.55 + 0.45 * n.z;
	vec3 lit = albedo * (KEY * keyDiffuse + FILL * fillDiffuse + AMBIENT * sky);
	vec3 halfway = normalize(KEY_DIR + vec3(0.0, 0.0, 1.0));
	// Snow's clay has a soft, waxy sheen.
	float gloss = 12.0;
	float strength = 0.08;
	lit += KEY * pow(max(0.0, dot(n, halfway)), gloss) * strength * (gloss + 8.0) / 24.0;
	outColor = vec4(develop(lit, 0.0) * coverage, coverage);
}
`;

/** A deterministic hash in [0, 1), per particle and key. */
function hash(index: number, key: number): number {
	const value = Math.sin(index * 127.1 + key * 311.7) * 43758.5453;
	return value - Math.floor(value);
}

export function createClayWeather(canvas: HTMLCanvasElement): ClayWeather | undefined {
	const context = canvas.getContext('2d');
	if (!context) return;

	// Light the sprite sheet once, with WebGL, then keep it as a 2D image.
	const sheet = document.createElement('canvas');
	sheet.width = CELL * VARIANTS * 2;
	sheet.height = CELL;
	const gl = sheet.getContext('webgl2', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
	if (!gl) return;
	const gpu = createGpu(gl);
	try {
		gpu.setup();
		const sprite = program(gl, SPRITE_FRAGMENT);
		gl.useProgram(sprite);
		gl.uniform2f(gl.getUniformLocation(sprite, 'u_size'), sheet.width, sheet.height);
		gpu.drawTo(null, sheet.width, sheet.height);
	} catch (error) {
		console.error(error);
		return;
	}
	const sprites = document.createElement('canvas');
	sprites.width = sheet.width;
	sprites.height = sheet.height;
	sprites.getContext('2d')!.drawImage(sheet, 0, 0);
	gl.getExtension('WEBGL_lose_context')?.loseContext();

	let kind: ClayWeatherKind | undefined;
	let frame = 0;

	const size = (): { width: number; height: number; ratio: number } => {
		const rect = canvas.getBoundingClientRect();
		const ratio = Math.min(MAX_PIXEL_RATIO, Math.max(1, devicePixelRatio || 1));
		const width = Math.round(rect.width * ratio);
		const height = Math.round(rect.height * ratio);
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		return { width: rect.width, height: rect.height, ratio };
	};

	const draw = (): void => {
		const { width, height, ratio } = size();
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height);
		if (!kind) return;
		const count = kind === 'rain' ? RAIN_COUNT : SNOW_COUNT;
		for (let index = 0; index < count; index++) {
			// Near beads are bigger and quicker than far ones.
			const depth = hash(index, 1);
			const variant = Math.floor(hash(index, 2) * VARIANTS);
			const x0 = hash(index, 3) * width;
			const phase = hash(index, 4);
			// Fall time in exposures, as in the ink weather.
			const seconds = kind === 'rain' ? 1.5 + (1 - depth) * 2.5 : 6 + (1 - depth) * 6;
			const exposures = seconds * 8;
			const drawn = kind === 'rain' ? 12 + depth * 10 : 4 + depth * 4;
			const travel = height + drawn * 2;
			const progress = (phase + frame / exposures) % 1;
			let x = x0;
			let y = progress * travel - drawn;
			if (kind === 'snow') {
				// Snow drifts side to side as it falls.
				x += Math.sin(progress * Math.PI * 2 * (1 + hash(index, 5)) + hash(index, 6) * 6.28) * 14;
			}
			// No bead is placed exactly on its path, frame to frame.
			x += (hash(index, frame + 7) - 0.5) * 0.8;
			y += (hash(index, frame + 11) - 0.5) * 0.8;
			const cell = (kind === 'snow' ? VARIANTS : 0) + variant;
			context.globalAlpha = kind === 'rain' ? 0.7 + depth * 0.3 : 0.8 + depth * 0.2;
			context.drawImage(sprites, cell * CELL, 0, CELL, CELL, x - drawn / 2, y - drawn / 2, drawn, drawn);
		}
		context.globalAlpha = 1;
	};

	return {
		expose: (next) => {
			frame = next;
			draw();
		},
		setKind: (next) => {
			kind = next;
			draw();
		},
		destroy: () => {
			context.clearRect(0, 0, canvas.width, canvas.height);
		},
	};
}
