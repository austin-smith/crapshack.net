import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { RESIDENT_GROUPS, SOLID_QUERY, SQUEEZING_GROUPS } from './physics';
import { claimInkId, createFill, createInkMaterial, HIGHLIGHT_ID, inkify, setInkId } from './render';

const RADIUS = 0.18;
const HALF_HEIGHT = 0.15;
// The drawn figure is modelled a little taller than the body and scaled down to fit it.
const FIGURE_SCALE = 0.86;
// From the body's centre down to the soles of its feet.
const CENTRE_HEIGHT = RADIUS + HALF_HEIGHT;
const WALK_SPEED = 0.8;
const IDLE_SPEED = 0.45;
const DRIFT_SPEED = 1.3;

const COLORS = ['#f4b6c2', '#9fc9e8', '#f3d27a', '#b9d99b', '#d7b7e8', '#f2a98a', '#e9e4d6', '#9ed8cf', '#c9b39b'] as const;
const HAT_COLORS = ['#e0588a', '#4f7092', '#26231f', '#ef8a3d', '#7ea266', '#f6f2ea'] as const;
const UMBRELLA_COLORS = ['#e0588a', '#4f7092', '#f2c24f', '#7ea266'] as const;

export type Mood = 'meh' | 'content' | 'alarmed' | 'wet' | 'asleep';

export type ResidentState =
	| 'arriving' // floating down under an umbrella
	| 'idle' // pottering about in daylight
	| 'seeking' // heading for a spot before the weather
	| 'sheltering' // holding a spot through the night
	| 'leaving' // walking off to float away for good
	| 'drifting' // under the umbrella, on the way out
	| 'gone';

export type NightResult = 'dry' | 'damp' | 'soaked' | 'blown';

export type Exposure = {
	// How much rain or snow is reaching them, 0 to 1.
	sky: number;
	// How much wind is reaching them, 0 to 1.
	wind: number;
};

export type Weathering = {
	// Direction the wind blows toward, horizontal, scaled by its current speed.
	push: THREE.Vector3;
};

function hat(random: () => number, height: number): THREE.Group | null {
	const style = Math.floor(random() * 5);
	if (style === 0) return null;
	const group = new THREE.Group();
	const color = HAT_COLORS[Math.floor(random() * HAT_COLORS.length)];
	const material = createFill(color);
	if (style === 1) {
		// A beanie with a turned-up band.
		const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), material);
		const band = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 14), createFill(new THREE.Color(color).multiplyScalar(0.8)));
		band.position.y = 0.01;
		group.add(dome, band);
	} else if (style === 2) {
		// A small, serious top hat.
		const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16), material);
		const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.105, 0.2, 14), material);
		crown.position.y = 0.11;
		group.add(brim, crown);
	} else if (style === 3) {
		// A cap, worn with no enthusiasm.
		const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), material);
		const peak = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.12), material);
		peak.position.set(0, 0.005, 0.15);
		group.add(dome, peak);
	} else {
		// One sprig, growing out of the top of their head for no reason.
		const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.12, 4), createFill('#7ea266'));
		stem.position.y = 0.05;
		const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), createFill('#9dc47f'));
		leaf.scale.set(1.4, 0.5, 0.8);
		leaf.position.set(0.03, 0.11, 0);
		group.add(stem, leaf);
	}
	group.position.y = height;
	group.rotation.z = (random() - 0.5) * 0.25;
	for (const child of group.children) {
		if (child instanceof THREE.Mesh) child.castShadow = true;
	}
	return group;
}

function umbrella(random: () => number): THREE.Group {
	const group = new THREE.Group();
	const canopy = new THREE.Mesh(
		new THREE.ConeGeometry(0.46, 0.2, 8, 1, true),
		createFill(UMBRELLA_COLORS[Math.floor(random() * UMBRELLA_COLORS.length)], { side: THREE.DoubleSide }),
	);
	canopy.position.y = 0.7;
	canopy.castShadow = true;
	const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 5), createFill('#26231f', { plain: true }));
	stick.position.y = 0.36;
	const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 4, 8, Math.PI), stick.material);
	hook.rotation.z = Math.PI;
	hook.position.set(0.035, 0, 0);
	group.add(canopy, stick, hook);
	return group;
}

export class Resident {
	readonly name: string;
	readonly color: string;
	readonly group = new THREE.Group();
	state: ResidentState = 'arriving';
	mood: Mood = 'meh';
	target: THREE.Vector3 | null = null;
	wet = 0;
	patience = 2;
	result: NightResult | null = null;
	exposure: Exposure = { sky: 0, wind: 0 };
	// Seconds until they next decide to do something with their day.
	restless = 1 + Math.random() * 3;
	lookAtCamera = false;

	body: RAPIER.RigidBody | null = null;
	collider: RAPIER.Collider | null = null;

	private readonly world: RAPIER.World;
	private readonly figure = new THREE.Group();
	private readonly torso: THREE.Mesh;
	private readonly legs: THREE.Group[] = [];
	private readonly arms: THREE.Group[] = [];
	private readonly eyes: THREE.Mesh[] = [];
	private readonly mouth: THREE.Mesh;
	private readonly frown: THREE.Mesh;
	private readonly smile: THREE.Mesh;
	private readonly umbrella: THREE.Group;
	private readonly bodyMaterial: THREE.MeshToonMaterial;
	private readonly ink: THREE.ShaderMaterial;
	private readonly inkId: number;
	private readonly blinkOffset = Math.random() * 10;
	private yaw = Math.random() * Math.PI * 2;
	private walkPhase = 0;
	private stuckFor = 0;
	private route: THREE.Vector3[] = [];
	private squeezeFor = 0;
	private umbrellaOpen = 1;
	private hopCooldown = 0;
	private drift = new THREE.Vector3();
	private grounded = false;
	private shiver = 0;
	private readonly lastAt = new THREE.Vector3();

	constructor(world: RAPIER.World, name: string, random: () => number) {
		this.world = world;
		this.name = name;
		this.color = COLORS[Math.floor(random() * COLORS.length)];
		this.bodyMaterial = createFill(this.color);

		const width = 0.9 + random() * 0.28;
		const height = 0.85 + random() * 0.3;
		const legLength = 0.2;
		const torsoRadius = 0.19 * width;
		const torsoLength = 0.2 * height;
		this.torso = new THREE.Mesh(new THREE.CapsuleGeometry(torsoRadius, torsoLength, 6, 14), this.bodyMaterial);
		const torsoCentre = legLength + torsoRadius + torsoLength / 2 - 0.02;
		this.torso.position.y = torsoCentre;
		this.torso.castShadow = true;
		this.torso.receiveShadow = true;
		this.figure.add(this.torso);

		// Where something is in front of them, such as the roof they are
		// sheltering under, a flat silhouette shows through it.
		const xray = new THREE.Mesh(
			this.torso.geometry,
			new THREE.MeshBasicMaterial({
				color: new THREE.Color(this.color).multiplyScalar(0.8),
				transparent: true,
				opacity: 0.55,
				depthFunc: THREE.GreaterDepth,
				depthWrite: false,
			}),
		);
		xray.position.copy(this.torso.position);
		xray.renderOrder = 3;
		xray.userData.noInk = true;
		this.figure.add(xray);

		const ink = createFill('#26231f', { plain: true });
		const faceY = torsoCentre + torsoLength * 0.35;
		for (const side of [-1, 1]) {
			const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), ink);
			eye.position.set(side * 0.07 * width, faceY, torsoRadius * 0.93);
			eye.userData.noInk = true;
			this.eyes.push(eye);
			this.figure.add(eye);
		}
		this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.012), ink);
		this.mouth.position.set(0, faceY - 0.085, torsoRadius * 0.95);
		this.mouth.userData.noInk = true;
		this.frown = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.006, 4, 10, Math.PI), ink);
		this.frown.position.copy(this.mouth.position).add(new THREE.Vector3(0, -0.02, 0));
		this.frown.userData.noInk = true;
		this.smile = this.frown.clone();
		this.smile.rotation.z = Math.PI;
		this.smile.position.y += 0.03;
		this.figure.add(this.mouth, this.frown, this.smile);

		const limbMaterial = createFill('#26231f', { plain: true });
		for (const side of [-1, 1]) {
			const hip = new THREE.Group();
			hip.position.set(side * 0.075 * width, legLength + 0.01, 0);
			const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, legLength, 5), limbMaterial);
			leg.position.y = -legLength / 2;
			const foot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), limbMaterial);
			foot.scale.set(1, 0.5, 1.5);
			foot.position.set(0, -legLength, 0.02);
			leg.castShadow = true;
			hip.add(leg, foot);
			this.legs.push(hip);
			this.figure.add(hip);

			const shoulder = new THREE.Group();
			shoulder.position.set(side * torsoRadius * 0.96, torsoCentre - 0.02, 0);
			const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 5), limbMaterial);
			arm.position.y = -0.1;
			arm.castShadow = true;
			shoulder.add(arm);
			shoulder.rotation.z = side * 0.18;
			this.arms.push(shoulder);
			this.figure.add(shoulder);
		}

		const topper = hat(random, torsoCentre + torsoRadius + torsoLength / 2 - 0.03);
		if (topper) this.figure.add(topper);

		this.umbrella = umbrella(random);
		this.umbrella.position.set(0.14, torsoCentre - 0.05, 0.04);
		this.figure.add(this.umbrella);

		this.group.add(this.figure);
		this.inkId = claimInkId();
		this.ink = createInkMaterial(this.inkId);
		inkify(this.group, this.ink);
	}

	get position(): THREE.Vector3 {
		return this.group.position;
	}

	get present(): boolean {
		return this.state !== 'gone' && this.state !== 'drifting' && this.state !== 'leaving';
	}

	setHighlighted(highlighted: boolean): void {
		setInkId(this.ink, highlighted ? HIGHLIGHT_ID : this.inkId);
	}

	// Drops in from above under an umbrella, aiming for `landing`.
	spawnAbove(landing: THREE.Vector3): void {
		this.createBody(new THREE.Vector3(landing.x - 1.2, 7, landing.z + 0.8));
		this.target = landing.clone();
		this.state = 'arriving';
		this.umbrellaOpen = 1;
		this.syncFromBody();
	}

	private createBody(at: THREE.Vector3): void {
		this.removeBody();
		const body = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.dynamic()
				.setTranslation(at.x, at.y, at.z)
				.lockRotations()
				.setDominanceGroup(-1)
				.setCcdEnabled(true),
		);
		const collider = this.world.createCollider(
			RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS)
				.setDensity(1)
				// They walk by setting their own speed, so ground friction would
				// only drag on them. Min keeps it at zero whatever they stand on.
				.setFriction(0)
				.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
				.setCollisionGroups(RESIDENT_GROUPS),
			body,
		);
		this.body = body;
		this.collider = collider;
	}

	removeBody(): void {
		if (this.body) this.world.removeRigidBody(this.body);
		this.body = null;
		this.collider = null;
	}

	// Walks to the edge nearest to them, then floats off for good.
	leave(edge: THREE.Vector3): void {
		this.state = 'leaving';
		this.target = edge.clone();
		this.mood = 'meh';
	}

	seek(spot: THREE.Vector3 | null, route: THREE.Vector3[] = []): void {
		this.route = route.map((point) => point.clone());
		this.state = 'seeking';
		this.target = this.route.shift() ?? (spot ? spot.clone() : this.position.clone());
		this.stuckFor = 0;
		this.squeezeFor = 0;
	}

	wakeUp(): void {
		this.route = [];
		if (this.state === 'sheltering' || this.state === 'seeking') {
			this.state = 'idle';
			this.target = null;
			this.restless = 0.5 + Math.random() * 2;
		}
		this.setSqueezing(false);
	}

	blowAway(push: THREE.Vector3): void {
		this.removeBody();
		this.state = 'drifting';
		this.drift.copy(push).setY(0);
		if (this.drift.lengthSq() < 0.01) this.drift.set(Math.random() - 0.5, 0, Math.random() - 0.5);
		this.drift.normalize().multiplyScalar(DRIFT_SPEED);
		this.drift.y = 0.55;
	}

	private setSqueezing(squeezing: boolean): void {
		this.collider?.setCollisionGroups(squeezing ? SQUEEZING_GROUPS : RESIDENT_GROUPS);
	}

	private groundBelow(): boolean {
		if (!this.body) return false;
		const at = this.body.translation();
		const ray = new RAPIER.Ray({ x: at.x, y: at.y, z: at.z }, { x: 0, y: -1, z: 0 });
		const hit = this.world.castRay(ray, CENTRE_HEIGHT + 0.12, true, undefined, SOLID_QUERY);
		return hit !== null;
	}

	// Runs once per physics step, before the world steps.
	steer(delta: number, weather: Weathering, onIsland: (x: number, z: number) => boolean): void {
		const body = this.body;
		if (!body) return;
		this.hopCooldown = Math.max(0, this.hopCooldown - delta);
		this.grounded = this.groundBelow();
		const at = body.translation();
		const velocity = body.linvel();

		if (this.state === 'arriving') {
			const toward = this.target ? new THREE.Vector3(this.target.x - at.x, 0, this.target.z - at.z) : new THREE.Vector3();
			const reach = Math.min(1, toward.length() / 1.2);
			toward.normalize().multiplyScalar(0.9 * reach);
			body.setLinvel({ x: toward.x, y: Math.max(velocity.y, -1.25), z: toward.z }, true);
			if (this.grounded) {
				this.state = 'idle';
				this.target = null;
				this.restless = 1 + Math.random() * 2;
			}
			return;
		}

		const desired = new THREE.Vector3();
		if (this.target) {
			desired.set(this.target.x - at.x, 0, this.target.z - at.z);
			const distance = desired.length();
			const settling = this.state === 'seeking' || this.state === 'sheltering';
			// Stop inside the covered cell, not merely somewhere near it.
			const arrived = distance < (settling ? 0.045 : 0.2);
			if (arrived && this.route.length > 0) { this.target = this.route.shift()!; return; }
			if (arrived) {
				desired.set(0, 0, 0);
				if (this.state === 'seeking') {
					this.state = 'sheltering';
					this.setSqueezing(false);
				} else if (this.state === 'idle') {
					this.target = null;
				} else if (this.state === 'leaving') {
					this.blowAway(new THREE.Vector3(at.x, 0, at.z));
					return;
				}
			} else {
				const speed = this.state === 'idle' ? IDLE_SPEED : WALK_SPEED;
				desired.multiplyScalar(Math.min(speed, distance * 3) / distance);
			}
		}

		const push = weather.push.clone().multiplyScalar(this.exposure.wind);
		const goal = desired.clone().add(push);
		const response = this.grounded ? 1 - Math.exp(-delta * 10) : 1 - Math.exp(-delta * 1.5);
		const x = velocity.x + (goal.x - velocity.x) * response;
		const z = velocity.z + (goal.z - velocity.z) * response;
		body.setLinvel({ x, y: velocity.y, z }, true);

		// Blocked by something in the way: hop, and eventually squeeze past.
		// Progress is measured from where they actually got to, not the speed
		// they asked for.
		const wanting = desired.lengthSq() > 0.04;
		const travelled = Math.hypot(at.x - this.lastAt.x, at.z - this.lastAt.z) / delta;
		this.lastAt.set(at.x, at.y, at.z);
		const moving = travelled > 0.12;
		if (wanting && !moving && this.grounded) this.stuckFor += delta;
		else this.stuckFor = Math.max(0, this.stuckFor - delta * 2);
		if (this.stuckFor > 0.5 && this.hopCooldown === 0) {
			body.applyImpulse({ x: desired.x * 0.03, y: body.mass() * 3.4, z: desired.z * 0.03 }, true);
			this.hopCooldown = 0.9;
		}
		if (this.state === 'leaving' && this.stuckFor > 2.4 && this.squeezeFor <= 0) {
			this.squeezeFor = 5;
			this.stuckFor = 0;
			this.setSqueezing(true);
		}
		if (this.squeezeFor > 0) {
			this.squeezeFor -= delta;
			if (this.squeezeFor <= 0) this.setSqueezing(false);
		}

		// Nothing underneath and nothing to stand on: over the edge they go.
		if (at.y < -1.2 || (!onIsland(at.x, at.z) && at.y < -0.4)) {
			if (this.state === 'sheltering' || this.state === 'seeking') {
				this.result = 'blown';
				this.blowAway(push.lengthSq() > 0 ? push : new THREE.Vector3(at.x, 0, at.z));
			} else if (this.state === 'leaving') {
				this.blowAway(new THREE.Vector3(at.x, 0, at.z));
			} else {
				// Knocked off in daylight: they come back the way everyone arrives.
				this.spawnAbove(new THREE.Vector3(at.x * 0.4, 0, at.z * 0.4));
			}
		}
	}

	// Daylight pottering: wander somewhere nearby, or stand and stare at you.
	potter(delta: number, randomSpot: () => THREE.Vector3 | null): void {
		if (this.state !== 'idle' || this.target) return;
		this.restless -= delta;
		if (this.restless > 0) return;
		this.restless = 2.5 + Math.random() * 5;
		if (Math.random() < 0.35) {
			this.lookAtCamera = true;
			return;
		}
		this.lookAtCamera = false;
		this.target = randomSpot();
	}

	syncFromBody(): void {
		if (!this.body) return;
		const at = this.body.translation();
		this.group.position.set(at.x, at.y - CENTRE_HEIGHT, at.z);
	}

	// Pose, face and umbrella. `cameraYaw` points from the island toward the camera.
	animate(delta: number, time: number, cameraYaw: number, stillness: boolean): void {
		if (this.state === 'gone') return;
		if (this.state === 'drifting') {
			this.group.position.addScaledVector(this.drift, delta);
			this.drift.y = Math.max(0.1, this.drift.y - delta * 0.1);
			this.umbrellaOpen = Math.min(1, this.umbrellaOpen + delta * 2);
			const distance = Math.hypot(this.group.position.x, this.group.position.z);
			if (distance > 16) {
				this.state = 'gone';
				this.group.visible = false;
			}
		}

		const velocity = this.body?.linvel() ?? { x: this.drift.x, y: this.drift.y, z: this.drift.z };
		const speed = Math.hypot(velocity.x, velocity.z);
		let faceYaw = this.yaw;
		if (speed > 0.12 && this.state !== 'drifting') faceYaw = Math.atan2(velocity.x, velocity.z);
		else if (this.lookAtCamera || this.state === 'sheltering') faceYaw = cameraYaw;
		let turn = faceYaw - this.yaw;
		turn = Math.atan2(Math.sin(turn), Math.cos(turn));
		this.yaw += turn * (1 - Math.exp(-delta * 6));
		this.group.rotation.y = this.yaw;

		const floating = this.state === 'arriving' || this.state === 'drifting';
		const walking = !floating && this.grounded ? Math.min(1, speed / 0.5) : 0;
		this.walkPhase += delta * (4 + speed * 9) * (walking > 0.05 ? 1 : 0);
		const swing = Math.sin(this.walkPhase) * 0.7 * walking;
		this.legs[0].rotation.x = swing;
		this.legs[1].rotation.x = -swing;

		const windy = this.exposure.wind > 0.35 && (this.state === 'sheltering' || this.state === 'seeking');
		for (const [index, arm] of this.arms.entries()) {
			const side = index === 0 ? -1 : 1;
			const flail = windy ? 1.9 + Math.sin(time * 13 + index * 2) * 0.35 : 0;
			const holdUmbrella = index === 1 && this.umbrellaOpen > 0.5 ? 2.6 : 0;
			arm.rotation.x = (index === 0 ? swing : -swing) * 0.6;
			arm.rotation.z = side * (0.18 + Math.max(flail, holdUmbrella));
		}

		this.umbrellaOpen = floating ? Math.min(1, this.umbrellaOpen + delta * 3) : Math.max(0, this.umbrellaOpen - delta * 2.5);
		this.umbrella.visible = this.umbrellaOpen > 0.02;
		this.umbrella.scale.set(this.umbrellaOpen, 0.4 + this.umbrellaOpen * 0.6, this.umbrellaOpen);
		this.umbrella.rotation.z = floating ? Math.sin(time * 1.7) * 0.12 : 0;

		// Squash a little at rest, bob when walking, shiver when soaked.
		this.shiver = this.wet > 0.6 && this.state === 'sheltering' ? 1 : Math.max(0, this.shiver - delta);
		const bob = Math.abs(Math.sin(this.walkPhase)) * 0.03 * walking;
		const settle = this.state === 'sheltering' ? 0.93 : 1;
		this.figure.position.y = bob;
		this.figure.position.x = stillness ? 0 : Math.sin(time * 40) * 0.008 * this.shiver;
		this.figure.scale.set(FIGURE_SCALE / Math.sqrt(settle), FIGURE_SCALE * settle, FIGURE_SCALE / Math.sqrt(settle));
		this.figure.rotation.x = floating ? 0 : Math.min(0.2, speed * 0.12);

		this.mood = this.state === 'sheltering'
			? this.wet > 0.5 ? 'wet' : windy ? 'alarmed' : this.exposure.sky < 0.1 ? 'asleep' : 'meh'
			: this.wet > 0.5 ? 'wet'
				: floating && this.state !== 'arriving' ? 'alarmed'
					: this.result === 'dry' ? 'content' : 'meh';
		this.pose(time);
		this.bodyMaterial.userData.fill.uWet.value = Math.min(1, this.wet);
	}

	private pose(time: number): void {
		const blinking = (time + this.blinkOffset) % 4.3 < 0.12;
		let lid = 0.55;
		if (this.mood === 'alarmed') lid = 1.25;
		else if (this.mood === 'asleep' || blinking) lid = 0.12;
		else if (this.mood === 'wet') lid = 0.8;
		for (const [index, eye] of this.eyes.entries()) {
			eye.scale.set(1, lid, 1);
			eye.rotation.z = this.mood === 'wet' ? (index === 0 ? -0.35 : 0.35) : 0;
		}
		this.mouth.visible = this.mood === 'meh' || this.mood === 'asleep' || this.mood === 'alarmed';
		this.mouth.scale.x = this.mood === 'alarmed' ? 0.5 : 1;
		this.frown.visible = this.mood === 'wet';
		this.smile.visible = this.mood === 'content';
	}

	dispose(): void {
		this.removeBody();
		this.group.removeFromParent();
		const materials = new Set<THREE.Material>();
		this.group.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			child.geometry.dispose();
			materials.add(child.material as THREE.Material);
		});
		for (const material of materials) material.dispose();
		this.ink.dispose();
	}
}

export { CENTRE_HEIGHT as RESIDENT_CENTRE_HEIGHT, HALF_HEIGHT as RESIDENT_HALF_HEIGHT, RADIUS as RESIDENT_RADIUS };
