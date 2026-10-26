import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createFill } from './render';

type Vec3 = readonly [number, number, number];

type PartBase = {
	// Offset from the piece's centre, in metres.
	at?: Vec3;
	// Euler rotation in degrees.
	turn?: Vec3;
	color?: string;
	// Drawn but not solid: knobs, slats, trim.
	trim?: boolean;
	// Solid but not drawn: stands in for a shape the physics cannot use.
	hidden?: boolean;
};

export type Part = PartBase & (
	| { shape: 'box'; size: Vec3 }
	| { shape: 'cylinder'; radius: number; height: number; radiusTop?: number }
	| { shape: 'cone'; radius: number; height: number }
	| { shape: 'sphere'; radius: number }
	| { shape: 'torus'; radius: number; tube: number }
	| { shape: 'corrugated'; size: Vec3; ridges: number }
);

export type JunkKind = {
	id: string;
	name: string;
	blurb: string;
	color: string;
	density: number;
	friction?: number;
	// How much wind passes straight through, from 0 (none) to 1 (all of it).
	porosity?: number;
	// Relative odds of washing up. Zero keeps it out of the random draw.
	rarity: number;
	// The first day it can wash up.
	firstDay?: number;
	parts: Part[];
};

const WOOD = '#c89b6d';
const DARK_WOOD = '#a9794c';

export const JUNK: readonly JunkKind[] = [
	{
		id: 'plank',
		name: 'plank',
		blurb: 'a plank. structurally, a plank.',
		color: WOOD,
		density: 0.6,
		rarity: 6,
		parts: [{ shape: 'box', size: [2.1, 0.08, 0.34] }],
	},
	{
		id: 'two-by-four',
		name: 'two-by-four',
		blurb: 'the backbone of every regret.',
		color: DARK_WOOD,
		density: 0.65,
		rarity: 4,
		parts: [{ shape: 'box', size: [1.7, 0.12, 0.12] }],
	},
	{
		id: 'door',
		name: 'door',
		blurb: 'a door. it doesn\'t lead anywhere anymore.',
		color: '#8fb0c9',
		density: 0.5,
		rarity: 3,
		parts: [
			{ shape: 'box', size: [0.9, 1.9, 0.07] },
			{ shape: 'box', size: [0.6, 0.66, 0.012], at: [0, 0.44, 0.04], color: '#7c9fba', trim: true },
			{ shape: 'box', size: [0.6, 0.66, 0.012], at: [0, -0.44, 0.04], color: '#7c9fba', trim: true },
			{ shape: 'sphere', radius: 0.045, at: [0.34, 0, 0.07], color: '#d8b24a', trim: true },
			{ shape: 'sphere', radius: 0.045, at: [0.34, 0, -0.07], color: '#d8b24a', trim: true },
		],
	},
	{
		id: 'pallet',
		name: 'pallet',
		blurb: 'it has carried things. it\'s tired.',
		color: '#d8bb8b',
		density: 0.32,
		rarity: 4,
		parts: [
			{ shape: 'box', size: [1.2, 0.14, 1.0], hidden: true },
			...[-0.42, -0.21, 0, 0.21, 0.42].map((z): Part => ({ shape: 'box', size: [1.2, 0.03, 0.14], at: [0, 0.055, z], trim: true })),
			...[-0.5, 0, 0.5].map((x): Part => ({ shape: 'box', size: [0.1, 0.08, 1.0], at: [x, -0.001, 0], color: '#c4a472', trim: true })),
			...[-0.42, 0, 0.42].map((z): Part => ({ shape: 'box', size: [1.2, 0.03, 0.14], at: [0, -0.055, z], trim: true })),
		],
	},
	{
		id: 'crate',
		name: 'crate',
		blurb: 'empty, which is somehow worse.',
		color: '#d4a266',
		density: 0.45,
		rarity: 4,
		parts: [
			{ shape: 'box', size: [0.8, 0.8, 0.8] },
			{ shape: 'box', size: [0.83, 0.1, 0.83], at: [0, 0.23, 0], color: '#bd8a4f', trim: true },
			{ shape: 'box', size: [0.83, 0.1, 0.83], at: [0, -0.23, 0], color: '#bd8a4f', trim: true },
		],
	},
	{
		id: 'sheet',
		name: 'tin sheet',
		blurb: 'loud when it rains, which is the point.',
		color: '#aab8c1',
		density: 1.5,
		rarity: 4,
		parts: [
			{ shape: 'box', size: [1.7, 0.06, 1.05], hidden: true },
			{ shape: 'corrugated', size: [1.7, 0.03, 1.05], ridges: 9, trim: true },
		],
	},
	{
		id: 'tire',
		name: 'tire',
		blurb: 'it\'s been places.',
		color: '#3d3a38',
		density: 1.7,
		rarity: 3,
		parts: [
			{ shape: 'cylinder', radius: 0.42, height: 0.26, hidden: true },
			{ shape: 'torus', radius: 0.29, tube: 0.13, turn: [90, 0, 0], trim: true },
			{ shape: 'cylinder', radius: 0.17, height: 0.06, color: '#9aa3a8', trim: true },
		],
	},
	{
		id: 'bathtub',
		name: 'bathtub',
		blurb: 'someone misses it.',
		color: '#f3efe4',
		density: 2.1,
		rarity: 2,
		firstDay: 2,
		parts: [
			{ shape: 'box', size: [1.5, 0.08, 0.75], at: [0, -0.235, 0] },
			{ shape: 'box', size: [1.5, 0.47, 0.07], at: [0, 0.04, 0.34] },
			{ shape: 'box', size: [1.5, 0.47, 0.07], at: [0, 0.04, -0.34] },
			{ shape: 'box', size: [0.07, 0.47, 0.61], at: [0.715, 0.04, 0] },
			{ shape: 'box', size: [0.07, 0.47, 0.61], at: [-0.715, 0.04, 0] },
			...[[-0.6, -0.26], [0.6, -0.26], [-0.6, 0.26], [0.6, 0.26]].map(([x, z]): Part => ({
				shape: 'sphere', radius: 0.065, at: [x, -0.3, z], color: '#c9a55a', trim: true,
			})),
		],
	},
	{
		id: 'fridge',
		name: 'fridge',
		blurb: 'still humming, somehow.',
		color: '#bfe0cf',
		density: 0.9,
		rarity: 2,
		firstDay: 2,
		parts: [
			{ shape: 'box', size: [0.72, 1.55, 0.7] },
			{ shape: 'box', size: [0.73, 0.025, 0.71], at: [0, 0.27, 0], color: '#94bea9', trim: true },
			{ shape: 'box', size: [0.04, 0.34, 0.05], at: [0.27, 0.5, 0.37], color: '#8b979c', trim: true },
			{ shape: 'box', size: [0.04, 0.5, 0.05], at: [0.27, -0.1, 0.37], color: '#8b979c', trim: true },
		],
	},
	{
		id: 'cone',
		name: 'traffic cone',
		blurb: 'it\'s warning you about something.',
		color: '#ef8a3d',
		density: 0.5,
		rarity: 2,
		parts: [
			{ shape: 'cone', radius: 0.2, height: 0.62, at: [0, 0.04, 0] },
			{ shape: 'box', size: [0.44, 0.05, 0.44], at: [0, -0.3, 0] },
			{ shape: 'cylinder', radius: 0.132, radiusTop: 0.098, height: 0.12, at: [0, 0.03, 0], color: '#f6f2ea', trim: true },
		],
	},
	{
		id: 'mattress',
		name: 'mattress',
		blurb: 'don\'t think about it.',
		color: '#efd9e3',
		density: 0.22,
		friction: 1.2,
		rarity: 2,
		parts: [
			{ shape: 'box', size: [1.9, 0.22, 1.0] },
			...[-0.3, 0, 0.3].map((z): Part => ({ shape: 'box', size: [1.88, 0.012, 0.09], at: [0, 0.111, z], color: '#dcb6c7', trim: true })),
		],
	},
	{
		id: 'ladder',
		name: 'ladder',
		blurb: 'goes up. that\'s about it.',
		color: '#c49464',
		density: 0.6,
		porosity: 0.75,
		rarity: 2,
		parts: [
			{ shape: 'box', size: [0.06, 2.0, 0.07], at: [-0.24, 0, 0] },
			{ shape: 'box', size: [0.06, 2.0, 0.07], at: [0.24, 0, 0] },
			...[-0.75, -0.45, -0.15, 0.15, 0.45, 0.75].map((y): Part => ({ shape: 'box', size: [0.42, 0.05, 0.05], at: [0, y, 0] })),
		],
	},
	{
		id: 'barrel',
		name: 'barrel',
		blurb: 'empty. it sloshes anyway.',
		color: '#6f90b0',
		density: 0.75,
		rarity: 2,
		parts: [
			{ shape: 'cylinder', radius: 0.32, height: 0.9 },
			{ shape: 'cylinder', radius: 0.328, height: 0.045, at: [0, 0.24, 0], color: '#58789a', trim: true },
			{ shape: 'cylinder', radius: 0.328, height: 0.045, at: [0, -0.24, 0], color: '#58789a', trim: true },
		],
	},
	{
		id: 'chair',
		name: 'chair',
		blurb: 'for sitting. or not.',
		color: '#9dbf9f',
		density: 0.6,
		porosity: 0.4,
		rarity: 2,
		parts: [
			{ shape: 'box', size: [0.5, 0.06, 0.5] },
			{ shape: 'box', size: [0.5, 0.55, 0.06], at: [0, 0.3, -0.22] },
			...[[-0.21, -0.21], [0.21, -0.21], [-0.21, 0.21], [0.21, 0.21]].map(([x, z]): Part => ({
				shape: 'box', size: [0.05, 0.45, 0.05], at: [x, -0.25, z],
			})),
		],
	},
	{
		id: 'window',
		name: 'window',
		blurb: 'the view is optional.',
		color: '#efe7d3',
		density: 0.6,
		rarity: 2,
		firstDay: 2,
		parts: [
			{ shape: 'box', size: [1.0, 0.08, 0.08], at: [0, 0.46, 0] },
			{ shape: 'box', size: [1.0, 0.08, 0.08], at: [0, -0.46, 0] },
			{ shape: 'box', size: [0.08, 0.84, 0.08], at: [0.46, 0, 0] },
			{ shape: 'box', size: [0.08, 0.84, 0.08], at: [-0.46, 0, 0] },
			{ shape: 'box', size: [0.84, 0.84, 0.02], color: '#cfe5ee' },
			{ shape: 'box', size: [0.84, 0.03, 0.035], color: '#e2d8bf', trim: true },
			{ shape: 'box', size: [0.03, 0.84, 0.035], color: '#e2d8bf', trim: true },
		],
	},
	{
		id: 'sign',
		name: 'road sign',
		blurb: 'it just says slow. fair enough.',
		color: '#f2c24f',
		density: 0.8,
		porosity: 0.2,
		rarity: 1,
		firstDay: 3,
		parts: [
			{ shape: 'cylinder', radius: 0.035, height: 1.6, at: [0, -0.3, 0], color: '#8d969b' },
			{ shape: 'box', size: [0.6, 0.6, 0.03], at: [0, 0.62, 0.04], turn: [0, 0, 45] },
		],
	},
];

export const JUNK_BY_ID = new Map(JUNK.map((kind) => [kind.id, kind]));

// Day one always gets enough for a lean-to and a roof, so the first night
// is a lesson rather than a coin toss.
export const STARTER_KIT = ['plank', 'plank', 'door', 'pallet', 'crate', 'crate', 'sheet', 'tire'] as const;

export function junkKind(id: string): JunkKind {
	const kind = JUNK_BY_ID.get(id);
	if (!kind) throw new Error(`Unknown junk: ${id}`);
	return kind;
}

export function drawJunk(day: number, count: number, random: () => number): JunkKind[] {
	const pool = JUNK.filter((kind) => kind.rarity > 0 && (kind.firstDay ?? 1) <= day);
	const total = pool.reduce((sum, kind) => sum + kind.rarity, 0);
	const drawn: JunkKind[] = [];
	for (let index = 0; index < count; index += 1) {
		let roll = random() * total;
		const kind = pool.find((candidate) => (roll -= candidate.rarity) < 0) ?? pool[0];
		drawn.push(kind);
	}
	return drawn;
}

const DEGREES = Math.PI / 180;

function partQuaternion(part: Part): THREE.Quaternion {
	const [x, y, z] = part.turn ?? [0, 0, 0];
	return new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEGREES, y * DEGREES, z * DEGREES));
}

function isSolid(part: Part): part is Part & { shape: 'box' | 'cylinder' | 'cone' } {
	return !part.trim && (part.shape === 'box' || part.shape === 'cylinder' || part.shape === 'cone');
}

function hash3(x: number, y: number, z: number, seed: number): number {
	const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
	return value - Math.floor(value);
}

// Nudges every corner a little so nothing is quite square. Corners shared
// by several faces hash to the same offset, so the mesh stays closed.
function wonk(geometry: THREE.BufferGeometry, size: Vec3, seed: number): void {
	const position = geometry.getAttribute('position');
	const amplitude = size.map((axis) => Math.min(0.022, axis * 0.05));
	for (let index = 0; index < position.count; index += 1) {
		const x = position.getX(index);
		const y = position.getY(index);
		const z = position.getZ(index);
		const key = [Math.round(x * 1e4), Math.round(y * 1e4), Math.round(z * 1e4)];
		position.setXYZ(
			index,
			x + (hash3(key[0], key[1], key[2], seed) - 0.5) * 2 * amplitude[0],
			y + (hash3(key[1], key[2], key[0], seed + 3) - 0.5) * 2 * amplitude[1],
			z + (hash3(key[2], key[0], key[1], seed + 7) - 0.5) * 2 * amplitude[2],
		);
	}
	geometry.computeVertexNormals();
}

function corrugated(size: Vec3, ridges: number): THREE.BufferGeometry {
	const [width, , depth] = size;
	const geometry = new THREE.PlaneGeometry(width, depth, ridges * 8, 1);
	geometry.rotateX(-Math.PI / 2);
	const position = geometry.getAttribute('position');
	for (let index = 0; index < position.count; index += 1) {
		const x = position.getX(index);
		position.setY(index, Math.sin((x / width + 0.5) * ridges * Math.PI * 2) * 0.026);
	}
	geometry.computeVertexNormals();
	return geometry;
}

function partGeometry(part: Part, seed: number): THREE.BufferGeometry {
	switch (part.shape) {
		case 'box': {
			const geometry = new THREE.BoxGeometry(...part.size);
			if (!part.trim) wonk(geometry, part.size, seed);
			return geometry;
		}
		case 'cylinder':
			return new THREE.CylinderGeometry(part.radiusTop ?? part.radius, part.radius, part.height, 20);
		case 'cone':
			return new THREE.ConeGeometry(part.radius, part.height, 20);
		case 'sphere':
			return new THREE.SphereGeometry(part.radius, 12, 8);
		case 'torus':
			return new THREE.TorusGeometry(part.radius, part.tube, 10, 26);
		case 'corrugated':
			return corrugated(part.size, part.ridges);
	}
}

export type JunkModel = {
	group: THREE.Group;
	materials: THREE.MeshToonMaterial[];
};

export function buildJunkModel(kind: JunkKind, seed: number): JunkModel {
	const group = new THREE.Group();
	const materials = new Map<string, THREE.MeshToonMaterial>();
	for (const part of kind.parts) {
		if (part.hidden) continue;
		const color = part.color ?? kind.color;
		const side = part.shape === 'corrugated' ? THREE.DoubleSide : THREE.FrontSide;
		const key = `${color}:${side}`;
		let material = materials.get(key);
		if (!material) {
			material = createFill(color, { side });
			materials.set(key, material);
		}
		const mesh = new THREE.Mesh(partGeometry(part, seed), material);
		mesh.position.set(...(part.at ?? [0, 0, 0]));
		mesh.quaternion.copy(partQuaternion(part));
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		group.add(mesh);
	}
	return { group, materials: [...materials.values()] };
}

type SolidShape = RAPIER.Cuboid | RAPIER.Cylinder | RAPIER.Cone;

function solidShape(part: Part & { shape: 'box' | 'cylinder' | 'cone' }): SolidShape {
	if (part.shape === 'box') return new RAPIER.Cuboid(part.size[0] / 2, part.size[1] / 2, part.size[2] / 2);
	if (part.shape === 'cylinder') return new RAPIER.Cylinder(part.height / 2, Math.max(part.radius, part.radiusTop ?? 0));
	return new RAPIER.Cone(part.height / 2, part.radius);
}

export function junkColliders(kind: JunkKind): RAPIER.ColliderDesc[] {
	return kind.parts.filter(isSolid).map((part) => {
		const rotation = partQuaternion(part);
		const [x, y, z] = part.at ?? [0, 0, 0];
		return new RAPIER.ColliderDesc(solidShape(part))
			.setTranslation(x, y, z)
			.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
			.setDensity(kind.density)
			.setFriction(kind.friction ?? 0.9)
			.setRestitution(0.04);
	});
}

export type JunkShape = {
	// Every solid part as one shape, for casting the placement ghost.
	compound: RAPIER.Compound;
	// Half extents of the solid parts' box in the piece's own frame.
	half: THREE.Vector3;
	// Centre of that box, which is not always the piece's origin.
	centre: THREE.Vector3;
};

const shapes = new Map<string, JunkShape>();

export function junkShape(kind: JunkKind): JunkShape {
	const cached = shapes.get(kind.id);
	if (cached) return cached;
	const solids = kind.parts.filter(isSolid);
	const box = new THREE.Box3();
	for (const part of solids) {
		const extent = part.shape === 'box'
			? new THREE.Vector3(part.size[0] / 2, part.size[1] / 2, part.size[2] / 2)
			: new THREE.Vector3(Math.max(part.radius, part.shape === 'cylinder' ? part.radiusTop ?? 0 : 0), part.height / 2, part.radius);
		const partBox = new THREE.Box3(extent.clone().negate(), extent);
		const matrix = new THREE.Matrix4().compose(
			new THREE.Vector3(...(part.at ?? [0, 0, 0])),
			partQuaternion(part),
			new THREE.Vector3(1, 1, 1),
		);
		box.union(partBox.applyMatrix4(matrix));
	}
	const shape: JunkShape = {
		compound: new RAPIER.Compound(
			solids.map(solidShape),
			solids.map((part) => {
				const [x, y, z] = part.at ?? [0, 0, 0];
				return { x, y, z };
			}),
			solids.map((part) => {
				const rotation = partQuaternion(part);
				return { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
			}),
		),
		half: box.getSize(new THREE.Vector3()).multiplyScalar(0.5),
		centre: box.getCenter(new THREE.Vector3()),
	};
	shapes.set(kind.id, shape);
	return shape;
}

export type Pose = {
	name: string;
	// Which of the piece's own axes points up in this pose.
	axis: 'x' | 'y' | 'z';
	rotation: THREE.Quaternion;
};

const POSE_ROTATIONS = {
	y: new THREE.Quaternion(),
	z: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
	x: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
} as const;

const poses = new Map<string, Pose[]>();

// The distinct ways a piece can rest, shortest first. A crate has one, a
// tyre two (flat or rolling), a plank three (flat, on its edge, on its end).
export function junkPoses(kind: JunkKind): Pose[] {
	const cached = poses.get(kind.id);
	if (cached) return cached;
	const half = junkShape(kind).half;
	const sorted = (['x', 'y', 'z'] as const)
		.map((axis) => ({ axis, height: half[axis] }))
		.sort((a, b) => a.height - b.height);
	const distinct = sorted.filter((entry, index) => index === 0 || entry.height > sorted[index - 1].height * 1.08);
	const names = distinct.length === 3 ? ['flat', 'on its side', 'upright'] : distinct.length === 2 ? ['flat', 'upright'] : ['as it is'];
	const result = distinct.map((entry, index) => ({
		name: names[index],
		axis: entry.axis,
		rotation: POSE_ROTATIONS[entry.axis].clone(),
	}));
	poses.set(kind.id, result);
	return result;
}
