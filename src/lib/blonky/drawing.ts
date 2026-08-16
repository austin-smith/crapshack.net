import { sampleBlonkyEmoteOffset } from './emotes';
import { blinkPoseAt, hash, heldEnvelope, inkFrameTime, smoothstep } from './motion';
import {
	BLONKY_BUST_HEIGHT,
	BLONKY_BUST_WIDTH,
	BLONKY_FPS,
	BLONKY_VIEWPORTS,
	type BlonkyDrawOptions,
	type BlonkyEmotePose,
	type BlonkyPalette,
} from './types';

type Pt = { x: number; y: number };

const H = BLONKY_BUST_HEIGHT;
const TAU = Math.PI * 2;
const FPS = BLONKY_FPS;
const BEHAVIOR_PHRASE_SECONDS = 16.25;
const SKIN = '#efede6';
const EYE_WHITE = '#f4f0e6';
const FACE_INK = '#252422';
const WASH = '#9a6f59';
export const DEFAULT_BLONKY_PALETTE: Readonly<BlonkyPalette> = {
	outlineInk: FACE_INK,
	shirt: '#4f7092',
	shirtTextureAlpha: 0.42,
	shirtTextureInk: '#8ba2b8',
};
let frame = 0;

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

function segmentIntersection(aStart: Pt, aEnd: Pt, bStart: Pt, bEnd: Pt): Pt | undefined {
	const a = sub(aEnd, aStart);
	const b = sub(bEnd, bStart);
	const denominator = a.x * b.y - a.y * b.x;
	if (Math.abs(denominator) < 0.0001) return undefined;

	const offset = sub(bStart, aStart);
	const aProgress = (offset.x * b.y - offset.y * b.x) / denominator;
	const bProgress = (offset.x * a.y - offset.y * a.x) / denominator;
	if (aProgress < 0 || aProgress > 1 || bProgress < 0 || bProgress > 1) return undefined;
	return add(aStart, mul(a, aProgress));
}

function endPolylineAtSegment(points: Pt[], segmentStart: Pt, segmentEnd: Pt): Pt[] {
	for (let index = points.length - 2; index >= 0; index--) {
		const intersection = segmentIntersection(points[index], points[index + 1], segmentStart, segmentEnd);
		if (intersection) return points.slice(0, index + 1).concat(intersection);
	}
	return points;
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
	fillRule?: CanvasFillRule;
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
	ctx.fillStyle = options.color ?? FACE_INK;
	for (let pass = 0; pass < passes; pass++) {
		const primaryPass = pass === 0;
		ctx.globalAlpha = (options.alpha ?? 0.92) * (primaryPass ? 0.82 : 0.14);
		const moved = points.map((point, index) => {
			const before = points[Math.max(0, index - 1)];
			const after = points[Math.min(points.length - 1, index + 1)];
			const n = normal(norm(sub(after, before)));
			const u = index * 0.34;
			const staticWobble = (valueNoise(u, pass * 7.3, id + 101) - 0.5) * 2.35;
			// Sample one slowly moving field across the contour so neighboring
			// points remain correlated instead of producing independent x/y jitter.
			const live = (0.9 + contourScale * 0.45) * (0.92 + (options.boil ?? 0.36) * 0.22);
			const boilingWobble =
				(valueNoise(u * 0.72, frame * 0.41 + pass * 9.1, id + 503) - 0.5) * live * 2
				+ (valueNoise(u * 1.45, frame * 0.73 + pass * 4.7, id + 557) - 0.5) * live * 0.65;
			const restatement = pass ? 0.3 : 0;
			const displacement = staticWobble + boilingWobble + restatement;
			return { x: point.x + n.x * displacement, y: point.y + n.y * displacement };
		});
		const bandNormals = moved.map((_, index) => {
			const before = moved[Math.max(0, index - 1)];
			const after = moved[Math.min(moved.length - 1, index + 1)];
			return normal(norm(sub(after, before)));
		});
		const radii = moved.map((_, index) => {
			const progress = moved.length === 1 ? 0.5 : index / (moved.length - 1);
			const endpointPool = closed
				? 0
				: Math.max(
					1 - smoothstep(Math.min(1, progress / 0.075)),
					1 - smoothstep(Math.min(1, (1 - progress) / 0.075)),
				) * 0.11;
			const pressure = 0.96
				+ (valueNoise(index * 0.2, pass * 5.7, id + 709) - 0.5) * 0.24
				+ (valueNoise(index * 0.13, frame * 0.29 + pass * 3.1, id + 811) - 0.5) * 0.08
				+ endpointPool;
			return Math.max(0.18, width * (primaryPass ? 0.89 : 0.34) * pressure * 0.5);
		});
		const left = moved.map((point, index) => add(point, mul(bandNormals[index], radii[index])));
		const right = moved.map((point, index) => add(point, mul(bandNormals[index], -radii[index])));

		ctx.beginPath();
		ctx.moveTo(left[0].x, left[0].y);
		for (let index = 1; index < left.length; index++) ctx.lineTo(left[index].x, left[index].y);
		for (let index = right.length - 1; index >= 0; index--) ctx.lineTo(right[index].x, right[index].y);
		ctx.closePath();
		ctx.fill(options.fillRule ?? 'evenodd');
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
	color?: string;
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
					color: options.color,
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

function stipple(
	ctx: CanvasRenderingContext2D,
	polygon: Pt[],
	id: number,
	count: number,
	color: string,
	alpha = 0.6,
): void {
	const { minX, maxX, minY, maxY } = polygonBounds(polygon);
	ctx.save();
	ctx.fillStyle = color;
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
	torsoY: number;
	leftShoulderY: number;
	rightShoulderY: number;
	headX: number;
	headY: number;
	headAngle: number;
	headEmoteAngle: number;
	headTurn: number;
	faceLookY: number;
	eyeLookY: number;
	breath: number;
	bellySpread: number;
	mouthPurse: number;
	mouthTension: number;
	leftBrowLift: number;
	rightBrowLift: number;
	leftBrowArch: number;
	rightBrowArch: number;
	mouthCurl: number;
	leftEyeOpen: number;
	rightEyeOpen: number;
	leftArm: [Pt, Pt, Pt];
	rightArm: [Pt, Pt, Pt];
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
		// Hold the correction across several ink frames, then return it before
		// the later deep-breath envelope begins.
		headCorrection: direction * heldEnvelope(phraseTime, correctionStart, 0.5, 0.75, 0.7),
		mouthSet: direction * heldEnvelope(phraseTime, correctionStart + 0.25, 0.25, 0.42, 0.45),
		deepBreath: heldEnvelope(phraseTime, breathStart, 0.85, 0.2, 1.1),
	};
}

function poseAtRest(time: number, emote?: BlonkyEmotePose): Pose {
	const behavior = idleBehaviorAt(time);
	const emoteOffset = sampleBlonkyEmoteOffset(emote);
	const idleBehaviorWeight = 1 - emoteOffset.presence * 0.85;
	const breathWave = Math.sin(time * 1.47 - 0.4);
	const breath = breathWave + behavior.deepBreath * 0.82;
	const swayPhase = time * 0.86;
	const sway = Math.sin(swayPhase) * 2.8;
	const centerX = 450 + sway + emoteOffset.bodyX;
	const restingShoulderY = 294 - breath * 1.7;
	const shoulderY = restingShoulderY + emoteOffset.shoulderY;
	const torsoY = restingShoulderY + emoteOffset.torsoY;
	const leftShoulderY = shoulderY + 3.4 + Math.sin(swayPhase - 0.2) * 0.65 + emoteOffset.shoulderTilt;
	const rightShoulderY = shoulderY - 1.6 + Math.sin(swayPhase + 0.35) * 0.45 - emoteOffset.shoulderTilt;
	const armSway = Math.sin(swayPhase - 0.24) * 2.25;
	const armBreath = Math.sin(time * 1.47 - 0.68);
	const armBodyX = emoteOffset.bodyX * 0.65;
	const armBodyY = emoteOffset.torsoY * 0.35;
	const { leftEyeOpen, rightEyeOpen } = blinkPoseAt(time);
	const leftArm: [Pt, Pt, Pt] = [
		{ x: 450 + armSway + armBodyX - 341, y: leftShoulderY + 320 },
		{ x: 450 + armSway + armBodyX - 358, y: 742 - armBreath * 0.85 + armBodyY },
		{ x: 450 + armSway + armBodyX - 349, y: 846 + armBodyY * 0.4 },
	];
	const rightArm: [Pt, Pt, Pt] = [
		{ x: 450 + armSway + armBodyX + 342, y: rightShoulderY + 318 },
		{ x: 450 + armSway + armBodyX + 363, y: 745 - armBreath * 0.72 + armBodyY },
		{ x: 450 + armSway + armBodyX + 352, y: 846 + armBodyY * 0.4 },
	];

	return {
		centerX,
		shoulderY,
		torsoY,
		leftShoulderY,
		rightShoulderY,
		headX: centerX - 5 + Math.sin(swayPhase - 0.43) * 1.45 + behavior.headCorrection * 1.2 * idleBehaviorWeight + emoteOffset.headX,
		headY: 295 - breathWave * 0.62 - behavior.deepBreath * 0.75 + emoteOffset.headY,
		headAngle: -0.024 + Math.sin(swayPhase - 0.48) * 0.009 + behavior.headCorrection * 0.008 * idleBehaviorWeight,
		headEmoteAngle: emoteOffset.headAngle,
		headTurn: Math.sin(time * 0.7 - 0.4) * 0.24 + behavior.headCorrection * 0.82 * idleBehaviorWeight + emoteOffset.headTurn,
		faceLookY: emoteOffset.faceLookY,
		eyeLookY: emoteOffset.eyeLookY,
		breath,
		bellySpread: breath * 2.15 + behavior.deepBreath * 1.4 + emoteOffset.bellySpread,
		mouthPurse: emoteOffset.mouthPurse,
		mouthTension: behavior.mouthSet * idleBehaviorWeight + emoteOffset.mouthTension,
		leftBrowLift: emoteOffset.leftBrowLift,
		rightBrowLift: emoteOffset.rightBrowLift,
		leftBrowArch: emoteOffset.leftBrowArch,
		rightBrowArch: emoteOffset.rightBrowArch,
		mouthCurl: emoteOffset.mouthCurl,
		leftEyeOpen: leftEyeOpen + (emoteOffset.leftEyeOpen - leftEyeOpen) * emoteOffset.presence,
		rightEyeOpen: rightEyeOpen + (emoteOffset.rightEyeOpen - rightEyeOpen) * emoteOffset.presence,
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

function drawLimb(
	ctx: CanvasRenderingContext2D,
	chain: [Pt, Pt, Pt],
	id: number,
	startRadius: number,
	endRadius: number,
	outlineInk: string,
	cuffEdge: [Pt, Pt],
): void {
	const shape = tube(chain, startRadius, endRadius);
	const polygon = shape.left.concat(shape.right.slice().reverse());
	fill(ctx, polygon, SKIN, 1);
	fill(ctx, polygon, WASH, 0.12);
	const trimAtCuff = (points: Pt[]): Pt[] => {
		const [a, b] = cuffEdge;
		const signedDistance = (point: Pt): number => {
			const t = (point.x - a.x) / (b.x - a.x);
			return point.y - (a.y + (b.y - a.y) * t);
		};
		for (let index = 0; index < points.length; index++) {
			const currentDistance = signedDistance(points[index]);
			if (currentDistance < 0) continue;
			if (index === 0) return points;
			const previousDistance = signedDistance(points[index - 1]);
			const crossing = -previousDistance / (currentDistance - previousDistance);
			return [lerp(points[index - 1], points[index], crossing), ...points.slice(index)];
		}
		return [];
	};
	stroke(ctx, trimAtCuff(shape.left), id, { width: 2.2, boil: 0.42, color: outlineInk });
	stroke(ctx, trimAtCuff(shape.right), id + 1, { width: 2.2, boil: 0.42, color: outlineInk });
}

function drawHead(ctx: CanvasRenderingContext2D, pose: Pose, outlineInk: string): void {
	ctx.save();
	// Apply head rotation around a body-anchored neck pivot. Excluding the shirt
	// keeps collar geometry fixed while the jaw overlaps the neck skin.
	const neckPivot = { x: pose.centerX, y: pose.shoulderY - 10 };
	ctx.translate(neckPivot.x, neckPivot.y);
	ctx.rotate(pose.headAngle + pose.headEmoteAngle);
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
	fill(ctx, skull, SKIN, 1);
	fill(ctx, skull, WASH, 0.11);
	stroke(ctx, outerHead, 611, { width: 1.82, boil: 0.46, color: outlineInk });

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
		stroke(ctx, [point, add(point, mul(direction, length))], 620 + index, {
			width: 0.72,
			passes: 1,
			boil: 0.35,
			color: outlineInk,
		});
	}

	ctx.save();
	// Apply base yaw to the full face. Add per-feature parallax below for depth.
	ctx.translate(turn * 1.15, pose.faceLookY);
	const leftEyeTurn = turn * -0.1;
	const rightEyeTurn = turn * 0.55;
	const leftEyeCenter = { x: -34 + leftEyeTurn, y: -56.5 + turn * 0.18 + pose.eyeLookY };
	const rightEyeCenter = { x: 30 + rightEyeTurn, y: -49 - turn * 0.12 + pose.eyeLookY };
	const underEyeFollow = pose.eyeLookY * 0.1;
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
	const leftEyeClosed = pose.leftEyeOpen <= 0.2;
	const rightEyeClosed = pose.rightEyeOpen <= 0.2;
	if (!leftEyeClosed) fill(ctx, leftEye, EYE_WHITE, 1);
	if (!rightEyeClosed) fill(ctx, rightEye, EYE_WHITE, 1);
	stroke(ctx, leftEye, 630, {
		closed: true,
		width: 1.95,
		passes: 2,
		boil: 0.34,
		fillRule: leftEyeClosed ? 'nonzero' : 'evenodd',
	});
	stroke(ctx, rightEye, 631, {
		closed: true,
		width: 1.86,
		passes: 2,
		boil: 0.34,
		fillRule: rightEyeClosed ? 'nonzero' : 'evenodd',
	});
	stroke(ctx, [{ x: -47 + leftEyeTurn, y: -40 + underEyeFollow }, { x: -38 + leftEyeTurn, y: -35 + underEyeFollow }, { x: -28 + leftEyeTurn, y: -35 + underEyeFollow }, { x: -20 + leftEyeTurn, y: -40 + underEyeFollow }], 632, { width: 1.12, alpha: 0.82, passes: 1, boil: 0.28 });
	stroke(ctx, [{ x: 21 + rightEyeTurn, y: -35 + underEyeFollow }, { x: 28 + rightEyeTurn, y: -32 + underEyeFollow }, { x: 36 + rightEyeTurn, y: -33 + underEyeFollow }, { x: 41 + rightEyeTurn, y: -37 + underEyeFollow }], 633, { width: 1.02, alpha: 0.76, passes: 1, boil: 0.28 });
	stroke(ctx, [
		{ x: -49 + leftEyeTurn, y: -67 - pose.leftBrowLift * 0.5 - pose.leftBrowArch * 0.75 },
		{ x: -41 + leftEyeTurn, y: -75 - pose.leftBrowLift - pose.leftBrowArch },
		{ x: -30 + leftEyeTurn, y: -78 - pose.leftBrowLift * 0.7 - pose.leftBrowArch * 0.2 },
	], 634, { width: 1.55, boil: 0.36 });
	stroke(ctx, [
		{ x: 25 + rightEyeTurn, y: -70 - pose.rightBrowLift * 0.7 - pose.rightBrowArch * 0.2 },
		{ x: 35 + rightEyeTurn, y: -73 - pose.rightBrowLift - pose.rightBrowArch },
		{ x: 46 + rightEyeTurn, y: -66 - pose.rightBrowLift * 0.5 - pose.rightBrowArch * 0.75 },
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
	const mouthPurse = pose.mouthPurse;
	const leftMouthCurl = Math.max(0, -pose.mouthCurl);
	const rightMouthCurl = Math.max(0, pose.mouthCurl);
	const mouthLine: Pt[] = [
		{ x: -38 + turn * 0.65 + mouthPurse * 10 + leftMouthCurl * 4, y: 15 + pose.mouthTension * 0.8 - leftMouthCurl * 3.2 },
		{ x: -17 + turn * 0.8 + mouthPurse * 2 + leftMouthCurl * 1.4, y: 13 - leftMouthCurl * 1.2 },
		{ x: 1 + turn - mouthPurse * 2 - rightMouthCurl * 1.4, y: 12 - rightMouthCurl * 1.2 },
		{ x: 17 + turn * 1.2 - mouthPurse * 8 - rightMouthCurl * 4, y: 14 - pose.mouthTension * 1.15 - rightMouthCurl * 3.2 },
	];
	stroke(ctx, mouthLine, 637, { width: 1.62, boil: 0.36 });
	stroke(ctx, [{ x: -18, y: 22 }, { x: -5, y: 21 }], 638, { width: 1.08, alpha: 0.7, passes: 1 });
	stroke(ctx, [{ x: -55, y: 32 }, { x: -39, y: 44 }, { x: -12, y: 51 }, { x: 14, y: 49 }, { x: 43, y: 33 }], 639, { width: 1.5, alpha: 0.7, boil: 0.34 });
	stroke(ctx, [{ x: -42, y: 49 }, { x: -20, y: 58 }, { x: 2, y: 61 }, { x: 22, y: 56 }, { x: 36, y: 48 }], 640, { width: 1.12, alpha: 0.54, passes: 1, boil: 0.3 });
	ctx.restore();

	ctx.restore();
}

function drawCuffBand(
	ctx: CanvasRenderingContext2D,
	upperStart: Pt,
	upperEnd: Pt,
	lowerStart: Pt,
	lowerEnd: Pt,
	id: number,
	color: string,
): void {
	stroke(ctx, [upperStart, upperEnd], id, { width: 2.1, alpha: 0.82, boil: 0.38, color });
	stroke(ctx, [lowerStart, lowerEnd], id + 1, { width: 2.1, alpha: 0.82, boil: 0.38, color });
	const zigzag: Pt[] = [];
	const teeth = 10;
	for (let index = 0; index <= teeth * 2; index++) {
		const t = index / (teeth * 2);
		zigzag.push(lerp(index % 2 === 0 ? upperStart : lowerStart, index % 2 === 0 ? upperEnd : lowerEnd, t));
	}
	stroke(ctx, zigzag, id + 2, { width: 1.4, alpha: 0.76, passes: 1, boil: 0.32, color });
}

interface CollarGeometry {
	chestSkin: Pt[];
	edge: Pt[];
	leftContact: Pt;
	rightContact: Pt;
	seam: Pt[];
}

function collarGeometry(pose: Pose): CollarGeometry {
	const shoulderTravel = pose.shoulderY - pose.torsoY;
	const anchoredY = (offset: number, shoulderWeight: number): number => (
		pose.torsoY + offset + shoulderTravel * shoulderWeight
	);
	const leftContact = { x: pose.centerX - 202, y: pose.shoulderY - 8 };
	const rightContact = { x: pose.centerX + 208, y: pose.shoulderY - 10 };
	const bottom = { x: pose.centerX - 3, y: anchoredY(180, 0.35) };
	const leftMid = { x: pose.centerX - 164, y: anchoredY(108, 0.55) };
	const rightMid = { x: pose.centerX + 190, y: anchoredY(105, 0.55) };
	const leftHalf = quadratic(
		leftContact,
		{ x: pose.centerX - 207, y: anchoredY(58, 0.76) },
		leftMid,
		14,
	).concat(quadratic(
		leftMid,
		{ x: pose.centerX - 96, y: anchoredY(171, 0.42) },
		bottom,
		12,
	).slice(1));
	const rightHalf = quadratic(
		bottom,
		{ x: pose.centerX + 93, y: anchoredY(174, 0.42) },
		rightMid,
		12,
	).concat(quadratic(
		rightMid,
		{ x: pose.centerX + 211, y: anchoredY(59, 0.76) },
		rightContact,
		14,
	).slice(1));
	const edge = leftHalf.concat(rightHalf.slice(1));
	const fullSeam = edge.map((point, index) => {
		const before = edge[Math.max(0, index - 1)];
		const after = edge[Math.min(edge.length - 1, index + 1)];
		return add(point, mul(normal(norm(sub(after, before))), 14));
	});
	fullSeam[0] = lerp(fullSeam[0], fullSeam[1], 0.2);
	const rightShoulder = { x: pose.centerX + 292, y: pose.rightShoulderY + 24 };
	const seam = endPolylineAtSegment(fullSeam, rightContact, rightShoulder);
	const leftChestTop = { x: pose.centerX - 150, y: anchoredY(-18, 0.72) };
	const rightChestTop = { x: pose.centerX + 150, y: anchoredY(-18, 0.72) };
	const skinTop = quadratic(
		leftContact,
		{ x: pose.centerX - 184, y: anchoredY(-17, 0.82) },
		leftChestTop,
		5,
	).concat(
		quadratic(
			leftChestTop,
			{ x: pose.centerX, y: anchoredY(-30, 0.58) },
			rightChestTop,
			12,
		).slice(1),
		quadratic(
			rightChestTop,
			{ x: pose.centerX + 184, y: anchoredY(-17, 0.82) },
			rightContact,
			5,
		).slice(1),
	);
	const chestSkin = skinTop.concat(edge.slice(1, -1).reverse());
	return { chestSkin, edge, leftContact, rightContact, seam };
}

function drawBody(ctx: CanvasRenderingContext2D, pose: Pose, palette: BlonkyPalette): void {
	const leftY = pose.leftShoulderY;
	const rightY = pose.rightShoulderY;
	const leftCuffLower: [Pt, Pt] = [
		{ x: pose.centerX - 450, y: leftY + 331 },
		{ x: pose.centerX - 230, y: leftY + 367 },
	];
	const rightCuffLower: [Pt, Pt] = [
		{ x: pose.centerX + 230, y: rightY + 365 },
		{ x: pose.centerX + 450, y: rightY + 316 },
	];
	// Skin overlaps beneath the cuffs; arm outlines begin at the cuff edges.
	drawLimb(ctx, pose.leftArm, 740, 98, 82, palette.outlineInk, leftCuffLower);
	drawLimb(ctx, pose.rightArm, 745, 94, 84, palette.outlineInk, rightCuffLower);
	const belly = pose.bellySpread;
	const collar = collarGeometry(pose);
	const leftSleeveOuter: Pt[] = [
		collar.leftContact,
		{ x: pose.centerX - 292, y: leftY + 22 },
		{ x: pose.centerX - 370, y: leftY + 105 },
		{ x: pose.centerX - 424, y: leftY + 216 },
		{ x: pose.centerX - 450, y: leftY + 301 },
		{ x: pose.centerX - 450, y: leftY + 331 },
		{ x: pose.centerX - 230, y: leftY + 367 },
	];
	const leftArmpit = { x: pose.centerX - 215, y: leftY + 215 };
	const leftBodyFillTop = { x: pose.centerX - 232, y: leftY + 282 };
	const leftBodySide = { x: pose.centerX - 278 - belly * 0.72, y: pose.torsoY + 395 };
	const leftBodyBottom = { x: pose.centerX - 286 - belly, y: H + 18 };
	const rightBodyBottom = { x: pose.centerX + 288 + belly * 0.86, y: H + 18 };
	const rightBodySide = { x: pose.centerX + 280 + belly * 0.64, y: pose.torsoY + 395 };
	const rightBodyFillTop = { x: pose.centerX + 232, y: rightY + 282 };
	const bodyOuter: Pt[] = [
		leftBodyFillTop,
		leftBodySide,
		leftBodyBottom,
		rightBodyBottom,
		rightBodySide,
		rightBodyFillTop,
	];
	const rightArmpit = { x: pose.centerX + 215, y: rightY + 215 };
	const rightSleeveOuter: Pt[] = [
		{ x: pose.centerX + 230, y: rightY + 365 },
		{ x: pose.centerX + 450, y: rightY + 316 },
		{ x: pose.centerX + 438, y: rightY + 226 },
		{ x: pose.centerX + 384, y: rightY + 112 },
		{ x: pose.centerX + 292, y: rightY + 24 },
		collar.rightContact,
	];
	// Use one closed path to prevent seams between the torso and sleeves.
	const torsoOuter = leftSleeveOuter
		.concat(leftArmpit, bodyOuter, rightArmpit, rightSleeveOuter);
	// Close the shirt around a shallow chest opening. Skin begins at the shoulder
	// line; no separate neck geometry is drawn behind the head.
	const shirt = torsoOuter.concat(collar.edge.slice(1, -1).reverse());
	fill(ctx, collar.chestSkin, SKIN, 1);
	fill(ctx, collar.chestSkin, WASH, 0.11);
	fill(ctx, shirt, palette.shirt, 1);
	stipple(ctx, shirt, 750, 1320, palette.shirtTextureInk, palette.shirtTextureAlpha);
	hatch(ctx, shirt, 751, {
		spacing: 38,
		angle: -0.78,
		alpha: 0.045,
		width: 0.68,
		color: palette.shirtTextureInk,
	});
	// Visible contours omit the internal fill edges between sleeves and torso.
	stroke(ctx, leftSleeveOuter, 752, { width: 3.45, boil: 0.46, color: palette.outlineInk });
	stroke(ctx, [leftBodySide, leftBodyBottom], 754, { width: 3.45, boil: 0.46, color: palette.outlineInk });
	stroke(ctx, [rightBodyBottom, rightBodySide], 766, { width: 3.45, boil: 0.46, color: palette.outlineInk });
	stroke(ctx, rightSleeveOuter, 765, { width: 3.45, boil: 0.46, color: palette.outlineInk });
	stroke(ctx, collar.edge, 753, { width: 3.25, alpha: 0.95, boil: 0.46, color: palette.outlineInk });
	stroke(ctx, collar.seam, 764, { width: 2.65, alpha: 0.9, boil: 0.42, color: palette.outlineInk });

	drawCuffBand(
		ctx,
		{ x: pose.centerX - 450, y: leftY + 305 },
		{ x: pose.centerX - 225, y: leftY + 346 },
		leftCuffLower[0],
		leftCuffLower[1],
		755,
		palette.outlineInk,
	);
	drawCuffBand(
		ctx,
		{ x: pose.centerX + 225, y: rightY + 344 },
		{ x: pose.centerX + 446, y: rightY + 291 },
		rightCuffLower[0],
		rightCuffLower[1],
		758,
		palette.outlineInk,
	);
	stroke(ctx, quadratic(
		leftArmpit,
		{ x: pose.centerX - 222, y: leftY + 286 },
		leftCuffLower[1],
		14,
	), 767, { width: 2.85, boil: 0.42, color: palette.outlineInk });
	stroke(ctx, quadratic(
		rightArmpit,
		{ x: pose.centerX + 222, y: rightY + 284 },
		rightCuffLower[0],
		14,
	), 768, { width: 2.85, boil: 0.42, color: palette.outlineInk });

	stroke(ctx, quadratic(
		{ x: pose.centerX - 72 - belly * 0.3, y: pose.torsoY + 296 - pose.breath * 1.1 },
		{ x: pose.centerX - 18, y: pose.torsoY + 284 - pose.breath * 1.45 },
		{ x: pose.centerX + 58 + belly * 0.25, y: pose.torsoY + 299 - pose.breath * 0.9 },
		18,
	), 762, { width: 1.55, alpha: 0.5, boil: 0.24, color: palette.outlineInk });
	stroke(ctx, quadratic(
		{ x: pose.centerX - 150 - belly * 0.65, y: pose.torsoY + 354 + pose.breath * 0.65 },
		{ x: pose.centerX + 10, y: pose.torsoY + 327 - pose.breath * 0.35 },
		{ x: pose.centerX + 138 + belly * 0.55, y: pose.torsoY + 360 + pose.breath * 0.8 },
		18,
	), 763, { width: 1.9, alpha: 0.6, boil: 0.26, color: palette.outlineInk });
}

export function drawBlonky(ctx: CanvasRenderingContext2D, time: number, options: BlonkyDrawOptions = {}): void {
	frame = Math.floor(time * FPS);
	const inkTime = frame / FPS;
	const view = options.view ?? 'bust';
	const viewport = BLONKY_VIEWPORTS[view];
	const palette = options.palette ?? DEFAULT_BLONKY_PALETTE;
	ctx.clearRect(0, 0, viewport.width, viewport.height);
	const pose = poseAtRest(inkTime, options.emote);
	ctx.save();
	if (view === 'debug') {
		ctx.translate((viewport.width - BLONKY_BUST_WIDTH) / 2, 0);
	} else if (view === 'portrait') {
		ctx.translate(8, -5);
		ctx.scale(0.56, 0.56);
	}
	if (options.showBody !== false) drawBody(ctx, pose, palette);
	if (options.showHead !== false) drawHead(ctx, pose, palette.outlineInk);
	ctx.restore();
}
