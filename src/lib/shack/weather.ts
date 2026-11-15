import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { compassName, strengthWord } from './words';

const TAU = Math.PI * 2;

export type NightKind = 'drizzle' | 'wind' | 'snow' | 'storm' | 'gale' | 'blizzard' | 'downpour';

export type Forecast = {
	kind: NightKind;
	// Where the wind blows from, clockwise from north, in radians.
	windFrom: number;
	// How far the wind turns by the end of the night.
	shift: number;
	wind: number;
	gust: number;
	rain: number;
	snow: number;
	lightning: boolean;
	duration: number;
	headline: string;
	detail: string;
	aside: string;
};

const HEADLINES: Record<NightKind, string> = {
	drizzle: 'tonight: rain',
	wind: 'tonight: wind',
	snow: 'tonight: snow',
	storm: 'tonight: a storm',
	gale: 'tonight: a gale',
	blizzard: 'tonight: a blizzard',
	downpour: 'tonight: a downpour',
};

const ASIDES: Record<NightKind, string> = {
	drizzle: 'the kind that gets in anyway. a roof would help.',
	wind: 'hold onto something. walls, ideally.',
	snow: 'it sits on things and makes them heavy.',
	storm: 'lightning likes tall things. it\'s not personal.',
	gale: 'anything loose is leaving. nails, maybe.',
	blizzard: 'cold, sideways, and in no hurry.',
	downpour: 'roofs, basically. lots of roof.',
};

type Mix = Pick<Forecast, 'kind' | 'wind' | 'gust' | 'rain' | 'snow' | 'lightning'>;

export function forecastFor(day: number, random: () => number): Forecast {
	const windFrom = random() * TAU;
	let mix: Mix;
	if (day === 1) mix = { kind: 'drizzle', wind: 0.28, gust: 0.2, rain: 0.8, snow: 0, lightning: false };
	else if (day === 2) mix = { kind: 'wind', wind: 0.62, gust: 0.4, rain: 0.35, snow: 0, lightning: false };
	else if (day === 3) mix = { kind: 'snow', wind: 0.38, gust: 0.3, rain: 0, snow: 0.9, lightning: false };
	else {
		const strength = Math.min(1.3, 0.5 + day * 0.075);
		const roll = random();
		mix = roll < 0.35
			? { kind: 'storm', wind: strength, gust: 0.55, rain: 1, snow: 0, lightning: true }
			: roll < 0.6
				? { kind: 'gale', wind: strength * 1.12, gust: 0.75, rain: 0.3, snow: 0, lightning: false }
				: roll < 0.8
					? { kind: 'blizzard', wind: strength * 0.8, gust: 0.45, rain: 0, snow: 1, lightning: false }
					: { kind: 'downpour', wind: 0.35 + strength * 0.2, gust: 0.3, rain: 1, snow: 0, lightning: day >= 6 };
	}
	const shift = day >= 4 && random() < 0.6 ? (random() < 0.5 ? -1 : 1) * (0.6 + random() * 0.9) : 0;
	const from = compassName(windFrom);
	const turning = shift ? `, turning ${compassName(windFrom + shift)} later` : '';
	return {
		...mix,
		windFrom,
		shift,
		duration: 20 + Math.min(day, 8),
		headline: HEADLINES[mix.kind],
		detail: `${strengthWord(mix.wind)} from the ${from}${turning}.`,
		aside: ASIDES[mix.kind],
	};
}

// Unit vector pointing to where the wind comes from, with north as -z.
export function fromVector(angle: number, target = new THREE.Vector3()): THREE.Vector3 {
	return target.set(Math.sin(angle), 0, -Math.cos(angle));
}

export class Night {
	elapsed = 0;
	readonly forecast: Forecast;

	constructor(forecast: Forecast) {
		this.forecast = forecast;
	}

	get progress(): number {
		return Math.min(1, this.elapsed / this.forecast.duration);
	}

	get over(): boolean {
		return this.elapsed >= this.forecast.duration;
	}

	// The weather builds, holds, then eases off before dawn.
	get envelope(): number {
		const t = this.progress;
		return THREE.MathUtils.smoothstep(t, 0, 0.14) * (1 - THREE.MathUtils.smoothstep(t, 0.86, 1));
	}

	get windFrom(): number {
		return this.forecast.windFrom + this.forecast.shift * THREE.MathUtils.smoothstep(this.progress, 0.3, 0.75);
	}

	gust(time: number): number {
		const wave = Math.sin(time * 1.3) + Math.sin(time * 2.9 + 1.1) * 0.7 + Math.sin(time * 0.53 + 2.3);
		return 1 + this.forecast.gust * Math.max(0, wave) * 0.5;
	}

	// Horizontal wind, pointing where it blows, in metres per second of push.
	push(time: number, target = new THREE.Vector3()): THREE.Vector3 {
		return fromVector(this.windFrom, target).multiplyScalar(-this.forecast.wind * this.envelope * this.gust(time));
	}

	get rain(): number {
		return this.forecast.rain * this.envelope;
	}

	get snow(): number {
		return this.forecast.snow * this.envelope;
	}
}

// Distance along `direction` from `origin` to the first solid thing, if any.
export type StopCaster = (origin: THREE.Vector3, direction: THREE.Vector3, max: number) => number | null;

const RAIN_DROPS = 900;
const SPLASHES = 160;
const FLAKES = 700;
const STREAKS = 9;
const RAIN_SPEED = 15;
const RAIN_TOP = 9;
const SPREAD = 7.5;

function lineMaterial(width: number, opacity: number): LineMaterial {
	return new LineMaterial({ color: 0xffffff, linewidth: width, transparent: true, opacity, depthWrite: false, worldUnits: false });
}

// Rain, snow, splashes, wind streaks and the odd bolt of lightning. None of it
// is inked: it is drawn straight in ink colour, so it can be thinner than an edge.
export class Precipitation {
	readonly group = new THREE.Group();
	private readonly cast: StopCaster;
	private readonly random: () => number;

	private readonly rainGeometry = new LineSegmentsGeometry();
	private readonly rainMaterial = lineMaterial(1.25, 0.7);
	private readonly rainLines: LineSegments2;
	private readonly dropAt = new Float32Array(RAIN_DROPS * 3);
	private readonly dropDir = new Float32Array(RAIN_DROPS * 3);
	private readonly dropLeft = new Float32Array(RAIN_DROPS);
	private readonly dropHits = new Uint8Array(RAIN_DROPS);
	private readonly dropLive = new Uint8Array(RAIN_DROPS);

	private readonly splashGeometry = new LineSegmentsGeometry();
	private readonly splashMaterial = lineMaterial(1.1, 0.75);
	private readonly splashLines: LineSegments2;
	private readonly splashAt = new Float32Array(SPLASHES * 3);
	private readonly splashAge = new Float32Array(SPLASHES).fill(1);
	private readonly splashTurn = new Float32Array(SPLASHES);
	private splashNext = 0;

	private readonly flakeGeometry = new THREE.BufferGeometry();
	private readonly flakeMaterial: THREE.ShaderMaterial;
	private readonly flakeAt = new Float32Array(FLAKES * 3);
	private readonly flakeVelocity = new Float32Array(FLAKES * 3);
	private readonly flakeLeft = new Float32Array(FLAKES);
	private readonly flakeRest = new Float32Array(FLAKES);
	private readonly flakeLive = new Uint8Array(FLAKES);
	private readonly flakeAlpha = new Float32Array(FLAKES);

	private readonly streaks: { line: Line2; material: LineMaterial; age: number; life: number; velocity: THREE.Vector3 }[] = [];
	private streakTimer = 0;

	private readonly bolt: Line2;
	private readonly boltMaterial = lineMaterial(2.6, 1);
	private boltAge = 1;

	private readonly scratch = new THREE.Vector3();
	private readonly scratchDirection = new THREE.Vector3();

	constructor(cast: StopCaster, random: () => number) {
		this.cast = cast;
		this.random = random;

		this.rainGeometry.setPositions(new Float32Array(RAIN_DROPS * 6));
		this.rainGeometry.instanceCount = 0;
		this.rainLines = new LineSegments2(this.rainGeometry, this.rainMaterial);
		this.rainLines.frustumCulled = false;

		this.splashGeometry.setPositions(new Float32Array(SPLASHES * 12));
		this.splashLines = new LineSegments2(this.splashGeometry, this.splashMaterial);
		this.splashLines.frustumCulled = false;

		this.flakeGeometry.setAttribute('position', new THREE.BufferAttribute(this.flakeAt, 3));
		this.flakeGeometry.setAttribute('alpha', new THREE.BufferAttribute(this.flakeAlpha, 1));
		this.flakeMaterial = new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			uniforms: {
				uSize: { value: 5 },
				uRim: { value: new THREE.Color('#26231f') },
			},
			vertexShader: /* glsl */ `
				attribute float alpha;
				uniform float uSize;
				varying float vAlpha;
				void main() {
					vAlpha = alpha;
					gl_PointSize = uSize;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				uniform vec3 uRim;
				varying float vAlpha;
				void main() {
					float r = length(gl_PointCoord - 0.5) * 2.0;
					if (r > 1.0 || vAlpha <= 0.0) discard;
					vec3 color = mix(vec3(0.97, 0.98, 1.0), uRim, smoothstep(0.55, 0.8, r));
					gl_FragColor = vec4(color, vAlpha);
				}
			`,
		});
		const flakes = new THREE.Points(this.flakeGeometry, this.flakeMaterial);
		flakes.frustumCulled = false;

		const curl = this.streakShape();
		for (let index = 0; index < STREAKS; index += 1) {
			const geometry = new LineGeometry();
			geometry.setPositions(curl);
			const material = lineMaterial(1.8, 0);
			const line = new Line2(geometry, material);
			line.visible = false;
			line.frustumCulled = false;
			this.streaks.push({ line, material, age: 1, life: 1, velocity: new THREE.Vector3() });
			this.group.add(line);
		}

		const boltGeometry = new LineGeometry();
		boltGeometry.setPositions(new Float32Array(12 * 3));
		this.bolt = new Line2(boltGeometry, this.boltMaterial);
		this.bolt.visible = false;
		this.bolt.frustumCulled = false;

		this.group.add(this.rainLines, this.splashLines, flakes, this.bolt);
	}

	// A cartoon gust: a gentle wave that ends in a curl.
	private streakShape(): number[] {
		const points: number[] = [];
		for (let index = 0; index <= 18; index += 1) {
			const t = index / 18;
			points.push(t * 1.4, Math.sin(t * Math.PI * 1.5) * 0.06, 0);
		}
		for (let index = 1; index <= 14; index += 1) {
			const angle = -Math.PI / 2 + (index / 14) * Math.PI * 1.6;
			points.push(1.4 + Math.cos(angle) * 0.13, 0.19 + Math.sin(angle) * 0.13 - 0.06, 0);
		}
		return points;
	}

	setResolution(width: number, height: number, pixelRatio: number): void {
		for (const material of [this.rainMaterial, this.splashMaterial, this.boltMaterial, ...this.streaks.map((streak) => streak.material)]) {
			material.resolution.set(width, height);
		}
		this.flakeMaterial.uniforms.uSize.value = 5.5 * pixelRatio;
	}

	setInk(ink: THREE.Color): void {
		this.rainMaterial.color.copy(ink);
		this.splashMaterial.color.copy(ink);
		for (const streak of this.streaks) streak.material.color.copy(ink);
		this.flakeMaterial.uniforms.uRim.value.copy(ink);
	}

	private spawnDrop(index: number, push: THREE.Vector3): void {
		const direction = this.scratchDirection.set(push.x * 0.28, -1, push.z * 0.28).normalize();
		const angle = this.random() * TAU;
		const radius = Math.sqrt(this.random()) * SPREAD;
		const rise = RAIN_TOP / -direction.y;
		const start = this.scratch.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius).addScaledVector(direction, -rise);
		const max = (RAIN_TOP + 14) / -direction.y;
		const hit = this.cast(start, direction, max);
		const offset = index * 3;
		this.dropAt[offset] = start.x;
		this.dropAt[offset + 1] = start.y;
		this.dropAt[offset + 2] = start.z;
		this.dropDir[offset] = direction.x;
		this.dropDir[offset + 1] = direction.y;
		this.dropDir[offset + 2] = direction.z;
		this.dropLeft[index] = hit ?? max;
		this.dropHits[index] = hit === null ? 0 : 1;
		this.dropLive[index] = 1;
	}

	private splash(x: number, y: number, z: number): void {
		const index = this.splashNext;
		this.splashNext = (this.splashNext + 1) % SPLASHES;
		this.splashAt[index * 3] = x;
		this.splashAt[index * 3 + 1] = y;
		this.splashAt[index * 3 + 2] = z;
		this.splashAge[index] = 0;
		this.splashTurn[index] = this.random() * TAU;
	}

	private updateRain(delta: number, amount: number, push: THREE.Vector3): void {
		const wanted = Math.floor(amount * RAIN_DROPS);
		const buffer = (this.rainGeometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
		const lines = buffer.array as Float32Array;
		let drawn = 0;
		for (let index = 0; index < RAIN_DROPS; index += 1) {
			if (!this.dropLive[index]) {
				if (index >= wanted) continue;
				this.spawnDrop(index, push);
				// Spread the first fall out, so rain arrives as a shower, not a sheet.
				const head = this.random() * this.dropLeft[index];
				this.advanceDrop(index, head);
			}
			const step = RAIN_SPEED * delta;
			if (this.advanceDrop(index, step)) {
				if (this.dropHits[index] && this.random() < 0.6) {
					this.splash(this.dropAt[index * 3], this.dropAt[index * 3 + 1], this.dropAt[index * 3 + 2]);
				}
				this.dropLive[index] = 0;
				continue;
			}
			const offset = index * 3;
			const out = drawn * 6;
			lines[out] = this.dropAt[offset];
			lines[out + 1] = this.dropAt[offset + 1];
			lines[out + 2] = this.dropAt[offset + 2];
			lines[out + 3] = this.dropAt[offset] - this.dropDir[offset] * 0.3;
			lines[out + 4] = this.dropAt[offset + 1] - this.dropDir[offset + 1] * 0.3;
			lines[out + 5] = this.dropAt[offset + 2] - this.dropDir[offset + 2] * 0.3;
			drawn += 1;
		}
		buffer.needsUpdate = true;
		this.rainGeometry.instanceCount = drawn;
	}

	// Moves a drop along; true once it has reached whatever it was going to hit.
	private advanceDrop(index: number, distance: number): boolean {
		const travel = Math.min(distance, this.dropLeft[index]);
		const offset = index * 3;
		this.dropAt[offset] += this.dropDir[offset] * travel;
		this.dropAt[offset + 1] += this.dropDir[offset + 1] * travel;
		this.dropAt[offset + 2] += this.dropDir[offset + 2] * travel;
		this.dropLeft[index] -= travel;
		return this.dropLeft[index] <= 0.0001;
	}

	private updateSplashes(delta: number): void {
		const buffer = (this.splashGeometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
		const lines = buffer.array as Float32Array;
		let drawn = 0;
		for (let index = 0; index < SPLASHES; index += 1) {
			if (this.splashAge[index] >= 1) continue;
			this.splashAge[index] += delta / 0.2;
			const size = 0.05 + this.splashAge[index] * 0.06;
			const x = this.splashAt[index * 3];
			const y = this.splashAt[index * 3 + 1];
			const z = this.splashAt[index * 3 + 2];
			const cos = Math.cos(this.splashTurn[index]) * size;
			const sin = Math.sin(this.splashTurn[index]) * size;
			for (const side of [-1, 1]) {
				const out = drawn * 6;
				lines[out] = x + side * cos * 0.4;
				lines[out + 1] = y + 0.01;
				lines[out + 2] = z + side * sin * 0.4;
				lines[out + 3] = x + side * cos;
				lines[out + 4] = y + size * 1.1;
				lines[out + 5] = z + side * sin;
				drawn += 1;
			}
		}
		buffer.needsUpdate = true;
		this.splashGeometry.instanceCount = drawn;
	}

	private spawnFlake(index: number, push: THREE.Vector3): void {
		const velocity = this.scratchDirection.set(push.x * 0.9, -0.95 - this.random() * 0.4, push.z * 0.9);
		const angle = this.random() * TAU;
		const radius = Math.sqrt(this.random()) * SPREAD;
		const rise = RAIN_TOP / -velocity.y;
		const start = this.scratch.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius).addScaledVector(velocity, -rise);
		const speed = velocity.length();
		const direction = velocity.clone().divideScalar(speed);
		const max = (RAIN_TOP + 14) / -direction.y;
		const hit = this.cast(start, direction, max);
		const offset = index * 3;
		this.flakeAt[offset] = start.x;
		this.flakeAt[offset + 1] = start.y;
		this.flakeAt[offset + 2] = start.z;
		this.flakeVelocity[offset] = velocity.x;
		this.flakeVelocity[offset + 1] = velocity.y;
		this.flakeVelocity[offset + 2] = velocity.z;
		this.flakeLeft[index] = (hit ?? max) / speed;
		this.flakeRest[index] = hit === null ? 0 : 0.6 + this.random() * 0.8;
		this.flakeLive[index] = 1;
	}

	private updateSnow(delta: number, amount: number, push: THREE.Vector3, time: number): void {
		const wanted = Math.floor(amount * FLAKES);
		for (let index = 0; index < FLAKES; index += 1) {
			const offset = index * 3;
			if (!this.flakeLive[index]) {
				this.flakeAlpha[index] = 0;
				if (index >= wanted) continue;
				this.spawnFlake(index, push);
				const head = this.random() * this.flakeLeft[index];
				this.flakeLeft[index] -= head;
				for (let axis = 0; axis < 3; axis += 1) this.flakeAt[offset + axis] += this.flakeVelocity[offset + axis] * head;
			}
			if (this.flakeLeft[index] > 0) {
				const step = Math.min(delta, this.flakeLeft[index]);
				this.flakeLeft[index] -= step;
				const sway = Math.sin(time * 2 + index) * 0.25;
				this.flakeAt[offset] += (this.flakeVelocity[offset] + sway) * step;
				this.flakeAt[offset + 1] += this.flakeVelocity[offset + 1] * step;
				this.flakeAt[offset + 2] += (this.flakeVelocity[offset + 2] - sway * 0.5) * step;
				this.flakeAlpha[index] = 1;
			} else {
				// Landed. It sits for a moment and melts.
				this.flakeRest[index] -= delta;
				this.flakeAlpha[index] = Math.max(0, Math.min(1, this.flakeRest[index] * 2));
				if (this.flakeRest[index] <= 0) this.flakeLive[index] = 0;
			}
		}
		this.flakeGeometry.attributes.position.needsUpdate = true;
		this.flakeGeometry.attributes.alpha.needsUpdate = true;
	}

	private updateStreaks(delta: number, push: THREE.Vector3): void {
		const strength = push.length();
		this.streakTimer -= delta * strength;
		if (strength > 0.22 && this.streakTimer <= 0) {
			this.streakTimer = 0.35 + this.random() * 0.4;
			const streak = this.streaks.find((candidate) => candidate.age >= 1);
			if (streak) {
				const direction = push.clone().normalize();
				const across = new THREE.Vector3(-direction.z, 0, direction.x);
				const start = direction.clone().multiplyScalar(-6.5).addScaledVector(across, (this.random() - 0.5) * 9);
				start.y = 0.3 + this.random() * 2.6;
				streak.line.position.copy(start);
				streak.line.rotation.set(0, Math.atan2(-direction.z, direction.x), 0);
				streak.line.scale.setScalar(0.8 + this.random() * 0.7);
				streak.velocity.copy(direction).multiplyScalar(2.6 + strength * 3.2);
				streak.age = 0;
				streak.life = 1.4 + this.random() * 1.2;
				streak.line.visible = true;
			}
		}
		for (const streak of this.streaks) {
			if (streak.age >= 1) continue;
			streak.age += delta / streak.life;
			streak.line.position.addScaledVector(streak.velocity, delta);
			streak.material.opacity = Math.sin(Math.min(1, streak.age) * Math.PI) * 0.85;
			if (streak.age >= 1) streak.line.visible = false;
		}
	}

	strike(at: THREE.Vector3): void {
		const points: number[] = [];
		const segments = 11;
		for (let index = 0; index <= segments; index += 1) {
			const t = index / segments;
			const wander = index === 0 || index === segments ? 0 : 0.45;
			points.push(
				at.x + (this.random() - 0.5) * wander * 2 + (1 - t) * 1.2,
				at.y + (1 - t) * 12,
				at.z + (this.random() - 0.5) * wander * 2,
			);
		}
		(this.bolt.geometry as LineGeometry).setPositions(points);
		this.bolt.computeLineDistances();
		this.boltAge = 0;
		this.bolt.visible = true;
	}

	update(delta: number, time: number, rain: number, snow: number, push: THREE.Vector3): void {
		this.updateRain(delta, rain, push);
		this.updateSplashes(delta);
		this.updateSnow(delta, snow, push, time);
		this.updateStreaks(delta, push);
		if (this.boltAge < 1) {
			this.boltAge += delta / 0.22;
			this.boltMaterial.opacity = this.boltAge < 1 ? 1 - this.boltAge * 0.6 : 0;
			this.bolt.visible = this.boltAge < 1;
		}
	}

	clear(): void {
		this.dropLive.fill(0);
		this.flakeLive.fill(0);
		this.flakeAlpha.fill(0);
		this.splashAge.fill(1);
		this.rainGeometry.instanceCount = 0;
		this.splashGeometry.instanceCount = 0;
		this.flakeGeometry.attributes.alpha.needsUpdate = true;
		for (const streak of this.streaks) {
			streak.age = 1;
			streak.line.visible = false;
		}
		this.bolt.visible = false;
	}
}
