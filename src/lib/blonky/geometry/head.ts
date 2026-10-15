import { hash, valueNoise } from '../noise';
import type { Pose } from './pose';
import { add, densify, mul, norm, quadratic, type Pt } from './points';

export interface HeadGeometry {
	/** Body-anchored neck pivot for head rotation. */
	pivot: Pt;
	angle: number;
	/** Head center relative to the pivot, applied after rotation. */
	offset: Pt;
	scale: Pt;
	/** Face yaw and look offset inside the head's local space. */
	face: Pt;
	skull: Pt[];
	outerHead: Pt[];
	hairs: { id: number; points: [Pt, Pt] }[];
	// Face features, in face space.
	leftEyeCenter: Pt;
	rightEyeCenter: Pt;
	leftEyeOpen: Pt[];
	rightEyeOpen: Pt[];
	leftEye: Pt[];
	rightEye: Pt[];
	leftEyeClosed: boolean;
	rightEyeClosed: boolean;
	leftUnderEye: Pt[];
	rightUnderEye: Pt[];
	leftBrow: Pt[];
	rightBrow: Pt[];
	nose: Pt[];
	mouthLine: Pt[];
	mouth: Pt[];
	lowerLip: Pt[];
	chin: Pt[];
	lowerChin: Pt[];
}

const SKULL: readonly Pt[] = [
	{ x: -84, y: -45 }, { x: -76, y: -78 }, { x: -55, y: -99 }, { x: -28, y: -109 },
	{ x: 2, y: -111 }, { x: 35, y: -106 }, { x: 63, y: -91 }, { x: 81, y: -66 },
	{ x: 88, y: -36 }, { x: 85, y: -8 }, { x: 84, y: 5 }, { x: 84, y: 24 },
	{ x: 78, y: 43 }, { x: 65, y: 59 }, { x: 46, y: 71 }, { x: 23, y: 78 },
	{ x: -2, y: 79 }, { x: -27, y: 75 }, { x: -49, y: 66 }, { x: -68, y: 51 },
	{ x: -81, y: 30 }, { x: -83, y: -8 },
];

function blinkEye(
	points: Pt[],
	center: Pt,
	openness: number,
	upperLid = 0,
	wink = 0,
	radius = 12,
): Pt[] {
	return points.map((point) => {
		const y = center.y + (point.y - center.y) * openness;
		const upperDistance = Math.max(0, center.y - y);
		// A wink closes against the lifted cheek. Both eye contours converge
		// on this same arch, including the drawings immediately before closure.
		const along = Math.min(1, Math.abs(point.x - center.x) / radius);
		return {
			x: center.x + (point.x - center.x) * (1 - wink * 0.08),
			y: y + upperDistance * upperLid + wink * (2 - 5 * (1 - along * along)),
		};
	});
}

export function headGeometry(pose: Pose): HeadGeometry {
	// Apply head rotation around a body-anchored neck pivot. Excluding the shirt
	// keeps collar geometry fixed while the jaw overlaps the neck skin.
	const pivot = { x: pose.centerX, y: pose.shoulderY - 10 };
	const turn = pose.headTurn;
	const skull = SKULL.slice();
	const outerHead = [
		skull[21],
		...skull.slice(0, 10),
	];

	const hairs: HeadGeometry['hairs'] = [];
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
		hairs.push({ id: 620 + index, points: [point, add(point, mul(direction, length))] });
	}

	// Apply base yaw to the full face. Add per-feature parallax below for depth.
	const leftEyeTurn = turn * -0.1;
	const rightEyeTurn = turn * 0.55;
	const leftEyeCenter = { x: -34 + leftEyeTurn, y: -56.5 + turn * 0.18 + pose.eyeLookY };
	const rightEyeCenter = { x: 30 + rightEyeTurn, y: -49 - turn * 0.12 + pose.eyeLookY };
	const underEyeFollow = pose.eyeLookY * 0.1;
	const leftEyeOpen = [
		{ x: leftEyeCenter.x - 12, y: leftEyeCenter.y - 2 },
		{ x: leftEyeCenter.x - 9, y: leftEyeCenter.y - 8 },
		{ x: leftEyeCenter.x - 3, y: leftEyeCenter.y - 12 },
		{ x: leftEyeCenter.x + 5, y: leftEyeCenter.y - 11 },
		{ x: leftEyeCenter.x + 11, y: leftEyeCenter.y - 6 },
		{ x: leftEyeCenter.x + 12, y: leftEyeCenter.y + 2 },
		{ x: leftEyeCenter.x + 7, y: leftEyeCenter.y + 10 },
		{ x: leftEyeCenter.x, y: leftEyeCenter.y + 12 },
		{ x: leftEyeCenter.x - 7, y: leftEyeCenter.y + 9 },
		{ x: leftEyeCenter.x - 12, y: leftEyeCenter.y + 4 },
	];
	const rightEyeOpen = [
		{ x: rightEyeCenter.x - 10, y: rightEyeCenter.y - 3 },
		{ x: rightEyeCenter.x - 6, y: rightEyeCenter.y - 9 },
		{ x: rightEyeCenter.x + 1, y: rightEyeCenter.y - 11 },
		{ x: rightEyeCenter.x + 8, y: rightEyeCenter.y - 7 },
		{ x: rightEyeCenter.x + 10, y: rightEyeCenter.y - 1 },
		{ x: rightEyeCenter.x + 7, y: rightEyeCenter.y + 7 },
		{ x: rightEyeCenter.x + 1, y: rightEyeCenter.y + 10 },
		{ x: rightEyeCenter.x - 6, y: rightEyeCenter.y + 8 },
		{ x: rightEyeCenter.x - 10, y: rightEyeCenter.y + 2 },
	];
	const leftEye = blinkEye(leftEyeOpen, leftEyeCenter, pose.leftEyeOpen, pose.leftUpperLid, pose.leftWink);
	const rightEye = blinkEye(rightEyeOpen, rightEyeCenter, pose.rightEyeOpen, pose.rightUpperLid, pose.rightWink, 10);
	const leftCheek = pose.leftWink * 2 + pose.mouthSmile * 0.6;
	const rightCheek = pose.rightWink * 2 + pose.mouthSmile * 0.6;
	const noseBridgeX = 9 + turn * 0.35;
	const noseTipX = -6 + turn * 2.6;
	const mouthPurse = pose.mouthPurse;
	const mouthFrown = pose.mouthFrown;
	const mouthSmile = pose.mouthSmile;
	const leftMouthCurl = Math.max(0, -pose.mouthCurl);
	const rightMouthCurl = Math.max(0, pose.mouthCurl);
	const mouthLine: Pt[] = [
		{ x: -38 + turn * 0.65 + mouthPurse * 10 + leftMouthCurl * 4, y: 15 + pose.mouthTension * 0.8 + mouthFrown * 4.4 - leftMouthCurl * 3.2 },
		{ x: -17 + turn * 0.8 + mouthPurse * 2 + leftMouthCurl * 1.4, y: 13 - mouthFrown * 1.2 - leftMouthCurl * 1.2 },
		{ x: 1 + turn - mouthPurse * 2 - rightMouthCurl * 1.4, y: 12 - mouthFrown * 1.4 - rightMouthCurl * 1.2 },
		{ x: 17 + turn * 1.2 - mouthPurse * 8 - rightMouthCurl * 4, y: 14 - pose.mouthTension * 1.15 + mouthFrown * 4.4 - rightMouthCurl * 3.2 },
	];
	// Bend the whole mouth into a shallow smile. Moving only its four anchors
	// makes a sharp notch; pulling a corner inward makes it hook into the nose.
	const mouth = mouthSmile > 0 ? densify(mouthLine, false, 4).map((point) => {
		const t = (point.x - mouthLine[0].x) / (mouthLine.at(-1)!.x - mouthLine[0].x);
		const u = 1 - t;
		const smileY = u * u * (14 - leftMouthCurl * 4)
			+ 2 * u * t * 24
			+ t * t * (13 - rightMouthCurl * 4);
		return { x: point.x, y: point.y + (smileY - point.y) * mouthSmile };
	}) : mouthLine;

	return {
		pivot,
		angle: pose.headAngle + pose.headEmoteAngle,
		offset: { x: pose.headX - pivot.x, y: pose.headY - pivot.y },
		scale: { x: 2.05, y: 1.9 },
		face: { x: turn * 1.15, y: pose.faceLookY },
		skull,
		outerHead,
		hairs,
		leftEyeCenter,
		rightEyeCenter,
		leftEyeOpen,
		rightEyeOpen,
		leftEye,
		rightEye,
		leftEyeClosed: pose.leftEyeOpen <= 0.2,
		rightEyeClosed: pose.rightEyeOpen <= 0.2,
		leftUnderEye: [
			{ x: -47 + leftEyeTurn, y: -40 + underEyeFollow - leftCheek * 0.6 },
			{ x: -38 + leftEyeTurn, y: -35 + underEyeFollow - leftCheek },
			{ x: -28 + leftEyeTurn, y: -35 + underEyeFollow - leftCheek },
			{ x: -20 + leftEyeTurn, y: -40 + underEyeFollow - leftCheek * 0.6 },
		],
		rightUnderEye: [
			{ x: 21 + rightEyeTurn, y: -35 + underEyeFollow - rightCheek * 0.6 },
			{ x: 28 + rightEyeTurn, y: -32 + underEyeFollow - rightCheek },
			{ x: 36 + rightEyeTurn, y: -33 + underEyeFollow - rightCheek },
			{ x: 41 + rightEyeTurn, y: -37 + underEyeFollow - rightCheek * 0.6 },
		],
		leftBrow: [
			{ x: -49 + leftEyeTurn, y: -67 - pose.leftBrowLift * 0.5 - pose.leftBrowArch * 0.75 },
			{ x: -41 + leftEyeTurn, y: -75 - pose.leftBrowLift - pose.leftBrowArch },
			{ x: -30 + leftEyeTurn, y: -78 - pose.leftBrowLift * 0.7 - pose.leftBrowArch * 0.2 },
		],
		rightBrow: [
			{ x: 25 + rightEyeTurn, y: -70 - pose.rightBrowLift * 0.7 - pose.rightBrowArch * 0.2 },
			{ x: 35 + rightEyeTurn, y: -73 - pose.rightBrowLift - pose.rightBrowArch },
			{ x: 46 + rightEyeTurn, y: -66 - pose.rightBrowLift * 0.5 - pose.rightBrowArch * 0.75 },
		],
		nose: [
			{ x: noseBridgeX, y: -42 },
			{ x: noseBridgeX + 1 + turn * 0.35, y: -22 },
			{ x: noseBridgeX + 1 + turn * 0.8, y: -5 },
			{ x: 7 + turn * 1.8, y: 1 },
			{ x: noseTipX, y: 4 },
			{ x: -16 + turn * 2.25, y: 2 },
			{ x: -25 + turn * 2.15, y: -2 },
		],
		mouthLine,
		mouth,
		lowerLip: [{ x: -18, y: 22 + mouthSmile * 3 }, { x: -5, y: 21 + mouthSmile * 3 }],
		chin: [{ x: -55, y: 32 }, { x: -39, y: 44 }, { x: -12, y: 51 }, { x: 14, y: 49 }, { x: 43, y: 33 }],
		lowerChin: [{ x: -42, y: 49 }, { x: -20, y: 58 }, { x: 2, y: 61 }, { x: 22, y: 56 }, { x: 36, y: 48 }],
	};
}

/** A winked eye: one lid arch, plus a crease at the outer corner. */
export function winkLid(center: Pt, radius: number, side: -1 | 1): { lid: Pt[]; tick: [Pt, Pt] } {
	const corner = { x: center.x + side * radius * 0.92, y: center.y + 2 };
	return {
		lid: quadratic(
			{ x: center.x - radius * 0.92, y: center.y + 2 },
			{ x: center.x, y: center.y - 8 },
			{ x: center.x + radius * 0.92, y: center.y + 2 },
			8,
		),
		tick: [corner, { x: corner.x + side * 3, y: corner.y + 3 }],
	};
}
