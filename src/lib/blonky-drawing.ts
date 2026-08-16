// Blonky, held at rest while every ink mark redraws.

type Pt = { x: number; y: number };

export const BLONKY_BUST_WIDTH = 900;
export const BLONKY_BUST_HEIGHT = 800;
export const BLONKY_FPS = 8;

export const BLONKY_VIEWPORTS = {
	bust: { width: BLONKY_BUST_WIDTH, height: BLONKY_BUST_HEIGHT },
	portrait: { width: 520, height: 520 },
} as const;

export type BlonkyView = keyof typeof BLONKY_VIEWPORTS;

export interface BlonkyAnimationInfo {
	label: string;
	duration: number;
	category: string;
}

/*
 * The registry drives everything: the debug page renders its animation list
 * from these entries, so adding an animation here is the entire change.
 */
export const BLONKY_ANIMATIONS = {
	notice: { label: 'notice', duration: 0.875, category: 'reactions' },
	confirm: { label: 'confirm', duration: 1, category: 'reactions' },
	confused: { label: 'confused', duration: 1.375, category: 'reactions' },
} as const satisfies Record<string, BlonkyAnimationInfo>;

export type BlonkyReaction = keyof typeof BLONKY_ANIMATIONS;

export interface BlonkyReactionPose {
	kind: BlonkyReaction;
	elapsed: number;
	direction: -1 | 1;
}

export interface BlonkyDrawOptions {
	reaction?: BlonkyReactionPose;
	showHead?: boolean;
	view?: BlonkyView;
}

const H = BLONKY_BUST_HEIGHT;
const TAU = Math.PI * 2;
const FPS = BLONKY_FPS;
const BLINK_PHRASE_SECONDS = 8.75;
const BEHAVIOR_PHRASE_SECONDS = 16.25;
const PAPER = '#efede6';
const INK = '#252422';
const WASH = '#9a6f59';
let frame = 0;

function hash(seed: number, a: number, b = 0): number {
	let n = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(a, 0xc2b2ae35) + Math.imul(b, 0x27d4eb2f);
	n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
	return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const a = hash(seed, x0, y0);
	const b = hash(seed, x0 + 1, y0);
	const c = hash(seed, x0, y0 + 1);
	const d = hash(seed, x0 + 1, y0 + 1);
	return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function add(a: Pt, b: Pt): Pt {
	return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Pt, b: Pt): Pt {
	return { x: a.x - b.x, y: a.y - b.y };
}

function mul(point: Pt, amount: number): Pt {
	return { x: point.x * amount, y: point.y * amount };
}

function norm(point: Pt): Pt {
	const length = Math.hypot(point.x, point.y) || 1;
	return { x: point.x / length, y: point.y / length };
}

function normal(point: Pt): Pt {
	return { x: -point.y, y: point.x };
}

function lerp(a: Pt, b: Pt, t: number): Pt {
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pointInPolygon(point: Pt, polygon: Pt[]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i];
		const b = polygon[j];
		if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1) + a.x) inside = !inside;
	}
	return inside;
}

interface Bounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

function polygonBounds(polygon: Pt[]): Bounds {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const point of polygon) {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}
	return { minX, maxX, minY, maxY };
}

function densify(points: Pt[], closed: boolean, step = 5): Pt[] {
	const source = closed ? points.concat(points[0]) : points;
	const result: Pt[] = [];
	for (let index = 0; index < source.length - 1; index++) {
		const a = source[index];
		const b = source[index + 1];
		const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
		for (let part = 0; part < count; part++) result.push(lerp(a, b, part / count));
	}
	result.push(source[source.length - 1]);
	return result;
}

function quadratic(a: Pt, control: Pt, b: Pt, count = 18): Pt[] {
	return Array.from({ length: count + 1 }, (_, index) => {
		const t = index / count;
		const u = 1 - t;
		return {
			x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
			y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
		};
	});
}

function throughJoint(chain: [Pt, Pt, Pt]): Pt[] {
	const [start, joint, end] = chain;
	const intoJoint = lerp(start, joint, 0.72);
	const outOfJoint = lerp(joint, end, 0.28);
	return densify([start, intoJoint], false, 5)
		.slice(0, -1)
		.concat(quadratic(intoJoint, joint, outOfJoint, 8))
		.concat(densify([outOfJoint, end], false, 5).slice(1));
}

interface StrokeOptions {
	closed?: boolean;
	width?: number;
	alpha?: number;
	passes?: number;
	boil?: number;
	color?: string;
}

function stroke(ctx: CanvasRenderingContext2D, anchors: Pt[], id: number, options: StrokeOptions = {}): void {
	if (anchors.length < 2) return;
	const closed = options.closed ?? false;
	const width = options.width ?? 2.25;
	const passes = options.passes ?? 2;
	const points = densify(anchors, closed, 4.5);
	const length = points.slice(1).reduce((total, point, index) => total + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
	const contourScale = Math.min(1, length / 180);
	ctx.save();
	ctx.fillStyle = options.color ?? INK;
	for (let pass = 0; pass < passes; pass++) {
		ctx.globalAlpha = (options.alpha ?? 0.9) * (pass === 0 ? 0.72 : 0.34);
		const moved = points.map((point, index) => {
			const before = points[Math.max(0, index - 1)];
			const after = points[Math.min(points.length - 1, index + 1)];
			const n = normal(norm(sub(after, before)));
			const u = index * 0.34;
			const staticWobble = (valueNoise(u, pass * 7.3, id + 101) - 0.5) * 2.35;
			// The whole contour samples one slowly moving field. Every mark is
			// redrawn, but neighbouring points travel together instead of fizzing
			// independently in x and y.
			const live = (0.9 + contourScale * 0.45) * (0.92 + (options.boil ?? 0.36) * 0.22);
			const boilingWobble =
				(valueNoise(u * 0.72, frame * 0.41 + pass * 9.1, id + 503) - 0.5) * live * 2
				+ (valueNoise(u * 1.45, frame * 0.73 + pass * 4.7, id + 557) - 0.5) * live * 0.65;
			const restatement = pass ? 0.36 : -0.12;
			const displacement = staticWobble + boilingWobble + restatement;
			return { x: point.x + n.x * displacement, y: point.y + n.y * displacement };
		});
		const bandNormals = moved.map((_, index) => {
			const before = moved[Math.max(0, index - 1)];
			const after = moved[Math.min(moved.length - 1, index + 1)];
			return normal(norm(sub(after, before)));
		});
		const radii = moved.map((_, index) => {
			const pressure = 0.92 + (valueNoise(index * 0.27, pass * 5.7, id + 709) - 0.5) * 0.44
				+ (valueNoise(index * 0.19, frame * 0.29 + pass * 3.1, id + 811) - 0.5) * 0.18;
			return Math.max(0.18, width * (pass === 0 ? 0.86 : 0.44) * pressure * 0.5);
		});
		const left = moved.map((point, index) => add(point, mul(bandNormals[index], radii[index])));
		const right = moved.map((point, index) => add(point, mul(bandNormals[index], -radii[index])));

		ctx.beginPath();
		ctx.moveTo(left[0].x, left[0].y);
		for (let index = 1; index < left.length; index++) ctx.lineTo(left[index].x, left[index].y);
		for (let index = right.length - 1; index >= 0; index--) ctx.lineTo(right[index].x, right[index].y);
		ctx.closePath();
		ctx.fill('evenodd');
		if (!closed) {
			for (const index of [0, moved.length - 1]) {
				ctx.beginPath();
				ctx.arc(moved[index].x, moved[index].y, radii[index], 0, TAU);
				ctx.fill();
			}
		}
	}
	ctx.restore();
}

function polygonPath(ctx: CanvasRenderingContext2D, polygon: Pt[]): void {
	ctx.beginPath();
	ctx.moveTo(polygon[0].x, polygon[0].y);
	for (let index = 1; index < polygon.length; index++) ctx.lineTo(polygon[index].x, polygon[index].y);
	ctx.closePath();
}

function fill(ctx: CanvasRenderingContext2D, polygon: Pt[], color: string, alpha: number): void {
	ctx.save();
	ctx.fillStyle = color;
	ctx.globalAlpha = alpha;
	polygonPath(ctx, polygon);
	ctx.fill();
	ctx.restore();
}

interface HatchOptions {
	spacing?: number;
	angle?: number;
	alpha?: number;
	width?: number;
	cross?: boolean;
}

function hatch(ctx: CanvasRenderingContext2D, polygon: Pt[], id: number, options: HatchOptions = {}): void {
	if (polygon.length < 3) return;
	const { minX, maxX, minY, maxY } = polygonBounds(polygon);
	const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
	const reach = Math.hypot(maxX - minX, maxY - minY) * 0.8 + 12;

	const pass = (angle: number, passId: number, alpha: number): void => {
		ctx.save();
		polygonPath(ctx, polygon);
		ctx.clip();
		ctx.translate(center.x, center.y);
		ctx.rotate(angle);
		let line = 0;
		let y = -reach;
		while (y <= reach) {
			if (hash(passId, line, 89) > 0.08) {
				const bend = (hash(passId, line, 97) - 0.5) * (options.spacing ?? 7) * 0.9;
				stroke(ctx, [
					{ x: -reach, y: y + (hash(passId, line, 101) - 0.5) * 3 },
					{ x: 0, y: y + bend },
					{ x: reach, y: y + (hash(passId, line, 103) - 0.5) * 3 },
				], passId + line * 13, {
					width: options.width ?? 1.05,
					alpha,
					passes: 1,
					boil: 0.25,
				});
			}
			y += (options.spacing ?? 7) * (0.72 + hash(passId, line, 107) * 0.58);
			line++;
		}
		ctx.restore();
	};

	pass(options.angle ?? -0.74, id, options.alpha ?? 0.7);
	if (options.cross) pass((options.angle ?? -0.74) * -0.78, id + 9001, (options.alpha ?? 0.7) * 0.58);
}

function stipple(ctx: CanvasRenderingContext2D, polygon: Pt[], id: number, count: number, alpha = 0.6): void {
	const { minX, maxX, minY, maxY } = polygonBounds(polygon);
	ctx.save();
	ctx.fillStyle = INK;
	ctx.globalAlpha = alpha;
	for (let index = 0; index < count; index++) {
		const point = {
			x: minX + hash(id, index, 211) * (maxX - minX),
			y: minY + hash(id, index, 223) * (maxY - minY),
		};
		if (!pointInPolygon(point, polygon)) continue;
		const densityField = valueNoise((point.x - minX) / 105, (point.y - minY) / 88, id + 1009);
		if (hash(id, index, 229) > 0.18 + densityField * 0.7) continue;
		const radius = 0.35 + hash(id, index, 227) * 0.85;
		ctx.beginPath();
		ctx.arc(point.x, point.y, radius, 0, TAU);
		ctx.fill();
	}
	ctx.restore();
}

interface Pose {
	centerX: number;
	shoulderY: number;
	leftShoulderY: number;
	rightShoulderY: number;
	headX: number;
	headY: number;
	headAngle: number;
	headReactionAngle: number;
	headTurn: number;
	breath: number;
	bellySpread: number;
	mouthTension: number;
	leftBrowLift: number;
	rightBrowLift: number;
	leftEyeOpen: number;
	rightEyeOpen: number;
	leftArm: [Pt, Pt, Pt];
	rightArm: [Pt, Pt, Pt];
}

interface BlinkPose {
	leftEyeOpen: number;
	rightEyeOpen: number;
}

function smoothstep(value: number): number {
	const t = Math.max(0, Math.min(1, value));
	return t * t * (3 - 2 * t);
}

function inkFrameTime(value: number): number {
	return Math.round(value * FPS) / FPS;
}

function heldEnvelope(time: number, start: number, attack: number, hold: number, release: number): number {
	if (time < start || time >= start + attack + hold + release) return 0;
	if (time < start + attack) return smoothstep((time - start) / attack);
	if (time < start + attack + hold) return 1;
	return smoothstep(1 - (time - start - attack - hold) / release);
}

function blinkClosure(time: number, center: number, reach: number): number {
	return smoothstep(1 - Math.abs(time - center) / reach);
}

function blinkPoseAt(time: number): BlinkPose {
	const phrase = Math.floor(time / BLINK_PHRASE_SECONDS);
	const phraseTime = time - phrase * BLINK_PHRASE_SECONDS;
	const firstBlink = inkFrameTime(0.88 + hash(4021, phrase, 1) * 0.34);
	const secondBlink = inkFrameTime(firstBlink + 0.29 + hash(4021, phrase, 2) * 0.07);
	const regularBlink = inkFrameTime(secondBlink + 1.42 + hash(4021, phrase, 3) * 0.48);
	const centers = [firstBlink, secondBlink, regularBlink];
	let leftClosure = 0;
	let rightClosure = 0;

	for (const center of centers) {
		leftClosure = Math.max(leftClosure, blinkClosure(phraseTime, center, 0.07));
		// The right lid starts with the left but takes a fraction longer to
		// finish reopening. On the stepped ink cadence that becomes one rough,
		// half-open after-frame rather than a smooth tween or a wink.
		rightClosure = Math.max(rightClosure, blinkClosure(phraseTime, center + 0.018, 0.155));
	}

	return {
		leftEyeOpen: 1 - leftClosure * 0.92,
		rightEyeOpen: 1 - rightClosure * 0.92,
	};
}

interface IdleBehavior {
	deepBreath: number;
	headCorrection: number;
	mouthSet: number;
}

function idleBehaviorAt(time: number): IdleBehavior {
	const phrase = Math.floor(time / BEHAVIOR_PHRASE_SECONDS);
	const phraseTime = time - phrase * BEHAVIOR_PHRASE_SECONDS;
	const direction = hash(5297, phrase, 1) > 0.5 ? 1 : -1;
	const correctionStart = inkFrameTime(6.1 + hash(5297, phrase, 2) * 2.25);
	const breathStart = inkFrameTime(correctionStart + 3.15 + hash(5297, phrase, 3) * 0.9);

	return {
		// One considered adjustment, held long enough to read as thought rather
		// than a twitch. The face returns before the later deeper breath.
		headCorrection: direction * heldEnvelope(phraseTime, correctionStart, 0.5, 0.75, 0.7),
		mouthSet: direction * heldEnvelope(phraseTime, correctionStart + 0.25, 0.25, 0.42, 0.45),
		deepBreath: heldEnvelope(phraseTime, breathStart, 0.85, 0.2, 1.1),
	};
}

interface ReactionOffset {
	presence: number;
	headX: number;
	headY: number;
	headAngle: number;
	headTurn: number;
	mouthTension: number;
	leftBrowLift: number;
	rightBrowLift: number;
	leftEyeOpen: number;
	rightEyeOpen: number;
}

function reactionOffsetAt(reaction?: BlonkyReactionPose): ReactionOffset {
	const none: ReactionOffset = {
		presence: 0,
		headX: 0,
		headY: 0,
		headAngle: 0,
		headTurn: 0,
		mouthTension: 0,
		leftBrowLift: 0,
		rightBrowLift: 0,
		leftEyeOpen: 1,
		rightEyeOpen: 1,
	};
	if (!reaction) return none;

	const duration = BLONKY_ANIMATIONS[reaction.kind].duration;
	const elapsed = Math.max(0, Math.min(duration, reaction.elapsed));
	const presence = heldEnvelope(elapsed, 0, 0.25, Math.max(0, duration - 0.625), 0.375);
	const direction = reaction.direction;

	if (reaction.kind === 'notice') {
		// The eyes catch first, followed by a small turn around the planted base
		// of the skull. Translation stays at zero so the shirt connection never
		// travels with the head.
		const firstEyeBeat = heldEnvelope(elapsed, 0, 0.125, 0, 0.125);
		const secondEyeBeat = heldEnvelope(elapsed, 0.125, 0.125, 0, 0.125);
		const notice = heldEnvelope(elapsed, 0.25, 0.125, 0.25, 0.25);
		const looksLeft = direction < 0;
		const leftEyeClosure = looksLeft
			? firstEyeBeat * 0.58 + secondEyeBeat * 0.22
			: firstEyeBeat * 0.22 + secondEyeBeat * 0.48;
		const rightEyeClosure = looksLeft
			? firstEyeBeat * 0.22 + secondEyeBeat * 0.48
			: firstEyeBeat * 0.58 + secondEyeBeat * 0.22;
		return {
			presence: Math.max(firstEyeBeat, secondEyeBeat, notice),
			headX: 0,
			headY: 0,
			headAngle: direction * notice * 0.014,
			headTurn: direction * notice * 0.72,
			mouthTension: -direction * notice * 0.32,
			leftBrowLift: notice * (looksLeft ? 5.4 : 3.1),
			rightBrowLift: notice * (looksLeft ? 3.1 : 5.4),
			leftEyeOpen: 1 - leftEyeClosure + notice * (looksLeft ? 0.04 : -0.03),
			rightEyeOpen: 1 - rightEyeClosure + notice * (looksLeft ? -0.03 : 0.04),
		};
	}

	if (reaction.kind === 'confirm') {
		const down = heldEnvelope(elapsed, 0.125, 0.25, 0.125, 0.25);
		return {
			presence,
			headX: 0,
			headY: down * 3.4 - presence * 0.4,
			headAngle: direction * presence * 0.003,
			headTurn: direction * presence * 0.16,
			mouthTension: direction * presence * 0.24,
			leftBrowLift: presence * 0.55,
			rightBrowLift: presence * 0.55,
			leftEyeOpen: 1,
			rightEyeOpen: 1,
		};
	}

	return {
		presence,
		headX: direction * presence * 1.2,
		headY: presence * 0.6,
		headAngle: direction * presence * 0.026,
		headTurn: direction * presence * 0.42,
		mouthTension: direction * presence * 0.58,
		leftBrowLift: presence * (direction < 0 ? 4.4 : -0.8),
		rightBrowLift: presence * (direction > 0 ? 4.4 : -0.8),
		leftEyeOpen: 1,
		rightEyeOpen: 1,
	};
}

function poseAtRest(time: number, reaction?: BlonkyReactionPose): Pose {
	const behavior = idleBehaviorAt(time);
	const reactionOffset = reactionOffsetAt(reaction);
	const idleBehaviorWeight = 1 - reactionOffset.presence * 0.85;
	const breathWave = Math.sin(time * 1.47 - 0.4);
	const breath = breathWave + behavior.deepBreath * 0.82;
	const swayPhase = time * 0.86;
	const sway = Math.sin(swayPhase) * 2.8;
	const centerX = 450 + sway;
	const shoulderY = 294 - breath * 1.7;
	const leftShoulderY = shoulderY + 3.4 + Math.sin(swayPhase - 0.2) * 0.65;
	const rightShoulderY = shoulderY - 1.6 + Math.sin(swayPhase + 0.35) * 0.45;
	const armSway = Math.sin(swayPhase - 0.24) * 2.25;
	const armBreath = Math.sin(time * 1.47 - 0.68);
	const { leftEyeOpen, rightEyeOpen } = blinkPoseAt(time);
	const leftArm: [Pt, Pt, Pt] = [
		{ x: 450 + armSway - 341, y: leftShoulderY + 320 },
		{ x: 450 + armSway - 358, y: 742 - armBreath * 0.85 },
		{ x: 450 + armSway - 349, y: 846 },
	];
	const rightArm: [Pt, Pt, Pt] = [
		{ x: 450 + armSway + 342, y: rightShoulderY + 318 },
		{ x: 450 + armSway + 363, y: 745 - armBreath * 0.72 },
		{ x: 450 + armSway + 352, y: 846 },
	];

	return {
		centerX,
		shoulderY,
		leftShoulderY,
		rightShoulderY,
		headX: centerX - 5 + Math.sin(swayPhase - 0.43) * 1.45 + behavior.headCorrection * 1.2 * idleBehaviorWeight + reactionOffset.headX,
		headY: 295 - breathWave * 0.62 - behavior.deepBreath * 0.75 + reactionOffset.headY,
		headAngle: -0.024 + Math.sin(swayPhase - 0.48) * 0.009 + behavior.headCorrection * 0.008 * idleBehaviorWeight,
		headReactionAngle: reactionOffset.headAngle,
		headTurn: Math.sin(time * 0.7 - 0.4) * 0.24 + behavior.headCorrection * 0.82 * idleBehaviorWeight + reactionOffset.headTurn,
		breath,
		bellySpread: breath * 2.15 + behavior.deepBreath * 1.4,
		mouthTension: behavior.mouthSet * idleBehaviorWeight + reactionOffset.mouthTension,
		leftBrowLift: reactionOffset.leftBrowLift,
		rightBrowLift: reactionOffset.rightBrowLift,
		leftEyeOpen: leftEyeOpen + (reactionOffset.leftEyeOpen - leftEyeOpen) * reactionOffset.presence,
		rightEyeOpen: rightEyeOpen + (reactionOffset.rightEyeOpen - rightEyeOpen) * reactionOffset.presence,
		leftArm,
		rightArm,
	};
}

function tube(chain: [Pt, Pt, Pt], startRadius: number, endRadius: number): { left: Pt[]; right: Pt[]; center: Pt[] } {
	const center = throughJoint(chain);
	const left: Pt[] = [];
	const right: Pt[] = [];
	center.forEach((point, index) => {
		const before = center[Math.max(0, index - 1)];
		const after = center[Math.min(center.length - 1, index + 1)];
		const n = normal(norm(sub(after, before)));
		const t = index / (center.length - 1);
		const radius = (startRadius + (endRadius - startRadius) * t) * (0.94 + (hash(3911, index, 7) - 0.5) * 0.12);
		left.push(add(point, mul(n, radius)));
		right.push(add(point, mul(n, -radius)));
	});
	return { left, right, center };
}

function drawLimb(ctx: CanvasRenderingContext2D, chain: [Pt, Pt, Pt], id: number, startRadius: number, endRadius: number): void {
	const shape = tube(chain, startRadius, endRadius);
	const polygon = shape.left.concat(shape.right.slice().reverse());
	fill(ctx, polygon, PAPER, 1);
	fill(ctx, polygon, WASH, 0.12);
	stroke(ctx, shape.left, id, { width: 2.2, boil: 0.42 });
	stroke(ctx, shape.right, id + 1, { width: 2.2, boil: 0.42 });
}

function drawHead(ctx: CanvasRenderingContext2D, pose: Pose): void {
	ctx.save();
	// Every head turn shares one body-anchored pivot at the base of the neck.
	// The shirt never enters this transform, so its collar remains planted while
	// the jaw can tip naturally over the neck skin behind it.
	const neckPivot = { x: pose.centerX, y: pose.shoulderY - 10 };
	ctx.translate(neckPivot.x, neckPivot.y);
	ctx.rotate(pose.headAngle + pose.headReactionAngle);
	ctx.translate(pose.headX - neckPivot.x, pose.headY - neckPivot.y);
	ctx.scale(2.05, 1.9);
	const turn = pose.headTurn;

	const skull: Pt[] = [
		{ x: -84, y: -45 }, { x: -76, y: -78 }, { x: -55, y: -99 }, { x: -28, y: -109 },
		{ x: 2, y: -111 }, { x: 35, y: -106 }, { x: 63, y: -91 }, { x: 81, y: -66 },
		{ x: 88, y: -36 }, { x: 85, y: -8 }, { x: 95, y: 4 }, { x: 96, y: 30 },
		{ x: 86, y: 57 }, { x: 64, y: 70 }, { x: 38, y: 82 }, { x: 7, y: 86 },
		{ x: -23, y: 84 }, { x: -52, y: 73 }, { x: -72, y: 57 }, { x: -86, y: 36 },
		{ x: -90, y: 7 }, { x: -83, y: -8 },
	];
	const outerHead = [
		skull[21],
		...skull.slice(0, 10),
	];
	fill(ctx, skull, PAPER, 1);
	fill(ctx, skull, WASH, 0.11);
	stroke(ctx, outerHead, 611, { width: 1.82, boil: 0.46 });

	const crown = densify(skull.slice(1, 9), false, 8);
	for (let index = 1; index < crown.length - 1; index++) {
		const cluster = valueNoise(index * 0.24, 0, 617);
		if (hash(617, index, 1) < 0.26 + (1 - cluster) * 0.42) continue;
		const point = crown[index];
		const direction = norm({
			x: point.x * 0.2 + (hash(617, index, 2) - 0.5) * 16,
			y: point.y + 27 + (hash(617, index, 3) - 0.5) * 8,
		});
		const length = 2.8 + hash(617, index, 4) * 4.6;
		stroke(ctx, [point, add(point, mul(direction, length))], 620 + index, { width: 0.72, passes: 1, boil: 0.35 });
	}

	const leftEyeCenter = { x: -34 + turn * 1.05, y: -56.5 + turn * 0.18 };
	const rightEyeCenter = { x: 30 + turn * 1.7, y: -49 - turn * 0.12 };
	const blink = (points: Pt[], center: Pt, openness: number): Pt[] => points.map((point) => ({
		x: point.x,
		y: center.y + (point.y - center.y) * openness,
	}));
	const leftEye = blink([
		{ x: leftEyeCenter.x - 12, y: leftEyeCenter.y - 1 },
		{ x: leftEyeCenter.x - 10, y: leftEyeCenter.y - 8 },
		{ x: leftEyeCenter.x - 4, y: leftEyeCenter.y - 12 },
		{ x: leftEyeCenter.x + 4, y: leftEyeCenter.y - 12 },
		{ x: leftEyeCenter.x + 11, y: leftEyeCenter.y - 7 },
		{ x: leftEyeCenter.x + 12, y: leftEyeCenter.y + 1 },
		{ x: leftEyeCenter.x + 8, y: leftEyeCenter.y + 9 },
		{ x: leftEyeCenter.x + 1, y: leftEyeCenter.y + 12 },
		{ x: leftEyeCenter.x - 8, y: leftEyeCenter.y + 9 },
		{ x: leftEyeCenter.x - 12, y: leftEyeCenter.y + 3 },
	], leftEyeCenter, pose.leftEyeOpen);
	const rightEye = blink([
		{ x: rightEyeCenter.x - 10, y: rightEyeCenter.y - 2 },
		{ x: rightEyeCenter.x - 7, y: rightEyeCenter.y - 10 },
		{ x: rightEyeCenter.x, y: rightEyeCenter.y - 12 },
		{ x: rightEyeCenter.x + 7, y: rightEyeCenter.y - 9 },
		{ x: rightEyeCenter.x + 10, y: rightEyeCenter.y - 2 },
		{ x: rightEyeCenter.x + 8, y: rightEyeCenter.y + 7 },
		{ x: rightEyeCenter.x + 2, y: rightEyeCenter.y + 11 },
		{ x: rightEyeCenter.x - 5, y: rightEyeCenter.y + 9 },
		{ x: rightEyeCenter.x - 10, y: rightEyeCenter.y + 3 },
	], rightEyeCenter, pose.rightEyeOpen);
	stroke(ctx, leftEye, 630, { closed: true, width: 1.95, passes: 2, boil: 0.34 });
	stroke(ctx, rightEye, 631, { closed: true, width: 1.86, passes: 2, boil: 0.34 });
	stroke(ctx, [{ x: -47, y: -40 }, { x: -38, y: -35 }, { x: -28, y: -35 }, { x: -20, y: -40 }], 632, { width: 1.12, alpha: 0.82, passes: 1, boil: 0.28 });
	stroke(ctx, [{ x: 21, y: -35 }, { x: 28, y: -32 }, { x: 36, y: -33 }, { x: 41, y: -37 }], 633, { width: 1.02, alpha: 0.76, passes: 1, boil: 0.28 });
	stroke(ctx, [
		{ x: -49, y: -67 - pose.leftBrowLift * 0.5 },
		{ x: -41, y: -75 - pose.leftBrowLift },
		{ x: -30, y: -78 - pose.leftBrowLift * 0.7 },
	], 634, { width: 1.55, boil: 0.36 });
	stroke(ctx, [
		{ x: 25, y: -70 - pose.rightBrowLift * 0.7 },
		{ x: 35, y: -73 - pose.rightBrowLift },
		{ x: 46, y: -66 - pose.rightBrowLift * 0.5 },
	], 635, { width: 1.38, boil: 0.36 });
	const noseBridgeX = 9 + turn * 0.35;
	const noseTipX = -6 + turn * 2.6;
	stroke(ctx, [
		{ x: noseBridgeX, y: -42 },
		{ x: noseBridgeX + 1 + turn * 0.35, y: -22 },
		{ x: noseBridgeX + 1 + turn * 0.8, y: -5 },
		{ x: 7 + turn * 1.8, y: 1 },
		{ x: noseTipX, y: 4 },
		{ x: -16 + turn * 2.25, y: 2 },
		{ x: -25 + turn * 2.15, y: -2 },
	], 636, { width: 1.7, boil: 0.4 });
	stroke(ctx, [
		{ x: -38 + turn * 0.65, y: 15 + pose.mouthTension * 0.8 },
		{ x: -17 + turn * 0.8, y: 13 },
		{ x: 1 + turn, y: 12 },
		{ x: 17 + turn * 1.2, y: 14 - pose.mouthTension * 1.15 },
	], 637, { width: 1.62, boil: 0.36 });
	stroke(ctx, [{ x: -18, y: 22 }, { x: -5, y: 21 }], 638, { width: 1.08, alpha: 0.7, passes: 1 });
	stroke(ctx, [{ x: -55, y: 32 }, { x: -39, y: 44 }, { x: -12, y: 51 }, { x: 14, y: 49 }, { x: 43, y: 33 }], 639, { width: 1.5, alpha: 0.7, boil: 0.34 });
	stroke(ctx, [{ x: -42, y: 49 }, { x: -20, y: 58 }, { x: 2, y: 61 }, { x: 22, y: 56 }, { x: 36, y: 48 }], 640, { width: 1.12, alpha: 0.54, passes: 1, boil: 0.3 });

	ctx.restore();
}

function drawCuffBand(
	ctx: CanvasRenderingContext2D,
	upperStart: Pt,
	upperEnd: Pt,
	lowerStart: Pt,
	lowerEnd: Pt,
	id: number,
): void {
	stroke(ctx, [upperStart, upperEnd], id, { width: 2.1, alpha: 0.82, boil: 0.38 });
	stroke(ctx, [lowerStart, lowerEnd], id + 1, { width: 2.1, alpha: 0.82, boil: 0.38 });
	const zigzag: Pt[] = [];
	const teeth = 10;
	for (let index = 0; index <= teeth * 2; index++) {
		const t = index / (teeth * 2);
		zigzag.push(lerp(index % 2 === 0 ? upperStart : lowerStart, index % 2 === 0 ? upperEnd : lowerEnd, t));
	}
	stroke(ctx, zigzag, id + 2, { width: 1.4, alpha: 0.76, passes: 1, boil: 0.32 });
}

interface CollarGeometry {
	chestSkin: Pt[];
	chestTop: Pt[];
	edge: Pt[];
	leftContact: Pt;
	rightContact: Pt;
}

function collarGeometry(pose: Pose): CollarGeometry {
	const leftContact = { x: pose.centerX - 202, y: pose.shoulderY - 8 };
	const rightContact = { x: pose.centerX + 208, y: pose.shoulderY - 10 };
	const bottom = { x: pose.centerX - 3, y: pose.shoulderY + 180 };
	const leftMid = { x: pose.centerX - 164, y: pose.shoulderY + 108 };
	const rightMid = { x: pose.centerX + 190, y: pose.shoulderY + 105 };
	const leftHalf = quadratic(
		leftContact,
		{ x: pose.centerX - 207, y: pose.shoulderY + 58 },
		leftMid,
		14,
	).concat(quadratic(
		leftMid,
		{ x: pose.centerX - 96, y: pose.shoulderY + 171 },
		bottom,
		12,
	).slice(1));
	const rightHalf = quadratic(
		bottom,
		{ x: pose.centerX + 93, y: pose.shoulderY + 174 },
		rightMid,
		12,
	).concat(quadratic(
		rightMid,
		{ x: pose.centerX + 211, y: pose.shoulderY + 59 },
		rightContact,
		14,
	).slice(1));
	const edge = leftHalf.concat(rightHalf.slice(1));
	const leftChestTop = { x: pose.centerX - 150, y: pose.shoulderY - 18 };
	const rightChestTop = { x: pose.centerX + 150, y: pose.shoulderY - 18 };
	const chestTop = quadratic(
		leftContact,
		{ x: pose.centerX - 184, y: pose.shoulderY - 17 },
		leftChestTop,
		5,
	).concat(
		quadratic(
			leftChestTop,
			{ x: pose.centerX, y: pose.shoulderY - 30 },
			rightChestTop,
			12,
		).slice(1),
		quadratic(
			rightChestTop,
			{ x: pose.centerX + 184, y: pose.shoulderY - 17 },
			rightContact,
			5,
		).slice(1),
	);
	const chestSkin = chestTop.concat(edge.slice(1, -1).reverse());
	return { chestSkin, chestTop, edge, leftContact, rightContact };
}

function drawBody(ctx: CanvasRenderingContext2D, pose: Pose): void {
	// The bare arms are laid in first so the oversized shirt naturally masks
	// their shoulders and opens cleanly at each cuff.
	drawLimb(ctx, pose.leftArm, 740, 98, 82);
	drawLimb(ctx, pose.rightArm, 745, 94, 84);
	const leftY = pose.leftShoulderY;
	const rightY = pose.rightShoulderY;
	const belly = pose.bellySpread;
	const collar = collarGeometry(pose);
	const torsoOuter: Pt[] = [
		collar.leftContact,
		{ x: pose.centerX - 292, y: leftY + 22 },
		{ x: pose.centerX - 370, y: leftY + 105 },
		{ x: pose.centerX - 424, y: leftY + 216 },
		{ x: pose.centerX - 450, y: leftY + 301 },
		{ x: pose.centerX - 450, y: leftY + 331 },
		{ x: pose.centerX - 230, y: leftY + 367 },
		{ x: pose.centerX - 215, y: leftY + 215 },
		{ x: pose.centerX - 232, y: leftY + 282 },
		{ x: pose.centerX - 278 - belly * 0.72, y: pose.shoulderY + 395 },
		{ x: pose.centerX - 286 - belly, y: H + 18 },
		{ x: pose.centerX + 288 + belly * 0.86, y: H + 18 },
		{ x: pose.centerX + 280 + belly * 0.64, y: pose.shoulderY + 395 },
		{ x: pose.centerX + 232, y: rightY + 282 },
		{ x: pose.centerX + 215, y: rightY + 215 },
		{ x: pose.centerX + 230, y: rightY + 365 },
		{ x: pose.centerX + 450, y: rightY + 316 },
		{ x: pose.centerX + 438, y: rightY + 226 },
		{ x: pose.centerX + 384, y: rightY + 112 },
		{ x: pose.centerX + 292, y: rightY + 24 },
		collar.rightContact,
	];
	// The shirt wraps around a shallow chest opening. The skin begins at the
	// shoulder line; there is no separate neck tower behind the head.
	const shirt = torsoOuter.concat(collar.edge.slice(1, -1).reverse());
	fill(ctx, collar.chestSkin, PAPER, 1);
	fill(ctx, collar.chestSkin, WASH, 0.11);
	fill(ctx, shirt, PAPER, 1);
	fill(ctx, shirt, INK, 0.78);
	stipple(ctx, shirt, 750, 1320, 0.29);
	hatch(ctx, shirt, 751, { spacing: 38, angle: -0.78, alpha: 0.045, width: 0.68 });
	// The outer contour and collar are separate authored marks. The collar is a
	// real boiled ink stroke, fixed to the breathing body and later occluded only
	// where the independently rendered head genuinely sits in front of it.
	stroke(ctx, torsoOuter, 752, { width: 3.45, boil: 0.46 });
	stroke(ctx, collar.edge, 753, { width: 3.25, alpha: 0.95, boil: 0.46 });
	stroke(ctx, collar.chestTop, 764, { width: 1.82, boil: 0.46 });

	drawCuffBand(
		ctx,
		{ x: pose.centerX - 450, y: leftY + 305 },
		{ x: pose.centerX - 225, y: leftY + 346 },
		{ x: pose.centerX - 450, y: leftY + 331 },
		{ x: pose.centerX - 230, y: leftY + 367 },
		755,
	);
	drawCuffBand(
		ctx,
		{ x: pose.centerX + 225, y: rightY + 344 },
		{ x: pose.centerX + 446, y: rightY + 291 },
		{ x: pose.centerX + 230, y: rightY + 365 },
		{ x: pose.centerX + 450, y: rightY + 316 },
		758,
	);

	// The sleeve creases do not mirror one another. They inherit the shoulder
	// delay, keeping the shirt attached to the breathing body without making
	// the fabric ripple independently.
	stroke(ctx, quadratic(
		{ x: pose.centerX - 307, y: leftY + 72 },
		{ x: pose.centerX - 337, y: leftY + 125 - pose.breath * 0.65 },
		{ x: pose.centerX - 354, y: leftY + 188 },
		12,
	), 760, { width: 1.05, alpha: 0.24, passes: 1, boil: 0.24 });
	stroke(ctx, quadratic(
		{ x: pose.centerX + 326, y: rightY + 91 },
		{ x: pose.centerX + 357, y: rightY + 137 - pose.breath * 0.5 },
		{ x: pose.centerX + 371, y: rightY + 173 },
		11,
	), 761, { width: 0.95, alpha: 0.2, passes: 1, boil: 0.22 });

	stroke(ctx, quadratic(
		{ x: pose.centerX - 72 - belly * 0.3, y: pose.shoulderY + 296 - pose.breath * 1.1 },
		{ x: pose.centerX - 18, y: pose.shoulderY + 284 - pose.breath * 1.45 },
		{ x: pose.centerX + 58 + belly * 0.25, y: pose.shoulderY + 299 - pose.breath * 0.9 },
		18,
	), 762, { width: 1.55, alpha: 0.5, boil: 0.24 });
	stroke(ctx, quadratic(
		{ x: pose.centerX - 150 - belly * 0.65, y: pose.shoulderY + 354 + pose.breath * 0.65 },
		{ x: pose.centerX + 10, y: pose.shoulderY + 327 - pose.breath * 0.35 },
		{ x: pose.centerX + 138 + belly * 0.55, y: pose.shoulderY + 360 + pose.breath * 0.8 },
		18,
	), 763, { width: 1.9, alpha: 0.6, boil: 0.26 });
}

export function drawBlonky(ctx: CanvasRenderingContext2D, time: number, options: BlonkyDrawOptions = {}): void {
	frame = Math.floor(time * FPS);
	const inkTime = frame / FPS;
	const view = options.view ?? 'bust';
	const viewport = BLONKY_VIEWPORTS[view];
	ctx.clearRect(0, 0, viewport.width, viewport.height);
	const pose = poseAtRest(inkTime, options.reaction);
	ctx.save();
	if (view === 'portrait') {
		ctx.translate(8, -5);
		ctx.scale(0.56, 0.56);
	}
	drawBody(ctx, pose);
	if (options.showHead !== false) drawHead(ctx, pose);
	ctx.restore();
}
