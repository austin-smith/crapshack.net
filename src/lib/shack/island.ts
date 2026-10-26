import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLAND_GROUPS } from './physics';
import { claimInkId, createFill, createInkMaterial, inkify } from './render';

const SEGMENTS = 24;
const RIM_DEPTH = 0.35;
export const ISLAND_RADIUS = 4.6;

export type Windsock = {
	// `toward` is the horizontal direction the wind blows toward.
	update(toward: THREE.Vector3, strength: number, time: number): void;
};

export type Clouds = {
	update(delta: number, time: number): void;
	setGloom(amount: number): void;
};

export type Island = {
	group: THREE.Group;
	outline: THREE.Vector2[];
	body: RAPIER.RigidBody;
	// Materials that should collect snow.
	snowMaterials: THREE.MeshToonMaterial[];
	windsock: Windsock;
	clouds: Clouds;
	contains(x: number, z: number, margin?: number): boolean;
};

function shade(mesh: THREE.Mesh, cast = true): THREE.Mesh {
	mesh.castShadow = cast;
	mesh.receiveShadow = true;
	return mesh;
}

// A lumpy but still convex outline, so the physics hull and the drawn edge agree.
function islandOutline(random: () => number): THREE.Vector2[] {
	const phaseA = random() * Math.PI * 2;
	const phaseB = random() * Math.PI * 2;
	const outline: THREE.Vector2[] = [];
	for (let index = 0; index < SEGMENTS; index += 1) {
		const angle = (index / SEGMENTS) * Math.PI * 2;
		const radius = ISLAND_RADIUS * (1 + 0.04 * Math.cos(angle * 2 + phaseA) + 0.03 * Math.cos(angle * 3 + phaseB));
		outline.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius));
	}
	return outline;
}

function topGeometry(outline: THREE.Vector2[]): THREE.BufferGeometry {
	const positions: number[] = [];
	for (let index = 0; index < outline.length; index += 1) {
		const a = outline[index];
		const b = outline[(index + 1) % outline.length];
		positions.push(0, 0, 0, b.x, 0, b.y, a.x, 0, a.y);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.computeVertexNormals();
	return geometry;
}

function rimGeometry(outline: THREE.Vector2[]): THREE.BufferGeometry {
	const positions: number[] = [];
	const indices: number[] = [];
	for (const point of outline) positions.push(point.x, 0, point.y, point.x * 0.99, -RIM_DEPTH, point.y * 0.99);
	for (let index = 0; index < outline.length; index += 1) {
		const next = (index + 1) % outline.length;
		const top = index * 2;
		const bottom = top + 1;
		const nextTop = next * 2;
		const nextBottom = nextTop + 1;
		indices.push(top, nextTop, bottom, bottom, nextTop, nextBottom);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

// Rings of rock narrowing to a crooked point, left faceted so the facets ink.
function undersidePoints(outline: THREE.Vector2[], random: () => number): THREE.Vector3[][] {
	const rings: [number, number][] = [[-RIM_DEPTH, 0.99], [-0.85, 0.88], [-1.55, 0.68], [-2.35, 0.44], [-3.1, 0.2]];
	const lean = new THREE.Vector2(random() - 0.5, random() - 0.5).multiplyScalar(0.8);
	return rings.map(([y, scale], ring) => outline.map((point) => {
		const jitter = ring === 0 ? 1 : 1 + (random() - 0.5) * 0.16;
		const drift = ring / (rings.length - 1);
		return new THREE.Vector3(
			point.x * scale * jitter + lean.x * drift,
			y + (ring === 0 ? 0 : (random() - 0.5) * 0.24),
			point.y * scale * jitter + lean.y * drift,
		);
	}));
}

function undersideGeometry(rings: THREE.Vector3[][], tip: THREE.Vector3): THREE.BufferGeometry {
	const positions: number[] = [];
	const push = (...points: THREE.Vector3[]) => {
		for (const point of points) positions.push(point.x, point.y, point.z);
	};
	for (let ring = 0; ring < rings.length - 1; ring += 1) {
		const upper = rings[ring];
		const lower = rings[ring + 1];
		for (let index = 0; index < upper.length; index += 1) {
			const next = (index + 1) % upper.length;
			push(upper[index], upper[next], lower[index]);
			push(lower[index], upper[next], lower[next]);
		}
	}
	const last = rings[rings.length - 1];
	for (let index = 0; index < last.length; index += 1) push(last[index], last[(index + 1) % last.length], tip);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.computeVertexNormals();
	return geometry;
}

function insideOutline(outline: THREE.Vector2[], x: number, z: number, margin: number): boolean {
	// The outline is convex and wound counter-clockwise in x/z, so a point is
	// inside when it sits on the inner side of every edge.
	for (let index = 0; index < outline.length; index += 1) {
		const a = outline[index];
		const b = outline[(index + 1) % outline.length];
		const edgeX = b.x - a.x;
		const edgeZ = b.y - a.y;
		const length = Math.hypot(edgeX, edgeZ);
		const cross = (edgeX * (z - a.y) - edgeZ * (x - a.x)) / length;
		if (cross < margin) return false;
	}
	return true;
}

function grassGeometry(outline: THREE.Vector2[], random: () => number): THREE.BufferGeometry {
	const blades: THREE.BufferGeometry[] = [];
	let placed = 0;
	while (placed < 46) {
		const x = (random() - 0.5) * ISLAND_RADIUS * 2;
		const z = (random() - 0.5) * ISLAND_RADIUS * 2;
		if (!insideOutline(outline, x, z, 0.25)) continue;
		placed += 1;
		for (let blade = 0; blade < 3; blade += 1) {
			const height = 0.1 + random() * 0.09;
			const geometry = new THREE.ConeGeometry(0.022, height, 3);
			geometry.translate(0, height / 2, 0);
			geometry.rotateZ((random() - 0.5) * 0.7);
			geometry.rotateX((random() - 0.5) * 0.7);
			geometry.translate(x + (random() - 0.5) * 0.08, 0, z + (random() - 0.5) * 0.08);
			blades.push(geometry);
		}
	}
	return mergeGeometries(blades) ?? new THREE.BufferGeometry();
}

function flowers(outline: THREE.Vector2[], random: () => number): THREE.Group {
	const group = new THREE.Group();
	const stem = createFill('#7ea266');
	const petal = createFill('#f2b3c9');
	let placed = 0;
	while (placed < 7) {
		const x = (random() - 0.5) * ISLAND_RADIUS * 2;
		const z = (random() - 0.5) * ISLAND_RADIUS * 2;
		if (!insideOutline(outline, x, z, 0.4)) continue;
		placed += 1;
		const height = 0.16 + random() * 0.1;
		const stemMesh = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, height, 4), stem), false);
		stemMesh.position.set(x, height / 2, z);
		const head = shade(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), petal), false);
		head.position.set(x, height, z);
		group.add(stemMesh, head);
	}
	return group;
}

function buildWindsock(anchor: THREE.Vector3): { group: THREE.Group; windsock: Windsock } {
	const group = new THREE.Group();
	group.position.copy(anchor);
	const poleHeight = 1.5;
	const pole = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, poleHeight, 8), createFill('#8d969b')));
	pole.position.y = poleHeight / 2;
	const ball = shade(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), createFill('#8d969b')));
	ball.position.y = poleHeight + 0.02;
	group.add(pole, ball);

	const pivot = new THREE.Group();
	pivot.position.y = poleHeight - 0.08;
	group.add(pivot);
	const hoop = new THREE.Group();
	pivot.add(hoop);
	const colors = ['#e0588a', '#f6f2ea', '#e0588a'];
	const segments: THREE.Group[] = [];
	let parent: THREE.Object3D = hoop;
	for (let index = 0; index < colors.length; index += 1) {
		const joint = new THREE.Group();
		joint.position.x = index === 0 ? 0.04 : 0.2;
		const top = 0.12 - index * 0.022;
		const geometry = new THREE.CylinderGeometry(top, top - 0.022, 0.2, 12, 1, true);
		geometry.rotateZ(Math.PI / 2);
		geometry.translate(0.1, 0, 0);
		const mesh = shade(new THREE.Mesh(geometry, createFill(colors[index], { side: THREE.DoubleSide })));
		joint.add(mesh);
		parent.add(joint);
		parent = joint;
		segments.push(joint);
	}

	let yaw = 0;
	let droop = 1;
	return {
		group,
		windsock: {
			update(toward, strength, time) {
				if (toward.lengthSq() > 0.0001) {
					const target = Math.atan2(-toward.z, toward.x);
					let difference = target - yaw;
					difference = Math.atan2(Math.sin(difference), Math.cos(difference));
					yaw += difference * 0.08;
				}
				const lift = Math.min(1, strength / 0.8);
				droop += ((1 - lift) - droop) * 0.05;
				pivot.rotation.y = yaw;
				hoop.rotation.z = -droop * 1.1;
				for (const [index, segment] of segments.entries()) {
					segment.rotation.y = Math.sin(time * (5 + strength * 7) + index * 1.3) * (0.05 + strength * 0.14);
					segment.rotation.z = -droop * 0.25;
				}
			},
		},
	};
}

// A cartoon cumulus: a wide, squashed base with a few round puffs heaped on
// top, biggest in the middle.
function cloudGeometry(random: () => number): THREE.BufferGeometry {
	const base = new THREE.SphereGeometry(1, 20, 12);
	base.scale(1.55, 0.42, 0.95);
	const parts: THREE.BufferGeometry[] = [base];
	const count = 3 + Math.floor(random() * 2);
	for (let index = 0; index < count; index += 1) {
		const along = count === 1 ? 0 : index / (count - 1) - 0.5;
		const size = 0.72 - Math.abs(along) * 0.45 + random() * 0.12;
		const puff = new THREE.SphereGeometry(size, 18, 12);
		puff.translate(along * 1.7, 0.18 + size * 0.45, (random() - 0.5) * 0.35);
		parts.push(puff);
	}
	return mergeGeometries(parts) ?? new THREE.BufferGeometry();
}

function buildClouds(random: () => number): { group: THREE.Group; clouds: Clouds } {
	const group = new THREE.Group();
	const material = createFill('#fbfcff', { plain: true });
	const day = new THREE.Color('#fbfcff');
	const storm = new THREE.Color('#8e9cae');
	const drifting: { mesh: THREE.Mesh; baseY: number; phase: number }[] = [];
	const place = (count: number, minRadius: number, maxRadius: number, minY: number, maxY: number, minScale: number, maxScale: number) => {
		for (let index = 0; index < count; index += 1) {
			const angle = (index / count) * Math.PI * 2 + random() * 0.5;
			const radius = minRadius + random() * (maxRadius - minRadius);
			const mesh = new THREE.Mesh(cloudGeometry(random), material);
			const scale = minScale + random() * (maxScale - minScale);
			mesh.scale.setScalar(scale);
			mesh.position.set(Math.cos(angle) * radius, minY + random() * (maxY - minY), Math.sin(angle) * radius);
			mesh.rotation.y = random() * Math.PI;
			drifting.push({ mesh, baseY: mesh.position.y, phase: random() * Math.PI * 2 });
			group.add(mesh);
		}
	};
	place(10, 6, 11, -9.2, -7.6, 0.6, 1.05);
	place(6, 11, 15, 1.5, 5, 0.55, 0.95);
	inkify(group, createInkMaterial(claimInkId(), true));
	return {
		group,
		clouds: {
			update(delta, time) {
				group.rotation.y += delta * 0.012;
				for (const cloud of drifting) cloud.mesh.position.y = cloud.baseY + Math.sin(time * 0.35 + cloud.phase) * 0.12;
			},
			setGloom(amount) {
				material.color.copy(day).lerp(storm, amount);
			},
		},
	};
}

export function buildIsland(world: RAPIER.World, random: () => number): Island {
	const group = new THREE.Group();
	const outline = islandOutline(random);

	const grass = createFill('#a9c98b');
	const top = shade(new THREE.Mesh(topGeometry(outline), grass), false);
	const rim = shade(new THREE.Mesh(rimGeometry(outline), createFill('#b58a66')), false);
	const rings = undersidePoints(outline, random);
	const tip = new THREE.Vector3((random() - 0.5) * 0.6, -3.9, (random() - 0.5) * 0.6);
	const rock = shade(new THREE.Mesh(undersideGeometry(rings, tip), createFill('#9d8e80')), false);
	const blades = shade(new THREE.Mesh(grassGeometry(outline, random), createFill('#8db370')), false);
	group.add(top, rim, rock, blades, flowers(outline, random));

	// A few roots, and a pebble or two that never quite committed to the island.
	const rootMaterial = createFill('#7d6653');
	for (let index = 0; index < 5; index += 1) {
		const ring = rings[1 + Math.floor(random() * 2)];
		const from = ring[Math.floor(random() * ring.length)];
		const length = 0.5 + random() * 0.8;
		const root = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, length, 5), rootMaterial), false);
		root.position.set(from.x * 0.97, from.y - length / 2 + 0.05, from.z * 0.97);
		root.rotation.set((random() - 0.5) * 0.4, 0, (random() - 0.5) * 0.4);
		group.add(root);
	}

	const stumpAngle = random() * Math.PI * 2;
	const stumpAt = new THREE.Vector3(Math.cos(stumpAngle) * ISLAND_RADIUS * 0.66, 0, Math.sin(stumpAngle) * ISLAND_RADIUS * 0.66);
	const stumpMaterial = createFill('#a57a52');
	const stump = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.36, 12), stumpMaterial));
	stump.position.set(stumpAt.x, 0.18, stumpAt.z);
	const rings2 = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.01, 12), createFill('#dcbc91')));
	rings2.position.set(stumpAt.x, 0.365, stumpAt.z);
	group.add(stump, rings2);

	const sockAngle = stumpAngle + Math.PI * (0.7 + random() * 0.6);
	const sockAt = new THREE.Vector3(Math.cos(sockAngle) * ISLAND_RADIUS * 0.84, 0, Math.sin(sockAngle) * ISLAND_RADIUS * 0.84);
	const { group: sockGroup, windsock } = buildWindsock(sockAt);
	group.add(sockGroup);

	inkify(group, createInkMaterial(claimInkId()));

	const { group: cloudGroup, clouds } = buildClouds(random);
	group.add(cloudGroup);

	const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	// The ground people build on is a closed triangle mesh rather than a convex
	// hull: a box resting on a hull only ever gets one contact point, so it
	// rocks and sinks, where a mesh gives it a full face of contacts.
	const slab = [0, 0, 0, 0, -RIM_DEPTH, 0];
	for (const point of outline) slab.push(point.x, 0, point.y, point.x * 0.99, -RIM_DEPTH, point.y * 0.99);
	const faces: number[] = [];
	for (let index = 0; index < outline.length; index += 1) {
		const next = (index + 1) % outline.length;
		const top = 2 + index * 2;
		const nextTop = 2 + next * 2;
		faces.push(0, nextTop, top, 1, top + 1, nextTop + 1, top, nextTop, top + 1, top + 1, nextTop, nextTop + 1);
	}
	world.createCollider(
		RAPIER.ColliderDesc.trimesh(new Float32Array(slab), new Uint32Array(faces), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.ORIENTED)
			.setFriction(1)
			.setCollisionGroups(ISLAND_GROUPS),
		body,
	);
	const underside: number[] = [];
	for (const ring of rings.slice(1)) for (const point of ring) underside.push(point.x, point.y, point.z);
	underside.push(tip.x, tip.y, tip.z);
	const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(underside));
	if (hull) world.createCollider(hull.setFriction(1).setCollisionGroups(ISLAND_GROUPS), body);
	world.createCollider(
		RAPIER.ColliderDesc.cylinder(0.18, 0.3).setTranslation(stumpAt.x, 0.18, stumpAt.z).setFriction(1).setCollisionGroups(ISLAND_GROUPS),
		body,
	);
	world.createCollider(
		RAPIER.ColliderDesc.cylinder(0.75, 0.04).setTranslation(sockAt.x, 0.75, sockAt.z).setCollisionGroups(ISLAND_GROUPS),
		body,
	);

	return {
		group,
		outline,
		body,
		snowMaterials: [grass, stumpMaterial],
		windsock,
		clouds,
		contains: (x, z, margin = 0) => insideOutline(outline, x, z, margin),
	};
}
