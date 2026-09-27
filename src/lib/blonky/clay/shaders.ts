import { FOLD_COUNT, FOLD_SAMPLES, LIMB_DEPTH, LIMB_SAMPLES, SOLIDS } from './figure';

const float = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value));

export const FULLSCREEN_VERTEX = /* glsl */ `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
	v_uv = a_position * 0.5 + 0.5;
	gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * Separable gaussian with an independent sigma per channel. Downsampling
 * happens here too: taps are spaced in target texels while reading the
 * full-size source.
 */
export const BLUR_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_step;
uniform vec3 u_sigma;
uniform int u_radius;
in vec2 v_uv;
out vec4 outColor;
void main() {
	vec3 falloff = 1.0 / (2.0 * u_sigma * u_sigma);
	vec3 sum = texture(u_source, v_uv).rgb;
	vec3 weight = vec3(1.0);
	for (int i = 1; i <= 160; i++) {
		if (i > u_radius) break;
		float x = float(i);
		vec3 w = exp(-x * x * falloff);
		sum += w * (texture(u_source, v_uv + u_step * x).rgb + texture(u_source, v_uv - u_step * x).rgb);
		weight += 2.0 * w;
	}
	outColor = vec4(sum / weight, 1.0);
}
`;

/**
 * Rounds the footprints. The head and neck's blurred union, cut at half,
 * fills the corner where the head's side meets the neck's flare. The shirt
 * is replaced by its own blurred outline, cut at half: the sleeves run into
 * the body without a notch or sliver, and its corners soften. The cuts are
 * antialiased to about a texel. The sleeves' footprint joins as the fourth
 * channel, so it's solved along with the others.
 */
export const FILLET_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_footprint;
uniform sampler2D u_blurred;
uniform sampler2D u_sleeves;
// Per channel (shirt, head): how steeply to cut the blurred mass.
uniform vec2 u_sharpness;
out vec4 outColor;
void main() {
	ivec2 texel = ivec2(gl_FragCoord.xy);
	vec4 footprint = texelFetch(u_footprint, texel, 0);
	vec2 cut = clamp(0.5 + (texelFetch(u_blurred, texel, 0).rg - 0.5) * u_sharpness, 0.0, 1.0);
	footprint.r = cut.r;
	footprint.g = max(footprint.g, cut.g);
	footprint.a = texelFetch(u_sleeves, texel, 0).r;
	outColor = footprint;
}
`;

/** Halves a footprint mask: each texel averages the 2x2 it covers. */
/** The sleeves' front depth, sqrt of their solved volume, ready to soften. */
export const SLEEVE_DEPTH_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_volume;
out vec4 outColor;
void main() {
	outColor = vec4(sqrt(max(texelFetch(u_volume, ivec2(gl_FragCoord.xy), 0).a, 0.0)), 0.0, 0.0, 1.0);
}
`;

export const VOLUME_REDUCE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_source;
out vec4 outColor;
void main() {
	ivec2 size = textureSize(u_source, 0) - 1;
	ivec2 base = ivec2(gl_FragCoord.xy) * 2;
	outColor = 0.25 * (
		texelFetch(u_source, min(base, size), 0)
		+ texelFetch(u_source, min(base + ivec2(1, 0), size), 0)
		+ texelFetch(u_source, min(base + ivec2(0, 1), size), 0)
		+ texelFetch(u_source, min(base + ivec2(1, 1), size), 0)
	);
}
`;

/**
 * One Jacobi sweep of Poisson's equation, lap(u) = -4, with u = 0 outside
 * each footprint. Per channel, sqrt(u) inflates a footprint into a smooth
 * solid: a disc into a hemisphere, a strip into a round tube, and a union of
 * shapes into one mass with no creases where they meet.
 */
export const VOLUME_RELAX_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_volume;
uniform sampler2D u_mask;
// 4 * spacing^2: the source term at this level's texel size, in bust units.
uniform float u_source;
out vec4 outColor;
vec4 neighbor(ivec2 texel, ivec2 size) {
	if (any(lessThan(texel, ivec2(0))) || any(greaterThanEqual(texel, size))) return vec4(0.0);
	return texelFetch(u_volume, texel, 0);
}
void main() {
	ivec2 texel = ivec2(gl_FragCoord.xy);
	ivec2 size = textureSize(u_volume, 0);
	vec4 around = neighbor(texel + ivec2(1, 0), size) + neighbor(texel - ivec2(1, 0), size)
		+ neighbor(texel + ivec2(0, 1), size) + neighbor(texel - ivec2(0, 1), size);
	// Partial coverage places the boundary between texels, so the volume's
	// edge follows the drawn outline rather than a staircase of whole texels.
	vec4 inside = clamp(texelFetch(u_mask, texel, 0), 0.0, 1.0);
	outColor = inside * (around + u_source) * 0.25;
}
`;

/** Carries a coarse solution up to the next finer level as its starting point. */
export const VOLUME_EXPAND_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_coarse;
uniform sampler2D u_mask;
out vec4 outColor;
void main() {
	vec2 uv = gl_FragCoord.xy * 0.5 / vec2(textureSize(u_coarse, 0));
	vec4 inside = clamp(texelFetch(u_mask, ivec2(gl_FragCoord.xy), 0), 0.0, 1.0);
	outColor = inside * texture(u_coarse, uv);
}
`;

/**
 * B-spline texture sampling: smooth normals between texels, where plain
 * bilinear derivatives would facet the clay into visible steps.
 */
export const SMOOTH_SAMPLING = /* glsl */ `
vec4 cubicWeights(float v) {
	vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
	vec4 s = n * n * n;
	float x = s.x;
	float y = s.y - 4.0 * s.x;
	float z = s.z - 4.0 * s.y + 6.0 * s.x;
	float w = 6.0 - x - y - z;
	return vec4(x, y, z, w) * (1.0 / 6.0);
}

// B-spline filtering keeps normals smooth between texels; plain bilinear
// derivatives would facet the clay into visible steps.
vec4 smoothSample(sampler2D tex, vec2 uv) {
	vec2 size = vec2(textureSize(tex, 0));
	vec2 inv = 1.0 / size;
	uv = uv * size - 0.5;
	vec2 f = fract(uv);
	uv -= f;
	vec4 xc = cubicWeights(f.x);
	vec4 yc = cubicWeights(f.y);
	vec4 c = uv.xxyy + vec2(-0.5, 1.5).xyxy;
	vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
	vec4 offset = (c + vec4(xc.yw, yc.yw) / s) * inv.xxyy;
	vec4 s0 = texture(tex, offset.xz);
	vec4 s1 = texture(tex, offset.yz);
	vec4 s2 = texture(tex, offset.xw);
	vec4 s3 = texture(tex, offset.yw);
	float sx = s.x / (s.x + s.y);
	float sy = s.z / (s.z + s.w);
	return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}
`;

/** The animator's marks on clay: thumbprints and smoothing swipes. Needs SHARED. */
export const CLAY_MARKS = /* glsl */ `
// A partial thumbprint: concentric ridges pressed in by the animator's hands.
float fingerprints(vec2 p, float seed) {
	const float cell = 78.0;
	vec2 base = floor(p / cell);
	float sum = 0.0;
	for (int j = -1; j <= 1; j++) {
		for (int i = -1; i <= 1; i++) {
			// Each print was pressed in once and stays, carried along with the
			// clay it's in.
			vec2 key = base + vec2(i, j) + seed * 13.7;
			// Only now and then: most of the clay has been smoothed over.
			if (hash12(key + 1.9) > 0.2) continue;
			vec2 center = (base + vec2(i, j) + 0.2 + 0.6 * hash22(key)) * cell;
			float angle = hash12(key + 7.3) * 6.2832;
			vec2 q = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * (p - center);
			q.y *= 1.3;
			float radius = 12.0 + 12.0 * hash12(key + 2.2);
			float r = length(q);
			if (r >= radius) continue;
			float press = smoothstep(radius, radius * 0.25, r) * smoothstep(-0.3 * radius, 0.6 * radius, q.x);
			float warp = 0.9 * noise(q * 0.12 + key);
			sum += sin(r * 2.35 + warp * 3.0) * press;
		}
	}
	return sum;
}

// Smoothing swipes: here and there the animator's thumb has dragged the
// clay, leaving a short patch of faint parallel ridges along the swipe.
float swipes(vec2 p, float seed) {
	const float cell = 64.0;
	vec2 base = floor(p / cell);
	float sum = 0.0;
	for (int j = -1; j <= 1; j++) {
		for (int i = -1; i <= 1; i++) {
			vec2 id = base + vec2(i, j) + seed * 17.3;
			if (hash12(id + 9.7) > 0.45) continue;
			vec2 center = (base + vec2(i, j) + 0.25 + 0.5 * hash22(id + 4.1)) * cell;
			float angle = hash12(id + 3.1) * 3.1416;
			vec2 q = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * (p - center);
			vec2 extent = q / vec2(0.7 * cell, 0.3 * cell);
			float spread = dot(extent, extent);
			// Past this the swipe has faded out entirely.
			if (spread > 4.0) continue;
			float swipe = exp(-2.0 * spread);
			float ridges = noise(vec2(q.x / 16.0, q.y / 2.4) + id * 7.1) - 0.5;
			sum += ridges * swipe;
		}
	}
	return sum;
}
`;

/**
 * The set's lamp, shared by everything in it, and how the film develops what
 * it sees: exposure, a light grade, a soft shoulder, then display gamma.
 */
export const LAMP = /* glsl */ `
// A small stop-motion set: a warm key high on the left, raking enough to
// model the forms; a dim neutral fill from the right; a little cool bounce.
const vec3 KEY_DIR = normalize(vec3(-0.62, -0.58, 0.53));
const vec3 KEY = vec3(1.15, 1.07, 0.98);
const vec3 FILL_DIR = normalize(vec3(0.85, -0.05, 0.55));
const vec3 FILL = vec3(0.22, 0.22, 0.25);
const vec3 AMBIENT = vec3(0.06, 0.066, 0.084);
// Where the highlights start to roll off toward white.
const float SHOULDER = 0.6;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

vec3 develop(vec3 color, float exposure) {
	color *= 1.0 + exposure;
	// A light grade: film keeps a little more colour than the warm key
	// leaves on the clay.
	color = max(mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), color, 1.12), 0.0);
	// Linear through the midtones, so the forms' shading keeps its full
	// range, with a soft shoulder that rolls highlights off before white.
	vec3 over = max(color - SHOULDER, 0.0);
	color = min(color, SHOULDER) + (1.0 - SHOULDER) * (1.0 - exp(-over / (1.0 - SHOULDER)));
	return pow(color, vec3(1.0 / 2.2));
}
`;

/** Hashes and value noise. */
export const SHARED_NOISE = /* glsl */ `
float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.xx + p3.yz) * p3.zy);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	float a = hash12(i);
	float b = hash12(i + vec2(1.0, 0.0));
	float c = hash12(i + vec2(0.0, 1.0));
	float d = hash12(i + vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
	float sum = 0.0;
	float amplitude = 0.5;
	for (int i = 0; i < 4; i++) {
		sum += amplitude * noise(p);
		p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.13;
		amplitude *= 0.5;
	}
	return sum;
}
`;

export const SHARED = /* glsl */ `
uniform vec2 u_resolution;
uniform vec2 u_origin;
uniform float u_pxPerUnit;

// Bust units (y down) to texture coordinates (y up, flipped on upload).
vec2 toUv(vec2 p) {
	vec2 px = u_origin + p * u_pxPerUnit;
	return vec2(px.x / u_resolution.x, 1.0 - px.y / u_resolution.y);
}

vec2 toBust(vec2 uv) {
	vec2 px = vec2(uv.x * u_resolution.x, (1.0 - uv.y) * u_resolution.y);
	return (px - u_origin) / u_pxPerUnit;
}

${SHARED_NOISE}`;

// Piece ids, which also select materials.
export const PIECE = {
	shirt: 2,
	arm: 4,
	head: 7,
	eye: 9,
	brow: 10,
	hair: 11,
	tear: 12,
	hand: 13,
} as const;

/**
 * The figure's front surface, as seen by the camera. The shirt, head, and a
 * raised hand are solved volumes; the bare arms are round limbs. At each
 * pixel the frontmost surface wins, then the small pieces (collar and cuff
 * ribs, eyes, lids, brows, stubble, tears) and carved detail sit on it.
 * Output: height and piece id.
 */
export const HEIGHT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
${SHARED}
// Solved volumes (shirt, head, hand, sleeves) over u_domain, in bust units.
uniform sampler2D u_volume;
uniform vec4 u_domain;
// The sleeves' solved depth, softened, over u_domain.
uniform sampler2D u_sleeveSwell;
uniform sampler2D u_mask0;
uniform sampler2D u_mask1;
uniform sampler2D u_mask2;
uniform sampler2D u_mask3;
uniform sampler2D u_bevel0;
uniform sampler2D u_bevel1;
uniform sampler2D u_bevel2;
uniform sampler2D u_bevel3;
uniform sampler2D u_detail0;
uniform sampler2D u_detail1;
// Rows: left arm, right arm.
uniform sampler2D u_limbs;
// The figure's outline, broadly blurred: where it's zero, no piece reaches.
uniform sampler2D u_reach;
// Per arm: top, bottom, shown.
uniform vec4 u_limbRange[2];
// Per arm: where it leaves its hem (x, y), and its radius there.
uniform vec4 u_hem[2];
// Per arm: its hem's bottom edge.
uniform vec4 u_hemLine[2];
// A raised hand's bounds: min x, min y, max x, max y.
uniform vec4 u_handBox;
// Where the chin overhangs the neckline.
uniform vec2 u_chin;
// The torso's top middle.
uniform vec2 u_torso;
// The belly's outline, an ellipse: centre, half-width, half-height; and how
// far it swells forward.
uniform vec4 u_belly;
uniform float u_bellyDepth;
// Folds: the belly's crease, then the chin's two. Each line's y at even steps
// of x from its start to its end, and the roll over it, if any: depth,
// radius, reach, and how far below it the pinch eases out.
uniform float u_foldY[${FOLD_COUNT * FOLD_SAMPLES}];
uniform vec4 u_foldSpan[${FOLD_COUNT}];
uniform vec4 u_foldShape[${FOLD_COUNT}];
uniform vec2 u_bodyOffset;
uniform vec2 u_headOffset;
in vec2 v_uv;
out vec4 outColor;

const float SHIRT_ZS = ${float(SOLIDS.shirt.zs)};
const float BELLY_SPREAD = ${float(SOLIDS.shirt.belly.spread)};
const vec3 CREASE = vec3(${float(SOLIDS.shirt.crease.depth)}, ${float(SOLIDS.shirt.crease.above)}, ${float(SOLIDS.shirt.crease.below)});
// The chest's peak, below the torso's top middle, and its extent.
const float CHEST_Y = ${float(SOLIDS.shirt.chest.y)};
const float CHEST_WIDTH = ${float(SOLIDS.shirt.chest.width)};
const float CHEST_RISE = ${float(SOLIDS.shirt.chest.rise)};
const vec2 CHEST_SAG = vec2(${float(SOLIDS.shirt.chest.sag.near)}, ${float(SOLIDS.shirt.chest.sag.far)});
const float CHEST_CLEFT = ${float(SOLIDS.shirt.chest.cleft)};
const float CHEST_DEPTH = ${float(SOLIDS.shirt.chest.depth)};
const int FOLD_SAMPLES = ${FOLD_SAMPLES};
const float NECKLINE_DEPTH = ${float(SOLIDS.shirt.neckline)};
const float SLEEVE_SWELL = ${float(SOLIDS.shirt.sleeve.swell)};
const float ARM_TUCK = ${float(SOLIDS.arm.tuck)};
const float HEAD_ZS = ${float(SOLIDS.head.zs)};
const float NOSE_HEIGHT = ${float(SOLIDS.head.nose)};
const float HAND_ZS = ${float(SOLIDS.hand.zs)};
const float HAND_THICKNESS = ${float(SOLIDS.hand.thickness)};
const float HAND_LIFT = ${float(SOLIDS.hand.lift)};
const float LIMB_EZ = ${float(LIMB_DEPTH)};
const float LIMB_SAMPLES = ${float(LIMB_SAMPLES)};

${SMOOTH_SAMPLING}

// A smooth maximum: joins two surfaces with a round fillet about k wide.
float smax(float a, float b, float k) {
	float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
	return mix(b, a, h) + k * h * (1.0 - h);
}

// A thin coil of clay: round in section, vertical at its edge.
float pillow(float blurred) {
	float s = clamp(2.0 * blurred - 1.0, 0.0, 1.0);
	return sqrt(s * (2.0 - s));
}

// Solved volumes' front depths: sqrt of the Poisson solution.
vec4 volumeAt(vec2 p) {
	return sqrt(max(smoothSample(u_volume, (p - u_domain.xy) / u_domain.zw), 0.0));
}

// A fold's line at t along it (0 at its start, 1 at its end), interpolated
// smoothly (Catmull-Rom) between its samples, so it has no kinks.
float foldLine(int index, float t) {
	float x = clamp(t, 0.0, 1.0) * float(FOLD_SAMPLES - 1);
	int i = min(int(x), FOLD_SAMPLES - 2);
	float f = x - float(i);
	int base = index * FOLD_SAMPLES;
	float y0 = u_foldY[base + max(i - 1, 0)];
	float y1 = u_foldY[base + i];
	float y2 = u_foldY[base + i + 1];
	float y3 = u_foldY[base + min(i + 2, FOLD_SAMPLES - 1)];
	return y1 + 0.5 * f * (y2 - y0 + f * (2.0 * y0 - 5.0 * y1 + 4.0 * y2 - y3 + f * (3.0 * (y1 - y2) + y3 - y0)));
}

// A roll of fat over a drawn fold. Above the fold the flesh swells out,
// then turns under into the fold on a round lip; below it, the flesh is
// pinched in and eases back out. The roll dies away toward the fold's ends,
// where the drawing's line fades.
float rollAt(vec2 p, int index) {
	if (u_foldShape[index].x <= 0.0) return 0.0;
	vec4 span = u_foldSpan[index];
	float t = (p.x - span.x) / (span.y - span.x);
	if (t <= 0.0 || t >= 1.0) return 0.0;
	// Fullest at the middle and easing to nothing at the ends, so the roll
	// is a rounded mound, not a slab.
	float bulge = sin(t * 3.1416);
	float taper = bulge * sqrt(bulge);
	float fold = foldLine(index, t);

	vec4 shape = u_foldShape[index];
	float depth = shape.x;
	float radius = shape.y;
	float pinch = depth * 0.25;
	float below = p.y - fold;
	if (below >= 0.0) {
		float ease = 1.0 - min(below / shape.w, 1.0);
		return -pinch * ease * ease * taper;
	}
	float above = -below;
	// The lip is steep but not sheer, so where the roll dies away at the
	// fold's ends, the fold softens with it.
	float lip = sin(min(above / radius, 1.0) * 1.5708);
	float swell = 1.0 - smoothstep(radius, radius + shape.z * sqrt(bulge), above);
	return (-pinch + (depth + pinch) * lip * swell) * taper;
}

// The belly: a broad dome, its outline fitted to the drawing's lower fold
// and grown so the swell blends into the body all round, with no edge. It
// rounds away to every side, so it catches the light on top and turns from
// it below and at the sides.
float bellyAt(vec2 p) {
	vec2 q = (p - u_belly.xy) / (u_belly.zw * BELLY_SPREAD);
	float t = max(1.0 - dot(q, q), 0.0);
	return u_bellyDepth * t * t;
}

// Where the belly tucks in under the chest, along the drawing's lower fold:
// the crease closes steeply above the line, and the belly rises gently out
// of it below. It fades away toward the line's ends, as the drawn line does.
float creaseAt(vec2 p) {
	vec4 span = u_foldSpan[0];
	float t = (p.x - span.x) / (span.y - span.x);
	if (t <= 0.0 || t >= 1.0) return 0.0;
	float v = p.y - foldLine(0, t);
	float s = clamp(v >= 0.0 ? v / CREASE.z : -v / CREASE.y, 0.0, 1.0);
	float taper = sin(t * 3.1416);
	return -CREASE.x * taper * (1.0 - s * s * (3.0 - 2.0 * s));
}

// A sleeve swells round over the arm inside it. Its solved depth is
// softened, so the swell runs out into the body gradually: no edge, and
// no line where the sleeve meets the shoulder or the side of the chest.
float sleeveAt(vec2 p) {
	return SLEEVE_SWELL * smoothSample(u_sleeveSwell, (p - u_domain.xy) / u_domain.zw).r;
}

// The chest under the shirt: one broad swell, flat along the top and
// falling away as (1 - d^2)^3 toward its edges, so it ends without a rim.
float chestAt(vec2 p) {
	vec2 d = p - u_torso.xy - vec2(0.0, CHEST_Y);
	float side = pow(abs(d.x) / CHEST_WIDTH, 4.0);
	if (side >= 1.0) return 0.0;
	float across = (1.0 - side) * (1.0 - side) * (1.0 - side);
	// The fabric bridges the breastbone, dipping only a little.
	across *= 1.0 - CHEST_CLEFT * exp(-d.x * d.x / (40.0 * 40.0));
	float under = mix(CHEST_SAG.x, CHEST_SAG.y, smoothstep(40.0, 150.0, abs(d.x)));
	float q = d.y / (d.y < 0.0 ? CHEST_RISE : under);
	float t = max(1.0 - q * q, 0.0);
	return CHEST_DEPTH * across * t * t * t;
}

float shirtAt(vec2 p) {
	vec4 depth = volumeAt(p);
	return SHIRT_ZS * depth.r + sleeveAt(p) + bellyAt(p) + creaseAt(p) + chestAt(p);
}

// A bare arm's front at p, or -1e4 off it. It hangs on the axis of its hem,
// tucked just behind the hem's front.
float arm(int side, vec2 p) {
	vec4 range = u_limbRange[side];
	if (range.z < 0.5 || p.y < range.x || p.y > range.y) return -1e4;
	float v = (p.y - range.x) / (range.y - range.x);
	vec4 profile = texture(u_limbs, vec2((v * (LIMB_SAMPLES - 1.0) + 0.5) / LIMB_SAMPLES, (float(side) + 0.5) / 2.0));
	float dx = p.x - profile.x;
	// Run a pixel past the edge; the outline's coverage trims it smoothly.
	if (abs(dx) >= profile.z + 1.5 / u_pxPerUnit) return -1e4;
	vec4 hem = u_hem[side];
	float axis = shirtAt(hem.xy) - ARM_TUCK - hem.z * LIMB_EZ;
	// Past its radius the arm keeps turning away, steeply, so the extra
	// sliver kept for smooth edges reads as the arm's edge, not a flat rim.
	float over = abs(dx) - profile.z;
	return over > 0.0
		? axis - over * 6.0
		: axis + LIMB_EZ * sqrt(profile.z * profile.z - dx * dx);
}

// A raised hand is held flat, clear of the chest's highest point behind it.
float handSeat() {
	float seat = 0.0;
	for (int j = 0; j <= 2; j++) {
		for (int i = 0; i <= 2; i++) {
			seat = max(seat, shirtAt(mix(u_handBox.xy, u_handBox.zw, vec2(i, j) * 0.5)));
		}
	}
	return seat + HAND_LIFT;
}

// Signed distance past a line, positive on its lower side.
float below(vec2 p, vec4 line) {
	vec2 e = line.zw - line.xy;
	vec2 n = normalize(vec2(-e.y, e.x));
	if (n.y < 0.0) n = -n;
	return dot(p - line.xy, n);
}

struct Coverage {
	vec3 m0;
	vec3 m1;
	vec3 m2;
	vec3 m3;
	float shirt;
};

// The frontmost surface at p, and which piece it is.
vec2 surfaceAt(vec2 p, Coverage c) {
	vec2 uv = toUv(p);
	vec4 depth = volumeAt(p);
	vec3 b0 = smoothSample(u_bevel0, uv).rgb;
	vec3 b1 = smoothSample(u_bevel1, uv).rgb;
	vec3 b2 = smoothSample(u_bevel2, uv).rgb;
	vec3 b3 = smoothSample(u_bevel3, uv).rgb;
	vec3 d0 = smoothSample(u_detail0, uv).rgb;
	vec3 d1 = smoothSample(u_detail1, uv).rgb;

	float z = -1e4;
	float id = 0.0;
	float press = NECKLINE_DEPTH * b2.g;
	// The body's own front, under the shirt's hems and neckline.
	float chest = -1e4;
	if (c.shirt > 0.5) {
		chest = SHIRT_ZS * depth.r + sleeveAt(p) + bellyAt(p) + creaseAt(p) + chestAt(p);
		float shirt = chest;
		// The neckline opens a shirt's thickness into the body.
		shirt -= press;
		// Ribbed collar and cuff hems rolled onto the fabric.
		shirt += c.m0.r * 10.0 * pillow(b0.r) + c.m0.g * 6.5 * pillow(b0.g);
		z = shirt;
		id = ${float(PIECE.shirt)};
	}
	for (int side = 0; side < 2; side++) {
		float limb = arm(side, p);
		if (limb < -1e3) continue;
		// Below its hem the arm is bare and in front: the shirt behind it is
		// cut away. Above the hem it's inside the sleeve, out of sight.
		if (below(p, u_hemLine[side]) > 0.0 || c.shirt < 0.5) {
			z = limb;
			id = ${float(PIECE.arm)};
		}
	}
	// The head is in front of everything behind it; the neck is in front of
	// the shirt but under the collar. The drawn shapes decide, so their edges
	// are exactly the drawing's.
	// Head and neck as one mass: their blurred union, cut at half, fills
	// the corner where the head's side meets the neck's flare.
	bool inMass = b3.r + b3.g > 0.5;
	bool onSkull = c.m3.r > 0.5 || c.m1.g > 0.5 || (inMass && c.m3.g < 0.5 && c.m0.r < 0.5);
	bool onNeck = c.m3.g > 0.5 && c.m0.r < 0.5;
	if (onSkull || onNeck) {
		// Head and neck rise as one mass from inside the neckline. Low on the
		// neck, the mass sits on the chest and follows it round; higher up,
		// it rises from where the chin meets the neckline. Where the mass
		// runs over what's behind it, its edge rolls down onto it.
		float seat = smax(shirtAt(u_chin), chest, 24.0) - NECKLINE_DEPTH;
		float head = seat + HEAD_ZS * depth.g;
		// Head and neck are one mass, so their rim is the union's.
		float rim = clamp(b3.r + b3.g, 0.0, 1.0);
		if (z > -1e3) head = max(head, z + 14.0 * pillow(rim));
		// The chin and the double chin, rolled over their folds.
		head += rollAt(p, 1) + rollAt(p, 2);
		// The lids: each eye's ball swells the skin around it softly, the
		// same skin as the face, open or shut.
		head += 3.0 * smoothstep(0.0, 1.0, b1.b);
		// Eye beads, domed like marbles.
		head += c.m0.b * 9.0 * pillow(b0.b);
		head += c.m1.r * 3.2 * pillow(b1.r);
		head += c.m1.g * 1.3 * pillow(b1.g);
		head += c.m2.b * 1.4 * pillow(b2.b);
		z = head;
		id = ${float(PIECE.head)};
		if (c.m0.b > 0.5) id = ${float(PIECE.eye)};
		if (c.m1.r > 0.5) id = ${float(PIECE.brow)};
		if (c.m1.g > 0.5) id = ${float(PIECE.hair)};
		if (c.m2.b > 0.3) id = ${float(PIECE.tear)};
	}
	if (c.m3.b > 0.5) {
		z = handSeat() + HAND_THICKNESS * tanh(HAND_ZS * depth.b / HAND_THICKNESS);
		id = ${float(PIECE.hand)};
	}
	z += -2.8 * d0.r + 1.4 * d0.g - 3.4 * d0.b + 7.5 * d1.r + 7.0 * d1.g + NOSE_HEIGHT * pow(d1.b, 1.4);
	return vec2(z, id);
}

${CLAY_MARKS}

float clayTexture(vec2 p, float id) {
	if (id < 0.5) return 0.0;
	bool onHead = id >= ${float(PIECE.head)} && id <= ${float(PIECE.tear)};
	vec2 local = p - (onHead ? u_headOffset : u_bodyOffset);
	float seed = onHead ? 2.0 : 1.0;
	// Uneven lumps and soft thumb-smoothed dents: nothing is perfectly smooth.
	float lumps = (fbm(local / 38.0 + seed) - 0.5) * 2.6;
	float dents = (noise(local / 13.0 + seed * 3.0) - 0.5) * 1.1;
	float strokes = swipes(local, seed) * 0.3;
	float pores = (noise(local * 0.9 + seed * 5.0) - 0.5) * 0.14;
	float prints = fingerprints(local, seed) * 0.28;
	// Varnished eyes and wet tears stay smooth, for one clean glint.
	float scale = id == ${float(PIECE.eye)} || id == ${float(PIECE.tear)} ? 0.0
		: id == ${float(PIECE.brow)} || id == ${float(PIECE.hair)} ? 0.4 : 1.0;
	return (lumps + dents + strokes + pores + prints) * scale;
}

void main() {
	vec2 p = toBust(v_uv);
	// Well clear of every piece, there's nothing to shape: the figure's
	// broadly blurred outline has faded to nothing long before any piece's
	// widest reach past its drawing.
	if (texture(u_reach, v_uv).r < 1e-3) {
		outColor = vec4(-1e4, 0.0, 0.0, 0.0);
		return;
	}
	Coverage c;
	c.m0 = texture(u_mask0, v_uv).rgb;
	c.m1 = texture(u_mask1, v_uv).rgb;
	c.m2 = texture(u_mask2, v_uv).rgb;
	c.m3 = texture(u_mask3, v_uv).rgb;
	c.shirt = step(1e-3, texture(u_volume, (p - u_domain.xy) / u_domain.zw).r);
	vec2 surface = surfaceAt(p, c);
	if (surface.y < 0.5) {
		outColor = vec4(-1e4, 0.0, 0.0, 0.0);
		return;
	}
	float id = surface.y;
	// Slopes are taken in the lighting pass, from neighbouring samples.
	outColor = vec4(surface.x + clayTexture(p, id), 0.0, 0.0, id);
}
`;

/**
 * Lights the front surface like a small stop-motion set: a warm key from the
 * upper left with shadows cast across the clay and onto the backdrop, cool
 * fill, contact occlusion, then per-exposure flicker and grain.
 */
const LIGHT_SOURCE = /* glsl */ `
precision highp float;
precision highp sampler2D;
${SHARED}
uniform sampler2D u_height;
// One shading sample, in texture coordinates.
uniform vec2 u_texel;
// Shadow and occlusion, solved at the canvas's resolution (TERMS pass).
uniform sampler2D u_terms;

// Paint, one layer per clay: the shirt's, and the skin's.
uniform sampler2D u_shirtPaint;
uniform sampler2D u_skinPaint;
uniform sampler2D u_silhouette;
uniform sampler2D u_outline;
// The head and neck's blurred union, and how steeply to cut it for a crisp,
// antialiased edge at this resolution.
uniform sampler2D u_headMass;
uniform float u_filletSharpness;
// The shirt's outline, blurred, and how steeply to cut it: the shirt is
// pressed round just as its volume is.
uniform sampler2D u_shirtMass;
uniform float u_shirtSharpness;
uniform float u_exposure;
// A dot grid painted on the board: spacing, dot radius, and the canvas's
// offset on the grid, in CSS pixels; how the dots tint the board; and CSS
// pixels per canvas pixel and per shading sample.
uniform bool u_hasPattern;
uniform vec4 u_pattern;
uniform vec3 u_patternTint;
uniform vec2 u_patternScale;
// Which view to show (SHADING); the lit frame by default.
uniform int u_shading;
uniform vec2 u_bodyOffset;
uniform vec2 u_headOffset;
in vec2 v_uv;
out vec4 outColor;

${LAMP}
const vec3 SHIRT_BLUE = vec3(0.282, 0.412, 0.561);
const vec3 SKIN = vec3(0.886, 0.796, 0.702);
// Heights differing by more than this, in bust units, are across an edge.
const float TERMS_EDGE = 2.5;
// The views, in the order of the renderer's SHADINGS.
const int SHADING_EVEN = 1;
const int SHADING_CLAY = 2;
const int SHADING_PAINT = 3;
const int SHADING_DEPTH = 4;
const int SHADING_NORMALS = 5;
const int SHADING_SHADOWS = 6;
// Every piece in one plain clay, to judge the sculpt alone.
const vec3 GREY_CLAY = vec3(0.64, 0.62, 0.6);
// The depth view's range, in bust units toward the camera.
const float DEPTH_RANGE = 640.0;
// Light from all around, for the even-light view.
const vec3 EVEN_LIGHT = vec3(1.05, 1.03, 1.0);
// The painted board behind the set.
const vec3 WALL = vec3(0.74, 0.77, 0.73);

float heightAt(vec2 p) {
	return texture(u_height, toUv(p)).r;
}


float occlusion(vec2 p, float h) {
	float occ = 0.0;
	for (int ring = 0; ring < 3; ring++) {
		float radius = ring == 0 ? 3.0 : ring == 1 ? 9.0 : 22.0;
		for (int i = 0; i < 8; i++) {
			float angle = (float(i) + 0.5 * float(ring)) * 0.7854;
			vec2 q = p + vec2(cos(angle), sin(angle)) * radius;
			float rise = heightAt(q) - h;
			occ += clamp(rise / (radius * 1.6), 0.0, 1.0);
		}
	}
	return 1.0 - clamp(occ / 24.0 * 1.35, 0.0, 0.85);
}

// March toward the key light over the front surface. Each pixel offsets its
// march by a fraction of a step, so thin ridges can't be hit or missed in
// lockstep across a row.
float castShadow(vec2 p, float h, vec2 pixel) {
	vec2 toward = normalize(KEY_DIR.xy);
	float slope = KEY_DIR.z / length(KEY_DIR.xy);
	float shade = 0.0;
	float jitter = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
	for (int i = 0; i < 64; i++) {
		float x = float(i) + jitter;
		// Fine near the surface, reaching past the head from the far shoulder.
		float t = 0.8 + 0.6 * x + 0.11 * x * x;
		vec2 q = p + toward * t;
		float over = heightAt(q) - (h + t * slope);
		// The penumbra widens with distance from the occluder.
		shade = max(shade, clamp(over / (0.4 * t + 2.0), 0.0, 1.0));
	}
	return 1.0 - shade * 0.82;
}

// Shadow and occlusion solved for one canvas pixel, as the full-resolution
// solve would: off the clay, none.
vec2 termsForPixel(vec2 pixel) {
	vec2 uv = pixel / u_resolution;
	vec4 surface = texture(u_height, uv);
	if (surface.a < 0.5) return vec2(1.0);
	vec2 p = toBust(uv);
	return vec2(castShadow(p, surface.r, pixel), occlusion(p, surface.r));
}

// Shadow and occlusion here. Over a surface they vary slowly, so they're
// taken from the half-resolution solve, blended from its four nearest
// samples. Where those samples straddle an edge, onto another surface or off
// the clay, their blend isn't this surface's; there they're solved for the
// four canvas pixels around this sample and blended, just as a solve at the
// canvas's own resolution would be.
vec2 termsAt(float h) {
	vec2 size = vec2(textureSize(u_terms, 0));
	vec2 at = v_uv * size - 0.5;
	vec2 base = floor(at);
	vec2 f = at - base;
	vec3 sum = vec3(0.0);
	bool edge = false;
	for (int j = 0; j <= 1; j++) {
		for (int i = 0; i <= 1; i++) {
			ivec2 texel = clamp(ivec2(base) + ivec2(i, j), ivec2(0), ivec2(size) - 1);
			vec4 near = texelFetch(u_terms, texel, 0);
			edge = edge || near.a < 0.5;
			sum += near.rgb * (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
		}
	}
	if (!edge && abs(sum.b - h) <= TERMS_EDGE) return sum.rg;
	vec2 pixel = v_uv * u_resolution - 0.5;
	vec2 corner = floor(pixel);
	vec2 g = pixel - corner;
	return mix(
		mix(termsForPixel(corner + vec2(0.5, 0.5)), termsForPixel(corner + vec2(1.5, 0.5)), g.x),
		mix(termsForPixel(corner + vec2(0.5, 1.5)), termsForPixel(corner + vec2(1.5, 1.5)), g.x),
		g.y
	);
}

// The puppet's shadow on the board, well behind it: broad and soft, thrown
// down and away from the key light.
float boardShadow(vec2 p) {
	float shadow = texture(u_silhouette, toUv(p + normalize(KEY_DIR.xy) * 46.0)).r;
	return 1.0 - 0.42 * smoothstep(0.05, 0.9, shadow);
}

// The painted board: broad mottling, a faint brush grain, and the page's
// dot grid, painted on where the page draws it.
vec3 board(vec2 p) {
	vec3 color = toLinear(WALL) * (0.95 + 0.08 * fbm(p / 90.0) + 0.02 * noise(vec2(p.x / 2.5, p.y / 60.0)));
	if (u_hasPattern) {
		// This point on the page's grid, in CSS pixels, and how far it is from
		// the middle of its cell, where the dot sits.
		vec2 css = (u_origin + p * u_pxPerUnit) * u_patternScale.x + u_pattern.zw;
		vec2 fromDot = mod(css, u_pattern.x) - 0.5 * u_pattern.x;
		// Antialiased over one shading sample.
		float spot = clamp((u_pattern.y - length(fromDot)) / u_patternScale.y + 0.5, 0.0, 1.0);
		color *= mix(vec3(1.0), u_patternTint, spot);
	}
	return color;
}

vec3 backdrop(vec2 p) {
	// A soft spot pooled behind the character, with the set falling off.
	vec2 fromPool = (p - vec2(380.0, 260.0)) / vec2(620.0, 520.0);
	float pool = exp(-dot(fromPool, fromPool) * 1.6);
	vec3 color = board(p) * (0.52 + 0.62 * pool);
	return color * boardShadow(p);
}

// The surface's slope, from neighbouring samples of the same piece: across
// an edge between pieces, only the side belonging to this one counts.
vec2 slopeAt(vec4 surface) {
	float step = u_texel.x * u_resolution.x / u_pxPerUnit;
	vec2 slope = vec2(0.0);
	for (int axis = 0; axis < 2; axis++) {
		vec2 offset = axis == 0 ? vec2(u_texel.x, 0.0) : vec2(0.0, u_texel.y);
		vec4 before = texture(u_height, v_uv - offset);
		vec4 after = texture(u_height, v_uv + offset);
		// Texture y runs up; bust y runs down.
		float sign = axis == 0 ? 1.0 : -1.0;
		bool hasBefore = abs(before.a - surface.a) < 0.5;
		bool hasAfter = abs(after.a - surface.a) < 0.5;
		float d = hasBefore && hasAfter ? (after.r - before.r) / (2.0 * step)
			: hasAfter ? (after.r - surface.r) / step
			: hasBefore ? (surface.r - before.r) / step
			: 0.0;
		slope[axis] = d * sign;
	}
	return slope;
}

// A piece's own colour at p, in linear light: its clay's paint, kneaded.
vec3 paintAt(vec2 p, float id) {
	bool shirt = id == ${float(PIECE.shirt)};
	bool onHead = id >= ${float(PIECE.head)} && id <= ${float(PIECE.tear)};
	// Each piece takes its paint from its own clay's layer; past that
	// layer's edge, it's the bare clay.
	vec4 paint = shirt ? texture(u_shirtPaint, v_uv) : texture(u_skinPaint, v_uv);
	vec3 albedo = mix(
		toLinear(shirt ? SHIRT_BLUE : SKIN),
		toLinear(paint.rgb / max(paint.a, 1e-4)),
		smoothstep(0.0, 0.5, paint.a)
	);
	vec2 local = p - (onHead ? u_headOffset : u_bodyOffset);
	// Plasticine is never one flat color: knead in a little marbling.
	// Seeded per clay, not per piece, so joined pieces match.
	float batch = shirt ? 1.0 : onHead ? 2.0 : 3.0;
	albedo *= 0.94 + 0.1 * fbm(local / 60.0 + batch * 1.7);
	if (shirt) {
		// Pale flecks kneaded into the blue, after the drawing's stipple.
		vec2 cell = floor(local / 6.0);
		vec2 center = (cell + 0.2 + 0.6 * hash22(cell + 3.7)) * 6.0;
		float size = 0.45 + 0.55 * hash12(cell + 9.1);
		float fleck = step(0.62, hash12(cell + 1.3)) * smoothstep(size, size * 0.35, length(local - center));
		albedo = mix(albedo, toLinear(vec3(0.56, 0.64, 0.74)), fleck * 0.4);
	}
	return albedo;
}

// How much of this pixel the clay covers: the pieces' outlines, with the
// head filleted into the neck and the shirt pressed round.
float coverageAt() {
	vec2 mass = texture(u_headMass, v_uv).rg;
	float head = clamp(0.5 + (mass.r + mass.g - 0.5) * u_filletSharpness, 0.0, 1.0);
	float shirt = clamp(0.5 + (texture(u_shirtMass, v_uv).g - 0.5) * u_shirtSharpness, 0.0, 1.0);
	return max(texture(u_outline, v_uv).b, max(head, shirt));
}

#ifndef TERMS
// Depth as a heat map, dark and far to bright and near.
vec3 heat(float t) {
	vec3 a = vec3(0.05, 0.03, 0.2);
	vec3 b = vec3(0.42, 0.1, 0.5);
	vec3 c = vec3(0.85, 0.28, 0.3);
	vec3 d = vec3(0.98, 0.62, 0.12);
	vec3 e = vec3(0.99, 0.96, 0.62);
	t = clamp(t, 0.0, 1.0) * 4.0;
	return t < 1.0 ? mix(a, b, t) : t < 2.0 ? mix(b, c, t - 1.0) : t < 3.0 ? mix(c, d, t - 2.0) : mix(d, e, t - 3.0);
}

// One part of the picture on its own, in display colour.
vec3 inspect(vec2 p, vec4 surface, float id) {
	float coverage = id < 0.5 ? 0.0 : coverageAt();
	if (u_shading == SHADING_PAINT) {
		vec3 color = mix(board(p), id < 0.5 ? vec3(0.0) : paintAt(p, id), coverage);
		return pow(color, vec3(1.0 / 2.2));
	}
	if (u_shading == SHADING_SHADOWS) {
		vec2 terms = termsAt(surface.r);
		return vec3(mix(boardShadow(p), terms.r * terms.g, coverage));
	}
	if (u_shading == SHADING_NORMALS) {
		vec3 n = normalize(vec3(-slopeAt(surface), 1.0));
		// Bust y runs down; show y up, as normal maps do.
		return mix(vec3(0.16), vec3(n.x, -n.y, n.z) * 0.5 + 0.5, coverage);
	}
	// Depth, with a contour every 20 units to show the forms' shape.
	float z = surface.r;
	float contour = 1.0 - 0.18 * smoothstep(0.85, 1.0, abs(fract(z / 20.0) * 2.0 - 1.0));
	return mix(vec3(0.08), heat(z / DEPTH_RANGE) * contour, coverage);
}
#endif

#ifdef TERMS
// Shadow and occlusion vary slowly, so they're solved at half the canvas's
// resolution, with the surface's height, so the shading samples can take
// them from the samples on the same surface as themselves.
void main() {
	vec2 p = toBust(v_uv);
	vec4 surface = texture(u_height, v_uv);
	if (surface.a < 0.5) {
		outColor = vec4(1.0, 1.0, 0.0, 0.0);
		return;
	}
	outColor = vec4(castShadow(p, surface.r, gl_FragCoord.xy), occlusion(p, surface.r), surface.r, 1.0);
}
#else
void main() {
	vec2 p = toBust(v_uv);
	vec4 surface = texture(u_height, v_uv);
	float id = floor(surface.a + 0.5);
	if (u_shading >= SHADING_PAINT) {
		outColor = vec4(inspect(p, surface, id), 1.0);
		return;
	}
	vec3 color;

	if (u_shading == SHADING_EVEN) {
		// Even light from all around the front of the set. Each surface gets
		// the share of it that it faces, less what its neighbours block: the
		// forms still round off and the creases still darken, but nothing
		// casts a shadow.
		vec3 wall = board(p) * EVEN_LIGHT;
		if (id < 0.5) {
			color = wall;
		} else {
			vec3 n = normalize(vec3(-slopeAt(surface), 1.0));
			float ao = termsAt(surface.r).g;
			vec3 lit = paintAt(p, id) * EVEN_LIGHT * (0.5 + 0.5 * n.z) * ao;
			// The soft sheen of a broad source across waxy clay.
			lit += EVEN_LIGHT * 0.03 * pow(n.z, 4.0) * ao;
			color = mix(wall, lit, coverageAt());
		}
	} else if (id < 0.5) {
		color = backdrop(p);
	} else {
		bool eye = id == ${float(PIECE.eye)};
		bool dark = id == ${float(PIECE.brow)} || id == ${float(PIECE.hair)};
		bool wet = id == ${float(PIECE.tear)};
		bool shirt = id == ${float(PIECE.shirt)};
		vec3 albedo = u_shading == SHADING_CLAY ? toLinear(GREY_CLAY) : paintAt(p, id);

		vec3 n = normalize(vec3(-slopeAt(surface), 1.0));
		vec3 view = vec3(0.0, 0.0, 1.0);
		vec2 terms = termsAt(surface.r);
		float shadow = terms.r;
		float ao = terms.g;
		if (eye) {
			// Glossy beads catch some bounce in their sockets.
			ao = mix(ao, 1.0, 0.35);
			shadow = mix(shadow, 1.0, 0.25);
		}

		float keyDiffuse = max(0.0, (dot(n, KEY_DIR) + 0.05) / 1.05);
		float fillDiffuse = max(0.0, (dot(n, FILL_DIR) + 0.3) / 1.3);
		float sky = 0.55 + 0.45 * n.z;
		vec3 light = KEY * keyDiffuse * shadow + FILL * fillDiffuse * mix(0.6, 1.0, ao) + AMBIENT * sky * ao;
		// Warm light scatters just under the surface of the skin's clay.
		vec3 scatter = albedo * albedo * (1.0 - shadow * keyDiffuse) * (shirt ? 0.03 : 0.12) * ao;
		vec3 lit = albedo * light + scatter;

		vec3 halfway = normalize(KEY_DIR + view);
		float fresnel = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(n, view)), 5.0);
		// Plasticine has a soft waxy sheen; the eyes are varnished.
		float gloss = eye ? 420.0 : wet ? 220.0 : dark ? 30.0 : shirt ? 9.0 : 12.0;
		float strength = eye ? 0.07 : wet ? 0.5 : dark ? 0.22 : shirt ? 0.045 : 0.1;
		float spec = pow(max(0.0, dot(n, halfway)), gloss) * strength * (gloss + 8.0) / 24.0;
		lit += KEY * spec * shadow * mix(1.0, 1.8, fresnel);
		// A thin rim of fill light separates the clay from the backdrop: only
		// where the surface turns away toward open air, not over other clay.
		vec2 outward = normalize(vec2(n.x, -n.y) + 1e-4);
		bool open = texture(u_height, v_uv + outward * u_texel * 8.0).a < 0.5;
		float rim = open ? pow(1.0 - n.z, 3.0) * max(0.0, dot(normalize(n.xy + 1e-4), normalize(vec2(0.9, 0.2)))) : 0.0;
		lit += FILL * rim * 0.35 * ao;
		// Blend the clay's edge into the board by its true coverage.
		color = mix(backdrop(p), lit, coverageAt());
	}

	color = develop(color, u_exposure);
	vec2 centered = v_uv - 0.5;
	color *= 1.0 - 0.28 * dot(centered, centered);
	outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
#endif
`;
export const LIGHT_FRAGMENT = `#version 300 es${LIGHT_SOURCE}`;
export const TERMS_FRAGMENT = `#version 300 es
#define TERMS${LIGHT_SOURCE}`;


/**
 * Resolves the supersampled frame to the canvas. Sampling the bilinear
 * texture midway between four shading samples averages them, which smooths
 * every edge, inside the figure as well as at its outline. Film grain goes
 * on here, at the canvas's own pixels.
 */
export const RESOLVE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_frame;
in vec2 v_uv;
out vec4 outColor;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void main() {
	vec3 color = texture(u_image, v_uv).rgb;
	float grain = hash12(gl_FragCoord.xy + fract(u_frame * 0.618) * 400.0) - 0.5;
	outColor = vec4(clamp(color + grain * 0.022, 0.0, 1.0), 1.0);
}
`;
