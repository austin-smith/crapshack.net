type Vector = { x: number; y: number };

type Bounds = {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
};

type GlyphBounds = Bounds;

type GlyphAnalysis = {
	bounds: GlyphBounds;
	image: HTMLImageElement;
	labels: Int16Array;
	width: number;
	height: number;
};

type ConvexPart = {
	vertices: Vector[];
	normals: Vector[];
	ghostEdges: boolean[];
};

type GlyphShape = {
	sprite: HTMLCanvasElement;
	width: number;
	height: number;
	centerX: number;
	centerY: number;
	outerVertices: Vector[];
	parts: ConvexPart[];
	radius: number;
	area: number;
	momentRatio: number;
};

type RigidGlyph = {
	id: number;
	shape: GlyphShape;
	scale: number;
	x: number;
	y: number;
	angle: number;
	vx: number;
	vy: number;
	angularVelocity: number;
	pvx: number;
	pvy: number;
	pAngularVelocity: number;
	mass: number;
	invMass: number;
	invInertia: number;
	releaseAt: number;
	touching: boolean;
	idleFor: number;
	sleeping: boolean;
};

type Contact = {
	a: RigidGlyph | null;
	b: RigidGlyph;
	nx: number;
	ny: number;
	px: number;
	py: number;
	penetration: number;
	rax: number;
	ray: number;
	rbx: number;
	rby: number;
	kn: number;
	kt: number;
	normalImpulse: number;
	tangentImpulse: number;
	positionImpulse: number;
	bias: number;
	bounce: number;
};

const ALPHA_THRESHOLD = 40;
const MIN_GLYPH_PIXELS = 400;
const FIXED_STEP = 1 / 120;
const FLOOR_INSET = 18;
const CONTACT_SLOP = 0.3;
const SOLVER_ITERATIONS = 10;

function loadImage(source: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.decoding = 'async';
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`Could not load the 404 artwork from ${source}`));
		image.src = source;
	});
}

function analyzeGlyph(image: HTMLImageElement): GlyphAnalysis {
	const canvas = document.createElement('canvas');
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas 2D is unavailable');

	context.drawImage(image, 0, 0);
	const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
	const { width, height, data } = imageData;
	const labels = new Int16Array(width * height);
	labels.fill(-1);
	let pixelCount = 0;
	let minX = width;
	let minY = height;
	let maxX = 0;
	let maxY = 0;

	for (let pixel = 0; pixel < width * height; pixel += 1) {
		if (data[pixel * 4 + 3] < ALPHA_THRESHOLD) continue;
		const x = pixel % width;
		const y = Math.floor(pixel / width);
		labels[pixel] = 0;
		pixelCount += 1;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	if (pixelCount < MIN_GLYPH_PIXELS) throw new Error('Glyph asset does not contain enough visible pixels');

	return {
		bounds: { minX, minY, maxX, maxY },
		image,
		labels,
		width,
		height,
	};
}

function createGlyphSprite(bounds: GlyphBounds, analysis: GlyphAnalysis): HTMLCanvasElement {
	const width = bounds.maxX - bounds.minX + 1;
	const height = bounds.maxY - bounds.minY + 1;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas 2D is unavailable');
	context.drawImage(analysis.image, bounds.minX, bounds.minY, width, height, 0, 0, width, height);
	return canvas;
}

function simplifyLine(points: Vector[], tolerance: number): Vector[] {
	if (points.length <= 2) return points.slice();
	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;
	const ranges: Array<[number, number]> = [[0, points.length - 1]];

	while (ranges.length) {
		const [start, end] = ranges.pop()!;
		if (end - start < 2) continue;
		const a = points[start];
		const b = points[end];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const length = Math.hypot(dx, dy) || 1;
		let furthest = -1;
		let distance = tolerance;
		for (let index = start + 1; index < end; index += 1) {
			const candidate = Math.abs((points[index].x - a.x) * dy - (points[index].y - a.y) * dx) / length;
			if (candidate > distance) {
				distance = candidate;
				furthest = index;
			}
		}
		if (furthest < 0) continue;
		keep[furthest] = 1;
		ranges.push([start, furthest], [furthest, end]);
	}
	return points.filter((_, index) => keep[index] === 1);
}

function xAtY(edge: Vector[], y: number): number {
	if (y <= edge[0].y) return edge[0].x;
	for (let index = 1; index < edge.length; index += 1) {
		const previous = edge[index - 1];
		const current = edge[index];
		if (y > current.y) continue;
		const span = current.y - previous.y;
		return span > 0
			? previous.x + (current.x - previous.x) * ((y - previous.y) / span)
			: current.x;
	}
	return edge[edge.length - 1].x;
}

function makeStrip(left: Vector[], right: Vector[], rows: number[], start: number, end: number): Vector[] {
	const vertices: Vector[] = [];
	for (let index = start; index <= end; index += 1) {
		vertices.push({ x: xAtY(left, rows[index]), y: rows[index] });
	}
	for (let index = end; index >= start; index -= 1) {
		vertices.push({ x: xAtY(right, rows[index]), y: rows[index] });
	}
	return vertices;
}

function isConvex(vertices: Vector[]): boolean {
	let direction = 0;
	for (let index = 0; index < vertices.length; index += 1) {
		const a = vertices[index];
		const b = vertices[(index + 1) % vertices.length];
		const c = vertices[(index + 2) % vertices.length];
		const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
		if (Math.abs(cross) < 1e-9) continue;
		const nextDirection = cross > 0 ? 1 : -1;
		if (direction && direction !== nextDirection) return false;
		direction = nextDirection;
	}
	return true;
}

function polygonMetrics(vertices: Vector[]) {
	let crossSum = 0;
	let xSum = 0;
	let ySum = 0;
	for (let index = 0; index < vertices.length; index += 1) {
		const a = vertices[index];
		const b = vertices[(index + 1) % vertices.length];
		const cross = a.x * b.y - b.x * a.y;
		crossSum += cross;
		xSum += (a.x + b.x) * cross;
		ySum += (a.y + b.y) * cross;
	}
	return {
		area: Math.abs(crossSum) / 2,
		cx: xSum / (3 * crossSum),
		cy: ySum / (3 * crossSum),
	};
}

function createNormals(vertices: Vector[]): Vector[] {
	const center = vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.x, y: sum.y + vertex.y }), { x: 0, y: 0 });
	center.x /= vertices.length;
	center.y /= vertices.length;
	return vertices.map((vertex, index) => {
		const next = vertices[(index + 1) % vertices.length];
		let x = next.y - vertex.y;
		let y = -(next.x - vertex.x);
		const length = Math.hypot(x, y) || 1;
		x /= length;
		y /= length;
		if (x * (vertex.x - center.x) + y * (vertex.y - center.y) < 0) {
			x *= -1;
			y *= -1;
		}
		return { x, y };
	});
}

function createGlyphShape(bounds: GlyphBounds, analysis: GlyphAnalysis): GlyphShape {
	const width = bounds.maxX - bounds.minX + 1;
	const height = bounds.maxY - bounds.minY + 1;
	const left: Vector[] = [];
	const right: Vector[] = [];

	for (let sourceY = bounds.minY; sourceY <= bounds.maxY; sourceY += 1) {
		let first = -1;
		let last = -1;
		for (let sourceX = bounds.minX; sourceX <= bounds.maxX; sourceX += 1) {
			if (analysis.labels[sourceY * analysis.width + sourceX] !== 0) continue;
			if (first < 0) first = sourceX - bounds.minX;
			last = sourceX - bounds.minX + 1;
		}
		if (first >= 0) {
			left.push({ x: first, y: sourceY - bounds.minY + 0.5 });
			right.push({ x: last, y: sourceY - bounds.minY + 0.5 });
		}
	}

	const simpleLeft = simplifyLine(left, 3.5);
	const simpleRight = simplifyLine(right, 3.5);
	const rows = [...simpleLeft, ...simpleRight]
		.map((point) => point.y)
		.sort((a, b) => a - b)
		.filter((row, index, values) => index === 0 || row - values[index - 1] > 0.5);
	const bottom = left[left.length - 1].y;
	if (rows.length < 2 || bottom > rows[rows.length - 1]) rows.push(bottom);

	const rawParts: Vector[][] = [];
	let start = 0;
	while (start < rows.length - 1) {
		let end = start + 1;
		while (end + 1 < rows.length) {
			const candidate = makeStrip(simpleLeft, simpleRight, rows, start, end + 1);
			if (candidate.length > 14 || !isConvex(candidate)) break;
			end += 1;
		}
		rawParts.push(makeStrip(simpleLeft, simpleRight, rows, start, end));
		start = end;
	}

	let area = 0;
	let weightedX = 0;
	let weightedY = 0;
	for (const vertices of rawParts) {
		const metrics = polygonMetrics(vertices);
		area += metrics.area;
		weightedX += metrics.cx * metrics.area;
		weightedY += metrics.cy * metrics.area;
	}
	const centerX = weightedX / area;
	const centerY = weightedY / area;
	const shiftedParts = rawParts.map((vertices) => vertices.map((vertex) => ({
		x: vertex.x - centerX,
		y: vertex.y - centerY,
	})));
	const outerVertices = makeStrip(simpleLeft, simpleRight, rows, 0, rows.length - 1)
		.map((vertex) => ({ x: vertex.x - centerX, y: vertex.y - centerY }));

	let inertiaNumerator = 0;
	let inertiaDenominator = 0;
	for (const vertices of shiftedParts) {
		let numerator = 0;
		let denominator = 0;
		for (let index = 0; index < vertices.length; index += 1) {
			const a = vertices[index];
			const b = vertices[(index + 1) % vertices.length];
			const cross = a.x * b.y - b.x * a.y;
			numerator += cross * (a.x * a.x + a.x * b.x + b.x * b.x + a.y * a.y + a.y * b.y + b.y * b.y);
			denominator += cross;
		}
		inertiaNumerator += Math.abs(numerator);
		inertiaDenominator += Math.abs(denominator);
	}

	return {
		sprite: createGlyphSprite(bounds, analysis),
		width,
		height,
		centerX,
		centerY,
		outerVertices,
		parts: shiftedParts.map((vertices, index) => {
			const halfway = vertices.length / 2 - 1;
			return {
				vertices,
				normals: createNormals(vertices),
				ghostEdges: vertices.map((_, edge) =>
					(edge === halfway && index < shiftedParts.length - 1)
					|| (edge === vertices.length - 1 && index > 0)),
			};
		}),
		radius: Math.max(...outerVertices.map((vertex) => Math.hypot(vertex.x, vertex.y))),
		area,
		momentRatio: inertiaNumerator / (6 * (inertiaDenominator || 1)),
	};
}

function applyImpulse(body: RigidGlyph, x: number, y: number, rx: number, ry: number) {
	body.vx += x * body.invMass;
	body.vy += y * body.invMass;
	body.angularVelocity += (rx * y - ry * x) * body.invInertia;
}

function worldVertices(body: RigidGlyph): Vector[] {
	const cos = Math.cos(body.angle) * body.scale;
	const sin = Math.sin(body.angle) * body.scale;
	return body.shape.outerVertices.map((vertex) => ({
		x: body.x + vertex.x * cos - vertex.y * sin,
		y: body.y + vertex.x * sin + vertex.y * cos,
	}));
}

function pointContact(x: number, y: number, body: RigidGlyph) {
	const cos = Math.cos(body.angle);
	const sin = Math.sin(body.angle);
	const dx = x - body.x;
	const dy = y - body.y;
	const localX = (dx * cos + dy * sin) / body.scale;
	const localY = (-dx * sin + dy * cos) / body.scale;

	for (const part of body.shape.parts) {
		let edge = -1;
		let closest = -Infinity;
		let inside = true;
		for (let index = 0; index < part.vertices.length; index += 1) {
			const vertex = part.vertices[index];
			const normal = part.normals[index];
			const distance = (localX - vertex.x) * normal.x + (localY - vertex.y) * normal.y;
			if (distance > 0) {
				inside = false;
				break;
			}
			if (!part.ghostEdges[index] && distance > closest) {
				closest = distance;
				edge = index;
			}
		}
		if (!inside || edge < 0) continue;
		const normal = part.normals[edge];
		return {
			nx: normal.x * cos - normal.y * sin,
			ny: normal.x * sin + normal.y * cos,
			penetration: -closest * body.scale,
		};
	}
	return null;
}

function containsPoint(body: RigidGlyph, x: number, y: number) {
	return pointContact(x, y, body) !== null;
}

function relativeNormalVelocity(a: RigidGlyph | null, b: RigidGlyph, px: number, py: number, nx: number, ny: number) {
	let vx = b.vx - b.angularVelocity * (py - b.y);
	let vy = b.vy + b.angularVelocity * (px - b.x);
	if (a) {
		vx -= a.vx - a.angularVelocity * (py - a.y);
		vy -= a.vy + a.angularVelocity * (px - a.x);
	}
	return vx * nx + vy * ny;
}

function createContact(a: RigidGlyph | null, b: RigidGlyph, nx: number, ny: number, px: number, py: number, penetration: number, dragged: RigidGlyph | null): Contact {
	const rax = a ? px - a.x : 0;
	const ray = a ? py - a.y : 0;
	const rbx = px - b.x;
	const rby = py - b.y;
	const normalCrossB = rbx * ny - rby * nx;
	const tangentCrossB = rbx * nx + rby * ny;
	let kn = b.invMass + normalCrossB * normalCrossB * b.invInertia;
	let kt = b.invMass + tangentCrossB * tangentCrossB * b.invInertia;
	if (a) {
		const normalCrossA = rax * ny - ray * nx;
		const tangentCrossA = rax * nx + ray * ny;
		kn += a.invMass + normalCrossA * normalCrossA * a.invInertia;
		kt += a.invMass + tangentCrossA * tangentCrossA * a.invInertia;
	}
	const closingSpeed = relativeNormalVelocity(a, b, px, py, nx, ny);
	const isDraggedPair = dragged !== null && (a === dragged || b === dragged);
	return {
		a,
		b,
		nx,
		ny,
		px,
		py,
		penetration,
		rax,
		ray,
		rbx,
		rby,
		kn,
		kt,
		normalImpulse: 0,
		tangentImpulse: 0,
		positionImpulse: 0,
		bias: 0,
		bounce: -closingSpeed > 90 && !isDraggedPair ? -0.1 * closingSpeed : 0,
	};
}

function reduceContacts(contacts: Contact[]): Contact[] {
	const groups = new Map<string, Contact[]>();
	for (const contact of contacts) {
		const normalBucket = Math.round(Math.atan2(contact.ny, contact.nx) / (Math.PI / 18));
		const key = `${contact.a?.id ?? -1}:${contact.b.id}:${normalBucket}`;
		const group = groups.get(key);
		if (group) group.push(contact);
		else groups.set(key, [contact]);
	}

	const reduced: Contact[] = [];
	for (const group of groups.values()) {
		if (group.length <= 2) {
			reduced.push(...group);
			continue;
		}
		const deepest = group.reduce((best, contact) => contact.penetration > best.penetration ? contact : best);
		let furthest = group[0] === deepest ? group[1] : group[0];
		let maxDistance = -1;
		for (const contact of group) {
			if (contact === deepest) continue;
			const distance = Math.hypot(contact.px - deepest.px, contact.py - deepest.py);
			if (distance > maxDistance) {
				maxDistance = distance;
				furthest = contact;
			}
		}
		reduced.push(deepest, furthest);
	}
	return reduced;
}

function solveVelocity(contact: Contact) {
	if (contact.kn <= 0) return;
	const { a, b, nx, ny } = contact;
	const vx = b.vx - b.angularVelocity * contact.rby - (a ? a.vx - a.angularVelocity * contact.ray : 0);
	const vy = b.vy + b.angularVelocity * contact.rbx - (a ? a.vy + a.angularVelocity * contact.rax : 0);
	const normalSpeed = vx * nx + vy * ny;
	const impulse = (contact.bounce - normalSpeed) / contact.kn;
	const nextNormal = Math.max(contact.normalImpulse + impulse, 0);
	const normalChange = nextNormal - contact.normalImpulse;
	contact.normalImpulse = nextNormal;
	applyImpulse(b, normalChange * nx, normalChange * ny, contact.rbx, contact.rby);
	if (a) applyImpulse(a, -normalChange * nx, -normalChange * ny, contact.rax, contact.ray);

	if (contact.kt <= 0) return;
	const tangentX = -ny;
	const tangentY = nx;
	const nextVx = b.vx - b.angularVelocity * contact.rby - (a ? a.vx - a.angularVelocity * contact.ray : 0);
	const nextVy = b.vy + b.angularVelocity * contact.rbx - (a ? a.vy + a.angularVelocity * contact.rax : 0);
	const maxFriction = 0.9 * contact.normalImpulse;
	const tangentImpulse = -(nextVx * tangentX + nextVy * tangentY) / contact.kt;
	const nextTangent = Math.max(-maxFriction, Math.min(maxFriction, contact.tangentImpulse + tangentImpulse));
	const tangentChange = nextTangent - contact.tangentImpulse;
	contact.tangentImpulse = nextTangent;
	applyImpulse(b, tangentChange * tangentX, tangentChange * tangentY, contact.rbx, contact.rby);
	if (a) applyImpulse(a, -tangentChange * tangentX, -tangentChange * tangentY, contact.rax, contact.ray);
}

function solvePosition(contact: Contact) {
	if (contact.kn <= 0 || (contact.bias <= 0 && contact.positionImpulse <= 0)) return;
	const { a, b, nx, ny } = contact;
	const vx = b.pvx - b.pAngularVelocity * contact.rby - (a ? a.pvx - a.pAngularVelocity * contact.ray : 0);
	const vy = b.pvy + b.pAngularVelocity * contact.rbx - (a ? a.pvy + a.pAngularVelocity * contact.rax : 0);
	const impulse = (contact.bias - (vx * nx + vy * ny)) / contact.kn;
	const nextImpulse = Math.max(contact.positionImpulse + impulse, 0);
	const change = nextImpulse - contact.positionImpulse;
	contact.positionImpulse = nextImpulse;
	b.pvx += change * nx * b.invMass;
	b.pvy += change * ny * b.invMass;
	b.pAngularVelocity += (contact.rbx * change * ny - contact.rby * change * nx) * b.invInertia;
	if (a) {
		a.pvx -= change * nx * a.invMass;
		a.pvy -= change * ny * a.invMass;
		a.pAngularVelocity -= (contact.rax * change * ny - contact.ray * change * nx) * a.invInertia;
	}
}

class Physics404Scene {
	private readonly root: HTMLElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly context: CanvasRenderingContext2D;
	private readonly shapes: GlyphShape[];
	private bodies: RigidGlyph[] = [];
	private dragged: RigidGlyph | null = null;
	private dragLocalX = 0;
	private dragLocalY = 0;
	private pointerX = 0;
	private pointerY = 0;
	private simulationTime = 0;
	private accumulator = 0;
	private lastFrameTime = 0;
	private frame = 0;
	private resizeFrame = 0;
	private width = 0;
	private height = 0;
	private visible = true;
	private resizeObserver: ResizeObserver | null = null;
	private intersectionObserver: IntersectionObserver | null = null;

	constructor(root: HTMLElement, canvas: HTMLCanvasElement, analyses: GlyphAnalysis[]) {
		this.root = root;
		this.canvas = canvas;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas 2D is unavailable');
		this.context = context;
		this.shapes = analyses.map((analysis) => createGlyphShape(analysis.bounds, analysis));
		this.buildWorld();
		this.observe();
		this.canvas.addEventListener('pointerdown', this.handlePointerDown);
		this.canvas.addEventListener('pointermove', this.handlePointerMove);
		this.canvas.addEventListener('pointerup', this.handlePointerUp);
		this.canvas.addEventListener('pointercancel', this.handlePointerUp);
		this.frame = requestAnimationFrame(this.tick);
		this.root.dataset.physicsReady = 'true';
	}

	private buildWorld() {
		const bounds = this.root.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0) return;
		this.width = bounds.width;
		this.height = bounds.height;
		this.simulationTime = 0;
		this.accumulator = 0;
		this.dragged = null;

		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		this.canvas.width = Math.round(this.width * dpr);
		this.canvas.height = Math.round(this.height * dpr);
		this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.context.imageSmoothingEnabled = true;
		this.context.imageSmoothingQuality = 'high';

		const totalWidth = this.shapes.reduce((total, shape) => total + shape.width, 0) + 12 * (this.shapes.length - 1);
		const tallest = Math.max(...this.shapes.map((shape) => shape.height));
		const scale = Math.max(0.01, Math.min(this.width * 0.9 / totalWidth, this.height * 0.45 / tallest));
		const visualSize = tallest * scale;

		this.bodies = this.shapes.map((shape, index) => {
			const mass = shape.area * scale * scale * 0.002;
			const inertia = mass * shape.momentRatio * scale * scale;
			return {
				id: index,
				shape,
				scale,
				x: this.width / 2 + (index - 1) * visualSize * 0.075,
				y: -shape.radius * scale - this.height * 0.1,
				angle: (Math.random() - 0.5) * 0.14,
				vx: 0,
				vy: 0,
				angularVelocity: (Math.random() - 0.5) * 0.34,
				pvx: 0,
				pvy: 0,
				pAngularVelocity: 0,
				mass,
				invMass: 1 / mass,
				invInertia: 1 / (inertia || 1),
				releaseAt: index * 0.58 + Math.random() * 0.04,
				touching: false,
				idleFor: 0,
				sleeping: false,
			};
		});
	}

	private collectContacts() {
		const contacts: Contact[] = [];
		const active = this.bodies.filter((body) => this.simulationTime >= body.releaseAt);
		for (const body of this.bodies) body.touching = false;

		for (const body of active) {
			if (body.sleeping && body !== this.dragged) continue;
			for (const vertex of worldVertices(body)) {
				if (vertex.y > this.height - FLOOR_INSET) {
					contacts.push(createContact(null, body, 0, -1, vertex.x, vertex.y, vertex.y - (this.height - FLOOR_INSET), this.dragged));
					body.touching = true;
				}
				if (vertex.x < 0) {
					contacts.push(createContact(null, body, 1, 0, vertex.x, vertex.y, -vertex.x, this.dragged));
					body.touching = true;
				}
				if (vertex.x > this.width) {
					contacts.push(createContact(null, body, -1, 0, vertex.x, vertex.y, vertex.x - this.width, this.dragged));
					body.touching = true;
				}
			}
		}

		for (let first = 0; first < active.length; first += 1) {
			for (let second = first + 1; second < active.length; second += 1) {
				const a = active[first];
				const b = active[second];
				if (a.sleeping && b.sleeping) continue;
				if (Math.hypot(a.x - b.x, a.y - b.y) > a.shape.radius * a.scale + b.shape.radius * b.scale) continue;
				let collided = false;
				for (const [pointBody, targetBody] of [[a, b], [b, a]] as const) {
					for (const vertex of worldVertices(pointBody)) {
						const hit = pointContact(vertex.x, vertex.y, targetBody);
						if (!hit) continue;
						collided = true;
						contacts.push(createContact(targetBody, pointBody, hit.nx, hit.ny, vertex.x, vertex.y, hit.penetration, this.dragged));
					}
				}
				if (collided) {
					a.touching = true;
					b.touching = true;
					const aIsDisturbing = a === this.dragged || a.idleFor < 0.15;
					const bIsDisturbing = b === this.dragged || b.idleFor < 0.15;
					if (a.sleeping && bIsDisturbing) {
						a.sleeping = false;
						a.idleFor = 0;
					}
					if (b.sleeping && aIsDisturbing) {
						b.sleeping = false;
						b.idleFor = 0;
					}
				}
			}
		}
		return reduceContacts(contacts);
	}

	private step(dt: number) {
		this.simulationTime += dt;
		const gravity = 2.5 * this.height;
		for (const body of this.bodies) {
			if (this.simulationTime < body.releaseAt) continue;
			if (body.sleeping && body !== this.dragged) {
				body.vx = 0;
				body.vy = 0;
				body.angularVelocity = 0;
				continue;
			}

			body.vy += gravity * dt;
			if (body === this.dragged) {
				const cos = Math.cos(body.angle);
				const sin = Math.sin(body.angle);
				const rx = this.dragLocalX * cos - this.dragLocalY * sin;
				const ry = this.dragLocalX * sin + this.dragLocalY * cos;
				const pointVx = body.vx - body.angularVelocity * ry;
				const pointVy = body.vy + body.angularVelocity * rx;
				let forceX = ((this.pointerX - (body.x + rx)) * 520 - pointVx * 34) * body.mass;
				let forceY = ((this.pointerY - (body.y + ry)) * 520 - pointVy * 34) * body.mass;
				const maxForce = 12 * body.mass * gravity;
				const force = Math.hypot(forceX, forceY);
				if (force > maxForce) {
					forceX *= maxForce / force;
					forceY *= maxForce / force;
				}
				applyImpulse(body, forceX * dt, forceY * dt, rx, ry);
			}

			body.vx *= 1 - 0.3 * dt;
			body.vy *= 1 - 0.3 * dt;
			body.angularVelocity *= 1 - (0.5 + (body.touching ? 8 : 0)) * dt;
			const speed = Math.hypot(body.vx, body.vy);
			if (speed > 12000) {
				body.vx *= 12000 / speed;
				body.vy *= 12000 / speed;
			}
			body.angularVelocity = Math.max(-1.5, Math.min(1.5, body.angularVelocity));
		}

		const contacts = this.collectContacts();
		for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration += 1) {
			if (iteration % 2 === 0) {
				for (const contact of contacts) solveVelocity(contact);
			} else {
				for (let index = contacts.length - 1; index >= 0; index -= 1) solveVelocity(contacts[index]);
			}
		}

		for (const body of this.bodies) {
			body.pvx = 0;
			body.pvy = 0;
			body.pAngularVelocity = 0;
			if (this.simulationTime < body.releaseAt || (body.sleeping && body !== this.dragged)) continue;
			body.x += body.vx * dt;
			body.y += body.vy * dt;
			body.angle += body.angularVelocity * dt;
		}
		for (const contact of contacts) {
			contact.bias = Math.min(Math.max(contact.penetration - CONTACT_SLOP, 0), 0.02 * this.height) * 0.85 / dt;
		}
		for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration += 1) {
			if (iteration % 2 === 0) {
				for (const contact of contacts) solvePosition(contact);
			} else {
				for (let index = contacts.length - 1; index >= 0; index -= 1) solvePosition(contacts[index]);
			}
		}
		for (const body of this.bodies) {
			body.x += body.pvx * dt;
			body.y += body.pvy * dt;
			body.angle += body.pAngularVelocity * dt;
			if (body.sleeping || body === this.dragged || this.simulationTime < body.releaseAt) continue;
			const isIdle = Math.hypot(body.vx, body.vy) < this.height * 0.016 && Math.abs(body.angularVelocity) < 0.18;
			body.idleFor = isIdle ? body.idleFor + dt : 0;
			if (body.idleFor > 0.45) {
				body.sleeping = true;
				body.vx = 0;
				body.vy = 0;
				body.angularVelocity = 0;
			}
		}
	}

	private draw() {
		this.context.clearRect(0, 0, this.width, this.height);
		for (const body of this.bodies) {
			if (this.simulationTime < body.releaseAt) continue;
			this.context.save();
			this.context.translate(body.x, body.y);
			this.context.rotate(body.angle);
			this.context.shadowColor = 'rgba(14, 54, 88, 0.25)';
			this.context.shadowBlur = Math.min(22, 10 + body.scale * 4);
			this.context.shadowOffsetY = Math.min(16, 7 + body.scale * 3);
			this.context.drawImage(
				body.shape.sprite,
				-body.shape.centerX * body.scale,
				-body.shape.centerY * body.scale,
				body.shape.width * body.scale,
				body.shape.height * body.scale,
			);
			this.context.restore();
		}
	}

	private tick = (time: number) => {
		this.frame = requestAnimationFrame(this.tick);
		if (!this.visible || document.hidden) {
			this.lastFrameTime = time;
			return;
		}
		if (!this.lastFrameTime) this.lastFrameTime = time;
		this.accumulator += Math.min((time - this.lastFrameTime) / 1000, 0.05);
		this.lastFrameTime = time;
		let steps = 0;
		while (this.accumulator >= FIXED_STEP && steps < 8) {
			this.step(FIXED_STEP);
			this.accumulator -= FIXED_STEP;
			steps += 1;
		}
		this.draw();
	};

	private handlePointerDown = (event: PointerEvent) => {
		const bounds = this.canvas.getBoundingClientRect();
		const x = event.clientX - bounds.left;
		const y = event.clientY - bounds.top;
		for (let index = this.bodies.length - 1; index >= 0; index -= 1) {
			const body = this.bodies[index];
			if (this.simulationTime < body.releaseAt || !containsPoint(body, x, y)) continue;
			const cos = Math.cos(body.angle);
			const sin = Math.sin(body.angle);
			const dx = x - body.x;
			const dy = y - body.y;
			this.dragLocalX = dx * cos + dy * sin;
			this.dragLocalY = -dx * sin + dy * cos;
			this.pointerX = x;
			this.pointerY = y;
			this.dragged = body;
			body.sleeping = false;
			body.idleFor = 0;
			this.canvas.style.cursor = 'grabbing';
			this.canvas.setPointerCapture(event.pointerId);
			event.preventDefault();
			return;
		}
	};

	private handlePointerMove = (event: PointerEvent) => {
		if (!this.dragged) return;
		const bounds = this.canvas.getBoundingClientRect();
		this.pointerX = event.clientX - bounds.left;
		this.pointerY = event.clientY - bounds.top;
		event.preventDefault();
	};

	private handlePointerUp = (event: PointerEvent) => {
		if (!this.dragged) return;
		this.dragged = null;
		this.canvas.style.cursor = 'grab';
		if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
	};

	private observe() {
		this.resizeObserver = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			if (Math.abs(width - this.width) < 0.5 && Math.abs(height - this.height) < 0.5) return;
			cancelAnimationFrame(this.resizeFrame);
			this.resizeFrame = requestAnimationFrame(() => this.buildWorld());
		});
		this.resizeObserver.observe(this.root);
		this.intersectionObserver = new IntersectionObserver(([entry]) => {
			this.visible = entry?.isIntersecting ?? true;
			this.lastFrameTime = 0;
		});
		this.intersectionObserver.observe(this.root);
	}

	destroy() {
		cancelAnimationFrame(this.frame);
		cancelAnimationFrame(this.resizeFrame);
		this.resizeObserver?.disconnect();
		this.intersectionObserver?.disconnect();
		this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
		this.canvas.removeEventListener('pointermove', this.handlePointerMove);
		this.canvas.removeEventListener('pointerup', this.handlePointerUp);
		this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
	}
}

export async function initPhysics404(root: HTMLElement): Promise<() => void> {
	const canvas = root.querySelector<HTMLCanvasElement>('[data-physics-canvas]');
	const serializedSources = root.dataset.imageSources;
	if (!canvas || !serializedSources || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => undefined;

	try {
		const sources = JSON.parse(serializedSources) as unknown;
		if (!Array.isArray(sources) || sources.length !== 3 || !sources.every((source) => typeof source === 'string')) {
			throw new Error('Expected three explicit 404 glyph asset URLs');
		}
		const images = await Promise.all(sources.map((source) => loadImage(source)));
		const scene = new Physics404Scene(root, canvas, images.map(analyzeGlyph));
		return () => scene.destroy();
	} catch (error) {
		console.error('Could not start the interactive 404 scene.', error);
		return () => undefined;
	}
}
