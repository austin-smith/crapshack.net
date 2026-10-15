import { BLONKY_BUST_HEIGHT } from '../types';
import { armGeometry, tensionArmGeometry, type ArmGeometry } from './arms';
import type { Pose } from './pose';
import {
	add,
	endPolylineAtSegment,
	lerp,
	mul,
	norm,
	normal,
	quadratic,
	sub,
	type Pt,
} from './points';
import { wavingArmGeometry } from './wave';

const H = BLONKY_BUST_HEIGHT;

export interface CollarGeometry {
	chestSkin: Pt[];
	/** Top of the exposed chest skin, from the left collar contact to the right. */
	skinTop: Pt[];
	edge: Pt[];
	leftContact: Pt;
	rightContact: Pt;
	seam: Pt[];
}

export function collarGeometry(pose: Pose): CollarGeometry {
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
	return { chestSkin, edge, leftContact, rightContact, seam, skinTop };
}

export interface TorsoGeometry {
	collar: CollarGeometry;
	outline: Pt[];
	surface: Pt[];
}

export function torsoGeometry(
	pose: Pose,
	collar: CollarGeometry,
	leftArm: ArmGeometry,
	rightArm: ArmGeometry,
): TorsoGeometry {
	const belly = pose.bellySpread;
	const leftAttachment = leftArm.attachmentEdge[0];
	const rightAttachment = rightArm.attachmentEdge[0];
	const leftShoulder = {
		x: pose.centerX - 330 - belly * 0.25,
		y: pose.torsoY + 95,
	};
	const leftChest = {
		x: pose.centerX - 350 - belly * 0.55,
		y: pose.torsoY + 300,
	};
	const leftHem = {
		x: pose.centerX - 365 - belly * 0.8,
		y: H + 18,
	};
	const rightHem = {
		x: pose.centerX + 368 + belly * 0.76,
		y: H + 18,
	};
	const rightChest = {
		x: pose.centerX + 354 + belly * 0.5,
		y: pose.torsoY + 300,
	};
	const rightShoulder = {
		x: pose.centerX + 334 + belly * 0.22,
		y: pose.torsoY + 93,
	};
	const leftUpperSide = quadratic(
		leftAttachment,
		{ x: pose.centerX - 318, y: pose.torsoY + 50 },
		leftShoulder,
		8,
	);
	const leftLowerSide = quadratic(
		leftShoulder,
		{ x: pose.centerX - 348 - belly * 0.45, y: pose.torsoY + 260 },
		leftChest,
		12,
	).concat(quadratic(
		leftChest,
		{ x: pose.centerX - 366 - belly * 0.7, y: pose.torsoY + 390 },
		leftHem,
		12,
	).slice(1));
	const rightLowerSide = quadratic(
		rightHem,
		{ x: pose.centerX + 369 + belly * 0.66, y: pose.torsoY + 390 },
		rightChest,
		12,
	).concat(quadratic(
		rightChest,
		{ x: pose.centerX + 350 + belly * 0.4, y: pose.torsoY + 258 },
		rightShoulder,
		12,
	).slice(1));
	const rightUpperSide = quadratic(
		rightShoulder,
		{ x: pose.centerX + 320, y: pose.torsoY + 49 },
		rightAttachment,
		8,
	);
	const outer = [collar.leftContact, leftAttachment]
		.concat(
			leftUpperSide.slice(1),
			leftLowerSide.slice(1),
			rightHem,
			rightLowerSide.slice(1),
			rightUpperSide.slice(1),
			collar.rightContact,
		);
	return {
		collar,
		outline: outer,
		surface: outer.concat(collar.edge.slice(1, -1).reverse()),
	};
}

export function bellyFolds(pose: Pose): [Pt[], Pt[]] {
	const belly = pose.bellySpread;
	return [
		quadratic(
			{ x: pose.centerX - 72 - belly * 0.3, y: pose.torsoY + 296 - pose.breath * 1.1 },
			{ x: pose.centerX - 18, y: pose.torsoY + 284 - pose.breath * 1.45 },
			{ x: pose.centerX + 58 + belly * 0.25, y: pose.torsoY + 299 - pose.breath * 0.9 },
			18,
		),
		quadratic(
			{ x: pose.centerX - 150 - belly * 0.65, y: pose.torsoY + 354 + pose.breath * 0.65 },
			{ x: pose.centerX + 10, y: pose.torsoY + 327 - pose.breath * 0.35 },
			{ x: pose.centerX + 138 + belly * 0.55, y: pose.torsoY + 360 + pose.breath * 0.8 },
			18,
		),
	];
}

export interface BodyGeometry {
	collar: CollarGeometry;
	leftArm: ArmGeometry;
	rightArm: ArmGeometry;
	torso: TorsoGeometry;
}

/** The shirt and both arms as posed: tensed, raised in greeting, or at rest. */
export function bodyGeometry(pose: Pose): BodyGeometry {
	const collar = collarGeometry(pose);
	const leftArm = wavingArmGeometry(tensionArmGeometry(armGeometry(pose, -1), pose.armTension), pose);
	const rightArm = wavingArmGeometry(tensionArmGeometry(armGeometry(pose, 1), pose.armTension), pose);
	const torso = torsoGeometry(pose, collar, leftArm, rightArm);
	return { collar, leftArm, rightArm, torso };
}
