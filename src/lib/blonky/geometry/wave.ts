import { smoothstep } from '../motion';
import { BLONKY_BUST_HEIGHT } from '../types';
import { restingSkinContours, type ArmGeometry } from './arms';
import type { Pose } from './pose';
import { lerp, quadratic, rotateAbout, type Pt } from './points';
import { drawnWaveForearm, drawnWaveHand } from './wave-drawings';

const H = BLONKY_BUST_HEIGHT;

const WAVE_FOREARM_LENGTH = 190;
// Keep the wrist independent of torso breathing and gesture blending.
const WAVE_WRIST_RADIUS = 72;
const WAVE_BEND = 2;

export interface WaveArm {
	restArm: ArmGeometry;
	shoulder: Pt;
	shoulderAngle: number;
	lift: number;
	swing: number;
	fingers: number;
}

export function waveShoulderPoint(point: Pt, shoulder: Pt, angle: number, lift: number): Pt {
	const rotated = rotateAbout(point, shoulder, angle);
	return { x: rotated.x, y: shoulder.y + (rotated.y - shoulder.y) * Math.cos(smoothstep((lift - 0.2) / 0.8) * 0.85) };
}

export function wavingArmGeometry(arm: ArmGeometry, pose: Pose): ArmGeometry {
	const lift = arm.side < 0 ? pose.leftWave : pose.rightWave;
	if (lift <= 0) return arm;
	const shoulderY = arm.side < 0 ? pose.leftShoulderY : pose.rightShoulderY;
	const shoulder = { x: arm.chain[0].x, y: shoulderY + 150 };
	// A low greeting: the sleeve barely moves, and the elbow stays tucked in.
	const shoulderAngle = arm.side * 0.13 * lift;
	const rotate = (point: Pt): Pt => waveShoulderPoint(point, shoulder, shoulderAngle, lift);
	const cuffY = Math.min(...arm.cuffUpper.map((point) => point.y));
	const sleevePoint = (point: Pt): Pt => lerp(
		point,
		rotate(point),
		smoothstep((point.y - shoulderY - 205) / (cuffY - shoulderY - 205)),
	);
	return {
		...arm,
		wave: {
			restArm: arm,
			shoulder,
			shoulderAngle,
			lift,
			swing: arm.side < 0 ? pose.leftWaveSwing : pose.rightWaveSwing,
			fingers: arm.side < 0 ? pose.leftWaveFingers : pose.rightWaveFingers,
		},
		cuffLower: arm.cuffLower.map(rotate) as [Pt, Pt],
		cuffUpper: arm.cuffUpper.map(rotate) as [Pt, Pt],
		innerContour: arm.innerContour.map(sleevePoint),
		sleeveOuter: arm.sleeveOuter.map(sleevePoint),
		sleeveSurface: arm.sleeveSurface.map(sleevePoint),
	};
}

export interface WaveGeometry {
	upperOuter: Pt[];
	upperInnerOutline: Pt[];
	forearmFold: Pt[];
	palmCrease: Pt[];
	wristCrease: Pt[];
	forearm: Pt[];
	hand: Pt[];
	upperSkin: Pt[];
}

export function waveForearmGeometry(arm: ArmGeometry): WaveGeometry {
	const { lift, swing, fingers, restArm, shoulder, shoulderAngle } = arm.wave!;
	const skin = restingSkinContours(restArm);
	const atY = (points: Pt[], y: number): Pt => {
		const index = points.findIndex((point) => point.y >= y);
		if (index <= 0) return points[index === 0 ? 0 : points.length - 1];
		return lerp(points[index - 1], points[index], (y - points[index - 1].y) / (points[index].y - points[index - 1].y));
	};
	// The original bust crops the resting elbow; bend below that crop first.
	const elbowY = H + 20;
	const inner = atY(skin.inner, elbowY);
	const outer = atY(skin.outer, elbowY);
	const restElbow = { x: (inner.x + outer.x) / 2, y: elbowY };
	const elbow = waveShoulderPoint(restElbow, shoulder, shoulderAngle, lift);
	const radius = Math.abs(outer.x - inner.x) / 2;
	const wristRadius = WAVE_WRIST_RADIUS;
	const flex = Math.sin(Math.PI * 0.5 * lift);
	const theta = WAVE_BEND * flex;
	// Keep the elbow-to-wrist axis aimed mostly toward the viewer.
	// Finger opening must not sweep the whole forearm across the torso.
	const lean = -0.18;
	const forward = { x: arm.side * lean * Math.sin(theta), y: Math.cos(theta) };
	const wrist = { x: elbow.x + forward.x * WAVE_FOREARM_LENGTH, y: elbow.y + forward.y * WAVE_FOREARM_LENGTH };
	// Hand poses are drawn in camera space; only the greeting rotates them.
	const handPoint = (point: Pt): Pt => {
		const local = rotateAbout(point, { x: 0, y: 0 }, swing * 0.095);
		return { x: wrist.x + arm.side * local.x, y: wrist.y + local.y };
	};
	const handCorners = drawnWaveHand(lift, fingers).map(handPoint);
	const shape = handCorners.flatMap((point, index): Pt[] => {
		if (index === 0 || index === handCorners.length - 1) return [point];
		const before = handCorners[index - 1];
		const after = handCorners[index + 1];
		const radius = [4, 5, 6, 7, 13, 14, 15, 16, 23, 24, 25, 26, 33, 34, 35].includes(index) ? 4 : 2;
		return quadratic(lerp(point, before, Math.min(0.3, radius / Math.hypot(point.x - before.x, point.y - before.y))), point, lerp(point, after, Math.min(0.3, radius / Math.hypot(point.x - after.x, point.y - after.y))), 3);
	});
	const projectUpper = (point: Pt): Pt => waveShoulderPoint(point, shoulder, shoulderAngle, lift);
	const cap = (points: Pt[], sign: number): Pt[] => {
		const last = points.at(-1)!;
		points = points.concat(Array.from({ length: 13 }, (_, index) => ({ x: last.x, y: restElbow.y + radius * index / 12 })).filter((point) => point.y > last.y));
		const end = points.at(-1)!;
		const sampled = points.length > 10 ? points : points.flatMap((point, index) => {
			if (index === points.length - 1) return [point];
			return Array.from({ length: 10 }, (_, step) => lerp(point, points[index + 1], step / 10));
		});
		return sampled.map((point) => {
			if (point.y <= restElbow.y) return projectUpper(point);
			const t = (point.y - restElbow.y) / (end.y - restElbow.y);
			const rounded = { x: restElbow.x + sign * radius * Math.cos(t * Math.PI / 2), y: restElbow.y + radius * Math.sin(t * Math.PI / 2) };
			return projectUpper(lerp(point, rounded, smoothstep(lift)));
		});
	};
	const upperOuter = cap(skin.outer, arm.side);
	const upperInner = cap(skin.inner, -arm.side);
	const hand = shape;

	const drawnForearm = drawnWaveForearm(lift);
	const place = (p: Pt): Pt => ({ x: elbow.x + arm.side * p.x * radius / 100, y: elbow.y + p.y * radius / 100 });
	const forearm = drawnForearm.outline.map(place);
	forearm[0] = handPoint({ x: -wristRadius, y: 0 });
	forearm[forearm.length - 1] = handPoint({ x: wristRadius, y: 0 });
	const forearmFold = quadratic(handPoint({ x: wristRadius, y: 0 }), place(drawnForearm.fold[1]), place(drawnForearm.fold.at(-1)!), 14);
	return {
		// The fold is exposed once the forearm bends back over the upper arm.
		forearmFold: forward.y < 0 ? forearmFold : [],
		forearm,
		hand,
		wristCrease: [{ x: -29, y: -6 }, { x: -11, y: -2 }, { x: 5, y: -2 }, { x: 26, y: -6 }].map(handPoint),
		palmCrease: quadratic({ x: -40, y: -48 }, { x: -23, y: -36 }, { x: -29, y: -20 }, 9).map((point) => handPoint({ x: point.x * wristRadius / 65, y: point.y })),
		upperSkin: upperOuter.concat(upperInner.slice().reverse()),
		upperOuter, upperInnerOutline: cap(skin.inner.slice(1), -arm.side),
	};
}
