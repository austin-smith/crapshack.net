import * as THREE from 'three';

// Anything on this layer gets ink lines. Rain, splashes and wind streaks stay
// on layer 0 only, so they are drawn but never outlined.
export const INK_LAYER = 1;

// Ink ids live in one byte of the geometry pass. The top three are reserved:
// the placement ghost draws marching pink dashes, a highlight draws solid
// pink, and anything that will not stay up draws in the warning colour.
export const GHOST_ID = 255;
export const HIGHLIGHT_ID = 254;
export const WOBBLY_ID = 253;
const MAX_PLAIN_ID = 252;

// How often the ink lines are redrawn, in drawings per second. Lines hold
// still between drawings, which is what makes them read as drawn by hand.
const BOIL_RATE = 8;

let nextInkId = 1;

export function claimInkId(): number {
	const id = nextInkId;
	nextInkId = nextInkId >= MAX_PLAIN_ID ? 1 : nextInkId + 1;
	return id;
}

// Shared by every fill so their hatching redraws in step with the ink.
const sharedUniforms = {
	uHatchShift: { value: new THREE.Vector2() },
	uPixelRatio: { value: 1 },
};

export type FillUniforms = {
	uSnow: THREE.IUniform<number>;
	uWet: THREE.IUniform<number>;
};

export type FillOptions = {
	transparent?: boolean;
	opacity?: number;
	side?: THREE.Side;
	// Flat things that should never catch snow or show a wash, such as eyes.
	plain?: boolean;
};

export function fillUniforms(material: THREE.Material): FillUniforms | undefined {
	return material.userData.fill as FillUniforms | undefined;
}

const FILL_VERTEX_PARS = /* glsl */ `
varying vec3 vFillWorld;
varying vec3 vFillNormal;
`;

const FILL_FRAGMENT_PARS = /* glsl */ `
varying vec3 vFillWorld;
varying vec3 vFillNormal;
uniform float uSnow;
uniform float uWet;
uniform vec2 uHatchShift;
uniform float uPixelRatio;

float fillHash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float fillNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(fillHash(i), fillHash(i + vec2(1.0, 0.0)), u.x),
		mix(fillHash(i + vec2(0.0, 1.0)), fillHash(i + vec2(1.0, 1.0)), u.x),
		u.y
	);
}
`;

// Uneven pigment, snow on anything facing the sky, and a darker soak.
const FILL_COLOR = /* glsl */ `
#include <color_fragment>
#ifndef FILL_PLAIN
	float wash = fillNoise(vFillWorld.xz * 1.6 + vFillWorld.y * 0.8) * 0.65
		+ fillNoise(vFillWorld.xz * 5.3 - vFillWorld.y * 2.1) * 0.35;
	diffuseColor.rgb *= 0.92 + 0.14 * wash;
	float snowCover = uSnow * smoothstep(0.5, 0.8, normalize(vFillNormal).y);
	snowCover *= smoothstep(0.2, 0.5, fillNoise(vFillWorld.xz * 7.0) + uSnow * 0.6);
	diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.96, 1.0), snowCover);
#endif
	diffuseColor.rgb *= 1.0 - 0.38 * uWet;
`;

// Diagonal hatching across anything in shadow. Toon lighting only ever drops
// the direct light to zero inside a cast shadow, so that is what it keys on.
const FILL_HATCH = /* glsl */ `
#include <lights_fragment_end>
#ifndef FILL_PLAIN
	float fillDirect = dot(reflectedLight.directDiffuse, vec3(1.0)) / max(dot(diffuseColor.rgb, vec3(1.0)), 0.0001);
	vec2 hatchCoord = gl_FragCoord.xy / uPixelRatio + uHatchShift;
	float hatchLine = abs(fract((hatchCoord.x + hatchCoord.y) / 6.5) - 0.5);
	float hatch = (1.0 - smoothstep(0.1, 0.2, hatchLine)) * (1.0 - smoothstep(0.02, 0.14, fillDirect));
	reflectedLight.indirectDiffuse *= 1.0 - hatch * 0.2;
#endif
`;

export function createFill(color: THREE.ColorRepresentation, options: FillOptions = {}): THREE.MeshToonMaterial {
	const material = new THREE.MeshToonMaterial({
		color,
		transparent: options.transparent ?? false,
		opacity: options.opacity ?? 1,
		side: options.side ?? THREE.FrontSide,
		depthWrite: !options.transparent,
	});
	const uniforms: FillUniforms = { uSnow: { value: 0 }, uWet: { value: 0 } };
	material.userData.fill = uniforms;
	if (options.plain) material.defines = { FILL_PLAIN: '' };
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms, sharedUniforms);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\n${FILL_VERTEX_PARS}`)
			.replace(
				'#include <fog_vertex>',
				'#include <fog_vertex>\n\tvFillWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n\tvFillNormal = normalize(mat3(modelMatrix) * objectNormal);',
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${FILL_FRAGMENT_PARS}`)
			.replace('#include <color_fragment>', FILL_COLOR)
			.replace('#include <lights_fragment_end>', FILL_HATCH);
	};
	material.customProgramCacheKey = () => (options.plain ? 'shack-fill-plain' : 'shack-fill');
	return material;
}

// The geometry pass: view-space normal in rgb, ink id in alpha. An
// `outlineOnly` material writes one flat normal, so the only lines drawn are
// around its silhouette, not along every fold where its parts meet.
export function createInkMaterial(id: number, outlineOnly = false): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: { uId: { value: id } },
		defines: outlineOnly ? { INK_OUTLINE_ONLY: '' } : {},
		side: THREE.DoubleSide,
		vertexShader: /* glsl */ `
			varying vec3 vInkNormal;
			void main() {
				vInkNormal = normalize(normalMatrix * normal);
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float uId;
			varying vec3 vInkNormal;
			void main() {
				#ifdef INK_OUTLINE_ONLY
					vec3 n = vec3(0.0, 0.0, 1.0);
				#else
					vec3 n = normalize(vInkNormal) * (gl_FrontFacing ? 1.0 : -1.0);
				#endif
				gl_FragColor = vec4(n * 0.5 + 0.5, uId / 255.0);
			}
		`,
	});
}

// Marks every mesh under `object` as inked with the given geometry-pass
// material. Meshes that opt out with `userData.noInk` stay unlined.
export function inkify(object: THREE.Object3D, ink: THREE.ShaderMaterial): void {
	object.traverse((child) => {
		if (!(child instanceof THREE.Mesh) || child.userData.noInk) return;
		child.layers.enable(INK_LAYER);
		child.userData.ink = ink;
	});
}

export function setInkId(ink: THREE.ShaderMaterial, id: number): void {
	ink.uniforms.uId.value = id;
}

function noiseTexture(size: number, random: () => number): THREE.DataTexture {
	const data = new Uint8Array(size * size * 4);
	for (let index = 0; index < data.length; index += 1) data[index] = Math.floor(random() * 256);
	const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.needsUpdate = true;
	return texture;
}

// Fine grain plus a few long fibres, like cheap paper under a lamp.
function paperTexture(size: number, random: () => number): THREE.DataTexture {
	const values = new Float32Array(size * size);
	for (let index = 0; index < values.length; index += 1) values[index] = 0.55 + (random() - 0.5) * 0.5;
	for (let fibre = 0; fibre < 70; fibre += 1) {
		let x = random() * size;
		let y = random() * size;
		const angle = random() * Math.PI * 2;
		const length = 8 + random() * 26;
		const shade = random() < 0.5 ? -0.28 : 0.22;
		for (let step = 0; step < length; step += 1) {
			x += Math.cos(angle + Math.sin(step * 0.3) * 0.3);
			y += Math.sin(angle + Math.sin(step * 0.3) * 0.3);
			const cell = (((Math.floor(y) % size) + size) % size) * size + (((Math.floor(x) % size) + size) % size);
			values[cell] += shade;
		}
	}
	const data = new Uint8Array(size * size * 4);
	for (let index = 0; index < values.length; index += 1) {
		const value = Math.max(0, Math.min(255, Math.round(values[index] * 255)));
		data[index * 4] = value;
		data[index * 4 + 1] = value;
		data[index * 4 + 2] = value;
		data[index * 4 + 3] = 255;
	}
	const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.needsUpdate = true;
	return texture;
}

const COMPOSITE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tGeometry;
uniform sampler2D tDepth;
uniform sampler2D tNoise;
uniform sampler2D tPaper;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform vec2 uBoil;
uniform float uBoilAmount;
uniform float uLine;
uniform float uDepthRange;
uniform float uTime;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform vec3 uWarn;
uniform vec3 uGhost;
uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform float uFlash;
varying vec2 vUv;

float depthAt(vec2 uv) {
	return texture2D(tDepth, uv).r * uDepthRange;
}

void main() {
	vec2 px = 1.0 / uResolution;
	vec4 wobble = texture2D(tNoise, gl_FragCoord.xy / (34.0 * uPixelRatio * 64.0) + uBoil);
	vec2 uv = vUv + (wobble.rg - 0.5) * 2.0 * uBoilAmount * px;
	float width = uLine * (0.7 + 0.6 * wobble.b);
	vec2 dx = vec2(px.x * width, 0.0);
	vec2 dy = vec2(0.0, px.y * width);

	vec4 gc = texture2D(tGeometry, uv);
	vec4 gl = texture2D(tGeometry, uv - dx);
	vec4 gr = texture2D(tGeometry, uv + dx);
	vec4 gd = texture2D(tGeometry, uv - dy);
	vec4 gu = texture2D(tGeometry, uv + dy);

	// Under an orthographic camera depth is linear across any flat face, so
	// the second difference is zero on faces however steeply they are seen,
	// and only jumps at silhouettes and folds.
	float dc = depthAt(uv);
	float lap = abs(depthAt(uv - dx) + depthAt(uv + dx) - 2.0 * dc) + abs(depthAt(uv - dy) + depthAt(uv + dy) - 2.0 * dc);
	float depthEdge = smoothstep(0.05, 0.11, lap);

	float bend = max(
		max(distance(gc.rgb, gl.rgb), distance(gc.rgb, gr.rgb)),
		max(distance(gc.rgb, gd.rgb), distance(gc.rgb, gu.rgb))
	);
	float normalEdge = smoothstep(0.2, 0.34, bend);

	float idGap = max(max(abs(gc.a - gl.a), abs(gc.a - gr.a)), max(abs(gc.a - gd.a), abs(gc.a - gu.a)));
	float idEdge = step(0.5 / 255.0, idGap);

	float edge = max(max(depthEdge, normalEdge), idEdge);

	float special = max(max(gc.a, gl.a), max(max(gr.a, gd.a), gu.a)) * 255.0;
	vec3 lineColor = uInk;
	float lineAlpha = 0.86 + 0.14 * wobble.a;
	if (special > 254.5) {
		float dash = step(0.42, fract((gl_FragCoord.x - gl_FragCoord.y) / (13.0 * uPixelRatio) - uTime * 0.9));
		lineColor = uGhost;
		lineAlpha *= dash;
	} else if (special > 253.5) {
		lineColor = uAccent;
	} else if (special > 252.5) {
		lineColor = uWarn;
	}

	vec4 color = texture2D(tColor, vUv);
	vec3 sky = mix(uSkyBottom, uSkyTop, smoothstep(0.0, 1.0, vUv.y));
	vec3 base = color.rgb + sky * (1.0 - color.a);

	float grain = texture2D(tPaper, gl_FragCoord.xy / (256.0 * uPixelRatio)).r;
	base *= 0.95 + 0.075 * grain;
	base = mix(base, lineColor, clamp(edge * lineAlpha, 0.0, 1.0));
	base = mix(base, vec3(1.0), uFlash * 0.7);

	gl_FragColor = linearToOutputTexel(vec4(base, 1.0));
}
`;

export type InkLook = {
	ink: THREE.Color;
	accent: THREE.Color;
	// Lines on anything that would fall if left as it is.
	warn: THREE.Color;
	// The placement ghost's dashes: pink where it can go, orange where it
	// would not stay, red where it cannot go at all.
	ghost: THREE.Color;
	skyTop: THREE.Color;
	skyBottom: THREE.Color;
	flash: number;
	// Reduced motion keeps the lines drawn once and still.
	still: boolean;
};

export class InkRenderer {
	readonly renderer: THREE.WebGLRenderer;
	readonly look: InkLook = {
		ink: new THREE.Color('#26231f'),
		accent: new THREE.Color('#e0588a'),
		warn: new THREE.Color('#e27a2c'),
		ghost: new THREE.Color('#e0588a'),
		skyTop: new THREE.Color('#67a3d9'),
		skyBottom: new THREE.Color('#c8e7f5'),
		flash: 0,
		still: false,
	};

	private readonly colorTarget: THREE.WebGLRenderTarget;
	private readonly geometryTarget: THREE.WebGLRenderTarget;
	private readonly composite: THREE.ShaderMaterial;
	private readonly screenScene = new THREE.Scene();
	private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	private readonly swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
	private readonly clearColor = new THREE.Color();
	private boilTick = -1;
	private random: () => number;

	constructor(canvas: HTMLCanvasElement, random: () => number = Math.random) {
		this.random = random;
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.NoToneMapping;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		// The shadow map is refreshed by hand once a frame, before the colour
		// pass, so the geometry pass does not redraw it.
		this.renderer.shadowMap.autoUpdate = false;

		this.colorTarget = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
		const depthTexture = new THREE.DepthTexture(1, 1);
		depthTexture.type = THREE.FloatType;
		this.geometryTarget = new THREE.WebGLRenderTarget(1, 1, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			depthTexture,
		});

		this.composite = new THREE.ShaderMaterial({
			vertexShader: COMPOSITE_VERTEX,
			fragmentShader: COMPOSITE_FRAGMENT,
			depthTest: false,
			depthWrite: false,
			uniforms: {
				tColor: { value: this.colorTarget.texture },
				tGeometry: { value: this.geometryTarget.texture },
				tDepth: { value: depthTexture },
				tNoise: { value: noiseTexture(64, random) },
				tPaper: { value: paperTexture(256, random) },
				uResolution: { value: new THREE.Vector2(1, 1) },
				uPixelRatio: { value: 1 },
				uBoil: { value: new THREE.Vector2() },
				uBoilAmount: { value: 1.3 },
				uLine: { value: 1.1 },
				uDepthRange: { value: 1 },
				uTime: { value: 0 },
				uInk: { value: this.look.ink },
				uAccent: { value: this.look.accent },
				uWarn: { value: this.look.warn },
				uGhost: { value: this.look.ghost },
				uSkyTop: { value: this.look.skyTop },
				uSkyBottom: { value: this.look.skyBottom },
				uFlash: { value: 0 },
			},
		});
		const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite);
		screen.frustumCulled = false;
		this.screenScene.add(screen);
	}

	setSize(width: number, height: number, pixelRatio: number): void {
		this.renderer.setPixelRatio(pixelRatio);
		this.renderer.setSize(width, height, false);
		const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
		const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
		this.colorTarget.setSize(pixelWidth, pixelHeight);
		this.geometryTarget.setSize(pixelWidth, pixelHeight);
		const uniforms = this.composite.uniforms;
		uniforms.uResolution.value.set(pixelWidth, pixelHeight);
		uniforms.uPixelRatio.value = pixelRatio;
		uniforms.uLine.value = 1.05 * pixelRatio;
		uniforms.uBoilAmount.value = 1.35 * pixelRatio;
		sharedUniforms.uPixelRatio.value = pixelRatio;
	}

	render(scene: THREE.Scene, camera: THREE.OrthographicCamera, time: number): void {
		const uniforms = this.composite.uniforms;
		const tick = this.look.still ? 0 : Math.floor(time * BOIL_RATE);
		if (tick !== this.boilTick) {
			this.boilTick = tick;
			uniforms.uBoil.value.set(this.random(), this.random());
			sharedUniforms.uHatchShift.value.set(this.random() * 3, this.random() * 3);
		}
		uniforms.uTime.value = this.look.still ? 0 : time;
		uniforms.uDepthRange.value = camera.far - camera.near;
		uniforms.uFlash.value = this.look.flash;

		const renderer = this.renderer;
		const layers = camera.layers.mask;

		renderer.shadowMap.needsUpdate = true;
		camera.layers.set(0);
		renderer.setRenderTarget(this.colorTarget);
		renderer.setClearColor(this.clearColor.set(0, 0, 0), 0);
		renderer.clear();
		renderer.render(scene, camera);

		scene.traverseVisible((object) => {
			if (!(object instanceof THREE.Mesh) || !object.userData.ink) return;
			this.swapped.push({ mesh: object, material: object.material });
			object.material = object.userData.ink as THREE.ShaderMaterial;
		});
		camera.layers.set(INK_LAYER);
		renderer.setRenderTarget(this.geometryTarget);
		renderer.setClearColor(this.clearColor.setRGB(0.5, 0.5, 1, THREE.LinearSRGBColorSpace), 0);
		renderer.clear();
		renderer.render(scene, camera);
		for (const { mesh, material } of this.swapped) mesh.material = material;
		this.swapped.length = 0;
		camera.layers.mask = layers;

		renderer.setRenderTarget(null);
		renderer.render(this.screenScene, this.screenCamera);
	}

	dispose(): void {
		this.colorTarget.dispose();
		this.geometryTarget.dispose();
		this.composite.dispose();
		this.renderer.dispose();
	}
}
