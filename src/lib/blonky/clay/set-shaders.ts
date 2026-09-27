import { CLAY_MARKS, LAMP, SHARED_NOISE, SMOOTH_SAMPLING } from './shaders';

/**
 * The homepage as a clay set: a plasticine wall in the page's colour, with
 * the logo and the aphorism rolled in clay and pressed onto it, all under the
 * lamp that lights Blonky. Coordinates are the page's CSS pixels, y down.
 */

/** Piece ids in the set's surface. */
export const SET_PIECE = {
	wall: 1,
	logo: 2,
	text: 3,
} as const;

const float = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value));

const SET_SHARED = /* glsl */ `
uniform vec2 u_viewport;
in vec2 v_uv;

// Texture coordinates (y up) to page pixels (y down), and back.
vec2 toPage(vec2 uv) {
	return vec2(uv.x, 1.0 - uv.y) * u_viewport;
}

vec2 toUv(vec2 p) {
	return vec2(p.x, u_viewport.y - p.y) / u_viewport;
}
`;

/**
 * Rounds a drawn footprint the way pressed clay rounds its drawing: its blur,
 * cut at a level, antialiased to about a texel. Cutting below half grows the
 * piece: a fatter coil than the drawing's line.
 */
export const SET_ROUND_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_blurred;
uniform float u_sharpness;
uniform float u_level;
out vec4 outColor;
void main() {
	vec4 blurred = texelFetch(u_blurred, ivec2(gl_FragCoord.xy), 0);
	outColor = clamp(0.5 + (blurred - u_level) * u_sharpness, 0.0, 1.0);
}
`;

/**
 * Soft focus: a separable gaussian over the lit set that takes only the
 * wall, weighted by how much of each sample is wall, so the logo and letters
 * pressed onto it don't smear into it. The first pass weights; the second
 * carries the weighted sums on.
 */
export const SET_SOFTEN_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_step;
uniform float u_sigma;
uniform int u_radius;
uniform bool u_weigh;
in vec2 v_uv;
out vec4 outColor;
vec4 tap(vec2 uv) {
	vec4 value = texture(u_source, uv);
	return u_weigh ? vec4(value.rgb * value.a, value.a) : value;
}
void main() {
	float falloff = 1.0 / (2.0 * u_sigma * u_sigma);
	vec4 sum = tap(v_uv);
	float weight = 1.0;
	for (int i = 1; i <= 64; i++) {
		if (i > u_radius) break;
		float x = float(i);
		float w = exp(-x * x * falloff);
		sum += w * (tap(v_uv + u_step * x) + tap(v_uv - u_step * x));
		weight += 2.0 * w;
	}
	outColor = sum / weight;
}
`;

/** The set's surface: height toward the camera, in page pixels, and piece id. */
export const SET_HEIGHT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
${SHARED_NOISE}
${SMOOTH_SAMPLING}
${CLAY_MARKS}
${SET_SHARED}
// Page pixels per bust unit: the set's clay is worked at Blonky's scale.
uniform float u_unit;
// The logo's solved volume, and the aphorism's footprint softened across
// its bevel, each over its own domain (left, top, width, height in page
// pixels).
uniform sampler2D u_logo;
uniform vec4 u_logoDomain;
uniform sampler2D u_text;
uniform vec4 u_textDomain;
out vec4 outColor;


// A rolled piece's front over the wall, from its solved volume, standing
// its roundness per unit of inflation. A coil is
// only so thick: where strokes join and the drawing widens, the clay is
// pressed flat on top rather than swelling up, with the same round
// shoulder as everywhere else.
// Where it's pressed onto the wall its sides ease out over a fillet about
// the press wide, rather than dropping sheer.
float rolled(sampler2D volume, vec4 domain, vec2 p, float roundness, float thickness, float press) {
	vec2 uv = (p - domain.xy) / domain.zw;
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
	// Stored with texture y running down the domain, as it was drawn.
	float u = max(smoothSample(volume, uv).r, 0.0);
	float h = roundness * (sqrt(u + press * press) - press);
	return thickness * tanh(h / thickness);
}

// How thick the aphorism's cut-out letters stand, in page pixels.
const float TEXT_THICKNESS = 1.6;

// A piece cut from a flat sheet of clay, as thick as its thickness: a flat top in
// the shape of its footprint, whose edge rounds over and down to the wall.
// The footprint's drawn edge is halfway down that round.
float cut(sampler2D shape, vec4 domain, vec2 p, float thickness) {
	vec2 uv = (p - domain.xy) / domain.zw;
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
	float s = clamp((smoothSample(shape, uv).r - 0.08) / 0.84, 0.0, 1.0);
	return thickness * sqrt(1.0 - (1.0 - s) * (1.0 - s));
}

void main() {
	vec2 p = toPage(v_uv);
	// The wall's clay, in bust units, so it's worked like Blonky's: a slab
	// pressed out and smoothed flat by hand. Broad swells where the palm
	// pushed it, soft lumps it didn't quite smooth, and, only where the
	// animator's hands have been at it, thumbprints and the faint ridges of
	// smoothing swipes. Most of it is left alone.
	vec2 q = p / u_unit;
	float handled = smoothstep(0.58, 0.72, noise(q / 260.0 + 21.0));
	float swiped = smoothstep(0.55, 0.7, noise(q / 220.0 + 37.0));
	float broad = (fbm(q / 320.0 + 3.0) - 0.5) * 16.0
		+ (fbm(q / 110.0 + 11.0) - 0.5) * 4.0;
	float fine = (fbm(q / 45.0 + 4.0) - 0.5) * 0.9
		+ (noise(q / 13.0 + 9.0) - 0.5) * 0.2
		+ fingerprints(q, 4.0) * 0.28 * handled
		+ swipes(q, 4.0) * 0.3 * swiped;
	float id = ${float(SET_PIECE.wall)};

	// The logo is rolled in plump coils; the letters are cut out.
	float logo = rolled(u_logo, u_logoDomain, p, 0.95, 14.0, 3.5);
	float text = cut(u_text, u_textDomain, p, TEXT_THICKNESS);
	if (logo > 0.02) id = ${float(SET_PIECE.logo)};
	if (text > 0.02) id = ${float(SET_PIECE.text)};
	// How much of this pixel each piece covers: their edges are blended into
	// the wall by it, rather than stepping from one colour to the next.
	float logoCover = smoothstep(0.0, 1.2, logo);
	float textCover = smoothstep(0.0, 0.5 * TEXT_THICKNESS, text);
	// The pieces were pressed on after the wall was worked, so its prints
	// and swipes don't carry through them; their own clay is handled too,
	// finer for their size.
	float cover = max(logoCover, textCover);
	float marks = (fbm(q / 45.0 + 7.0) - 0.5) * 0.25;
	float z = (broad + mix(fine, marks, cover)) * u_unit + logo + text;
	outColor = vec4(z, textCover, logoCover, id);
}
`;

/**
 * Lights the set, before exposure: the lamp's key with shadows cast by the
 * pieces onto the wall, the fill, and contact occlusion. The light pools
 * behind Blonky and falls off toward the set's edges.
 */
export const SET_LIGHT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
${SHARED_NOISE}
${LAMP}
${SET_SHARED}
uniform sampler2D u_height;
// One shading sample, in texture coordinates, and in page pixels.
uniform vec2 u_texel;
uniform float u_pixel;
uniform float u_unit;
// The clays' colours: the wall's, the page's own; the logo's; and the
// aphorism's.
uniform vec3 u_wall;
uniform vec3 u_logoColor;
uniform vec3 u_textColor;
// Where the light pools: its centre and radii, in page pixels.
uniform vec4 u_pool;
out vec4 outColor;

float heightAt(vec2 p) {
	return texture(u_height, toUv(p)).r;
}

// The lamp's shadow, marched toward it over the surface.
float castShadow(vec2 p, float h) {
	vec2 toward = normalize(KEY_DIR.xy);
	float slope = KEY_DIR.z / length(KEY_DIR.xy);
	float shade = 0.0;
	float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
	for (int i = 0; i < 24; i++) {
		float x = float(i) + jitter;
		float t = (0.6 + 0.5 * x + 0.06 * x * x) * u_unit;
		float over = heightAt(p + toward * t) - (h + t * slope);
		shade = max(shade, clamp(over / (0.4 * t + 1.5 * u_unit), 0.0, 1.0));
	}
	return 1.0 - shade * 0.75;
}

// Contact occlusion: less light reaches the wall right beside a piece.
float occlusion(vec2 p, float h) {
	float occ = 0.0;
	for (int ring = 0; ring < 2; ring++) {
		float radius = (ring == 0 ? 2.5 : 7.0) * u_unit;
		for (int i = 0; i < 8; i++) {
			float angle = (float(i) + 0.5 * float(ring)) * 0.7854;
			float rise = heightAt(p + vec2(cos(angle), sin(angle)) * radius) - h;
			occ += clamp(rise / (radius * 1.6), 0.0, 1.0);
		}
	}
	return 1.0 - clamp(occ / 16.0 * 1.35, 0.0, 0.85);
}

void main() {
	vec2 p = toPage(v_uv);
	vec4 surface = texture(u_height, v_uv);
	float id = floor(surface.a + 0.5);
	float h = surface.r;

	vec2 slope;
	for (int axis = 0; axis < 2; axis++) {
		vec2 offset = axis == 0 ? vec2(u_texel.x, 0.0) : vec2(0.0, u_texel.y);
		float before = texture(u_height, v_uv - offset).r;
		float after = texture(u_height, v_uv + offset).r;
		// Texture y runs up; page y runs down.
		slope[axis] = (after - before) / (2.0 * u_pixel) * (axis == 0 ? 1.0 : -1.0);
	}
	vec3 n = normalize(vec3(-slope, 1.0));

	// The drawing's pale pink, mixed richer and a shade deeper in the clay,
	// so it reads as pink plasticine and its highlights have room.
	float luma = dot(u_logoColor, vec3(0.2126, 0.7152, 0.0722));
	vec3 pink = max(mix(vec3(luma), u_logoColor, 1.45), 0.0) * 0.84;
	// Each piece's edge blends into the wall by how much of it covers here.
	vec3 albedo = mix(mix(u_wall, pink, surface.b), u_textColor, surface.g);
	// Plasticine is never one flat colour.
	albedo *= 0.96 + 0.07 * fbm(p / u_unit / 60.0 + id * 1.7);

	float shadow = castShadow(p, h);
	float ao = occlusion(p, h);
	float keyDiffuse = max(0.0, (dot(n, KEY_DIR) + 0.05) / 1.05);
	float fillDiffuse = max(0.0, (dot(n, FILL_DIR) + 0.3) / 1.3);
	float sky = 0.55 + 0.45 * n.z;
	// The lamp is a spot: it pools behind Blonky and falls off to the sides.
	vec2 fromPool = (p - u_pool.xy) / u_pool.zw;
	float pool = 0.62 + 0.5 * exp(-dot(fromPool, fromPool) * 1.3);
	vec3 light = KEY * keyDiffuse * shadow * pool + FILL * fillDiffuse * mix(0.6, 1.0, ao) + AMBIENT * sky * ao;
	vec3 lit = albedo * light;
	// Light carries a little way into the pieces' clay, so their shadow sides
	// glow warm instead of going dead.
	if (id != ${float(SET_PIECE.wall)}) lit += albedo * albedo * (1.0 - shadow * keyDiffuse) * 0.1 * ao;
	// A soft waxy sheen.
	vec3 halfway = normalize(KEY_DIR + vec3(0.0, 0.0, 1.0));
	bool wall = id == ${float(SET_PIECE.wall)};
	float gloss = wall ? 9.0 : 16.0;
	float strength = wall ? 0.05 : 0.09;
	lit += KEY * pool * shadow * pow(max(0.0, dot(n, halfway)), gloss) * strength * (gloss + 8.0) / 24.0;
	// How much of this is the wall, rather than a piece pressed onto it: the
	// wall is out of focus, and the pieces on it are not.
	outColor = vec4(lit, id == ${float(SET_PIECE.wall)} ? 1.0 - max(surface.g, surface.b) : 0.0);
}
`;

/**
 * Develops the lit set for one exposure: Blonky's shadow thrown onto the
 * wall behind him, the exposure's flicker, and grain.
 */
export const SET_DEVELOP_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
${LAMP}
${SET_SHARED}
uniform sampler2D u_lit;
// The lit wall, softened: the camera is focused on Blonky, in front of it.
uniform sampler2D u_soft;
// Blonky's outline, blurred, over his canvas's rectangle on the page, and
// how far behind him the wall is, as an offset away from the lamp.
uniform sampler2D u_figure;
uniform vec4 u_figureRect;
uniform vec2 u_figureOffset;
uniform float u_hasFigure;
uniform float u_exposure;
uniform float u_frame;
// The drawing buffer's size: each pixel is placed by its own position, so
// the canvas can be developed in tiles.
uniform vec2 u_size;
out vec4 outColor;

// How much of the lamp's light reaches the wall behind him.
const float WALL_SPILL = 0.94;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

// Blonky's blurred outline at a point over his rectangle; nothing off it.
float figureAt(vec2 uv) {
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
	return texture(u_figure, uv).r;
}

void main() {
	vec2 uv = gl_FragCoord.xy / u_size;
	vec2 p = toPage(uv);
	vec4 sharp = texture(u_lit, uv);
	vec4 soft = texture(u_soft, uv);
	// The wall is lit a little less than Blonky, who has the lamp's full
	// attention, and is out of focus; the pieces pressed onto it stay sharp.
	vec3 wall = soft.a > 1e-3 ? soft.rgb / soft.a * WALL_SPILL : sharp.rgb;
	vec3 color = mix(sharp.rgb, wall, sharp.a);
	if (u_hasFigure > 0.5) {
		// The lamp's shadow, thrown down and away from it; and all round
		// him, a little less of the room's light reaches the wall he stands
		// in front of. Drawn y down, like the page.
		float thrown = figureAt((p - u_figureOffset - u_figureRect.xy) / u_figureRect.zw);
		float near = figureAt((p - u_figureRect.xy) / u_figureRect.zw);
		color *= (1.0 - 0.48 * smoothstep(0.02, 0.85, thrown)) * (1.0 - 0.2 * smoothstep(0.0, 0.7, near));
	}
	color = develop(color, u_exposure);
	vec2 centered = uv - 0.5;
	color *= 1.0 - 0.22 * dot(centered, centered);
	float grain = hash12(gl_FragCoord.xy + fract(u_frame * 0.618) * 400.0) - 0.5;
	outColor = vec4(clamp(color + grain * 0.022, 0.0, 1.0), 1.0);
}
`;
