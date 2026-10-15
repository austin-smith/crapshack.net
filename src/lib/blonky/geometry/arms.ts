import { hash } from '../noise';
import { BLONKY_BUST_HEIGHT } from '../types';
import type { Pose } from './pose';
import {
	add,
	lerp,
	mul,
	norm,
	normal,
	quadratic,
	segmentIntersection,
	sub,
	throughJoint,
	type Pt,
} from './points';
import type { WaveArm } from './wave';

const H = BLONKY_BUST_HEIGHT;

export interface ArmGeometry {
	wave?: WaveArm;
	attachmentEdge: Pt[];
	chain: [Pt, Pt, Pt];
	cuffId: number;
	cuffLower: [Pt, Pt];
	cuffUpper: [Pt, Pt];
	endRadius: number;
	/**
	 * Segments above and below the elbow in the arm's skin. Each sample
	 * carries its own hand-drawn wobble, so the count stays put as he breathes.
	 */
	limbSegments: [number, number];
	innerContour: Pt[];
	limbId: number;
	outlineId: number;
	side: -1 | 1;
	skinInnerBoundaryId: number;
	skinInnerBoundary: Pt[];
	sleeveOuter: Pt[];
	sleeveSurface: Pt[];
	startRadius: number;
}

export function armGeometry(
	pose: Pose,
	side: -1 | 1,
): ArmGeometry {
	const shoulderY = side === -1 ? pose.leftShoulderY : pose.rightShoulderY;
	const armpit = {
		x: pose.centerX + side * 215,
		y: shoulderY + 215,
	};
	const chain = side === -1 ? pose.leftArm : pose.rightArm;
	const belly = pose.bellySpread;

	if (side === -1) {
		const cuffUpper: [Pt, Pt] = [
			{ x: pose.centerX - 450, y: shoulderY + 305 },
			{ x: pose.centerX - 225, y: shoulderY + 346 },
		];
		const cuffLower: [Pt, Pt] = [
			{ x: pose.centerX - 450, y: shoulderY + 331 },
			{ x: pose.centerX - 230, y: shoulderY + 367 },
		];
		const attachment = { x: pose.centerX - 292, y: shoulderY + 22 };
		const sleeveOuter: Pt[] = [
			attachment,
			{ x: pose.centerX - 370, y: shoulderY + 105 },
			{ x: pose.centerX - 424, y: shoulderY + 216 },
			{ x: pose.centerX - 450, y: shoulderY + 301 },
			cuffLower[0],
			cuffLower[1],
		];
		const innerContour = quadratic(
			armpit,
			{ x: pose.centerX - 222, y: shoulderY + 286 },
			cuffLower[1],
			14,
		);
		const attachmentEdge = quadratic(
			attachment,
			{ x: pose.centerX - 235, y: shoulderY + 95 },
			armpit,
			12,
		);
		const bodyFillTop = { x: pose.centerX - 232, y: shoulderY + 282 };
		const bodySide = {
			x: pose.centerX - 278 - belly * 0.72,
			y: pose.torsoY + 395,
		};
		const bodyBottom = { x: pose.centerX - 286 - belly, y: H + 18 };
		const skinTop = segmentIntersection(
			cuffLower[0],
			cuffLower[1],
			bodyFillTop,
			bodySide,
		) ?? bodyFillTop;
		const innerShift = cuffLower[1].x - skinTop.x;
		const skinInnerBoundary = [skinTop, bodySide, bodyBottom].map((point) => ({
			x: point.x + innerShift,
			y: point.y,
		}));
		return {
			attachmentEdge,
			chain,
			cuffLower,
			cuffUpper,
			endRadius: 82,
			limbSegments: [19, 16],
			innerContour,
			limbId: 740,
			outlineId: 752,
			side,
			skinInnerBoundaryId: 754,
			skinInnerBoundary,
			sleeveOuter,
			sleeveSurface: sleeveOuter.concat(
				innerContour.slice(0, -1).reverse(),
				attachmentEdge.slice(0, -1).reverse(),
			),
			startRadius: 98,
			cuffId: 755,
		};
	}

	const cuffUpper: [Pt, Pt] = [
		{ x: pose.centerX + 225, y: shoulderY + 344 },
		{ x: pose.centerX + 446, y: shoulderY + 291 },
	];
	const cuffLower: [Pt, Pt] = [
		{ x: pose.centerX + 230, y: shoulderY + 365 },
		{ x: pose.centerX + 450, y: shoulderY + 316 },
	];
	const attachment = { x: pose.centerX + 292, y: shoulderY + 24 };
	const sleeveOuter: Pt[] = [
		cuffLower[0],
		cuffLower[1],
		{ x: pose.centerX + 438, y: shoulderY + 226 },
		{ x: pose.centerX + 384, y: shoulderY + 112 },
		attachment,
	];
	const innerContour = quadratic(
		armpit,
		{ x: pose.centerX + 222, y: shoulderY + 284 },
		cuffLower[0],
		14,
	);
	const attachmentEdge = quadratic(
		attachment,
		{ x: pose.centerX + 238, y: shoulderY + 94 },
		armpit,
		12,
	);
	const bodyFillTop = { x: pose.centerX + 232, y: shoulderY + 282 };
	const bodySide = {
		x: pose.centerX + 280 + belly * 0.64,
		y: pose.torsoY + 395,
	};
	const bodyBottom = { x: pose.centerX + 288 + belly * 0.86, y: H + 18 };
	const skinTop = segmentIntersection(
		cuffLower[0],
		cuffLower[1],
		bodyFillTop,
		bodySide,
	) ?? bodyFillTop;
	const innerShift = cuffLower[0].x - skinTop.x;
	const skinInnerBoundary = [skinTop, bodySide, bodyBottom].map((point) => ({
		x: point.x + innerShift,
		y: point.y,
	}));
	return {
		attachmentEdge,
		chain,
		cuffLower,
		cuffUpper,
		endRadius: 84,
		limbSegments: [20, 15],
		innerContour,
		limbId: 745,
		outlineId: 765,
		side,
		skinInnerBoundaryId: 766,
		skinInnerBoundary,
		sleeveOuter,
		sleeveSurface: sleeveOuter.concat(
			attachmentEdge.slice(0, -1),
			innerContour.slice(0, -1),
		),
		startRadius: 94,
		cuffId: 758,
	};
}

export function tensionArmGeometry(arm: ArmGeometry, tension: number): ArmGeometry {
	if (tension === 0) return arm;
	const shiftX = -arm.side * tension * 220;
	const translate = (point: Pt): Pt => ({ x: point.x + shiftX, y: point.y });
	const translatePair = (points: [Pt, Pt]): [Pt, Pt] => (
		[translate(points[0]), translate(points[1])]
	);
	const translateChain = (points: [Pt, Pt, Pt]): [Pt, Pt, Pt] => (
		[translate(points[0]), translate(points[1]), translate(points[2])]
	);

	return {
		...arm,
		attachmentEdge: arm.attachmentEdge.map(translate),
		chain: translateChain(arm.chain),
		cuffLower: translatePair(arm.cuffLower),
		cuffUpper: translatePair(arm.cuffUpper),
		innerContour: arm.innerContour.map(translate),
		skinInnerBoundary: arm.skinInnerBoundary.map(translate),
		sleeveOuter: arm.sleeveOuter.map(translate),
		sleeveSurface: arm.sleeveSurface.map(translate),
	};
}

function tube(
	chain: [Pt, Pt, Pt],
	segments: [number, number],
	startRadius: number,
	endRadius: number,
): { left: Pt[]; right: Pt[]; center: Pt[] } {
	const center = throughJoint(chain, segments);
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

export function restingSkinContours(arm: ArmGeometry): { outer: Pt[]; inner: Pt[] } {
	const { chain, limbSegments, side, startRadius, endRadius } = arm;
	const cuffEdge = arm.cuffLower;
	const shape = tube(chain, limbSegments, startRadius, endRadius);
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
	const trimmedOuter = trimAtCuff(side === -1 ? shape.left : shape.right);
	const outerCuff = side === -1 ? cuffEdge[0] : cuffEdge[1];
	const outerShift = outerCuff.x - (trimmedOuter[0]?.x ?? outerCuff.x);
	const outer = trimmedOuter.map((point) => ({
		x: point.x + outerShift,
		y: point.y,
	}));
	return { outer, inner: arm.skinInnerBoundary };
}

export function cuffZigzag(upperStart: Pt, upperEnd: Pt, lowerStart: Pt, lowerEnd: Pt): Pt[] {
	const zigzag: Pt[] = [];
	const teeth = 10;
	for (let index = 0; index <= teeth * 2; index++) {
		const t = index / (teeth * 2);
		zigzag.push(lerp(index % 2 === 0 ? upperStart : lowerStart, index % 2 === 0 ? upperEnd : lowerEnd, t));
	}
	return zigzag;
}
