import {
	bellyFolds,
	bodyGeometry,
	cuffZigzag,
	restingSkinContours,
	rotateAbout,
	waveForearmGeometry,
	type ArmGeometry,
	type Pose,
	type Pt,
	type TorsoGeometry,
} from '../geometry';
import { BLONKY_BUST_HEIGHT, type BlonkyPalette } from '../types';
import { SKIN, WASH } from './palette';
import { clipOutside, fill, hatch, stipple, stroke } from './pen';

const H = BLONKY_BUST_HEIGHT;

function drawSkinOutline(ctx: CanvasRenderingContext2D, arm: ArmGeometry, skin: { outer: Pt[]; inner: Pt[] }, outlineInk: string): void {
	stroke(ctx, skin.outer, arm.limbId, { width: 2.2, boil: 0.42, color: outlineInk });
	stroke(ctx, skin.inner.slice(1), arm.skinInnerBoundaryId, { width: 3.45, boil: 0.46, color: outlineInk });
}

function drawLimb(ctx: CanvasRenderingContext2D, arm: ArmGeometry, outlineInk: string): Pt[] {
	const skin = restingSkinContours(arm);
	const polygon = skin.outer.concat(skin.inner.slice().reverse());
	fill(ctx, polygon, SKIN, 1);
	fill(ctx, polygon, WASH, 0.12);
	drawSkinOutline(ctx, arm, skin, outlineInk);
	return polygon;
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
	stroke(ctx, cuffZigzag(upperStart, upperEnd, lowerStart, lowerEnd), id + 2, { width: 1.4, alpha: 0.76, passes: 1, boil: 0.32, color });
}

// Above the bust edge, the whole canvas is available to the moving hand.
// Portraits also expose the source arm's uneven lower edge: preserve that
// silhouette there without extending its diagonal crop through the scene.
function clipWaveToBust(ctx: CanvasRenderingContext2D, arm: ArmGeometry): void {
	const { restArm, shoulder, shoulderAngle } = arm.wave!;
	const skin = restingSkinContours(restArm);
	const lowerSilhouette = skin.outer.concat(skin.inner.slice().reverse())
		.map((point) => rotateAbout(point, shoulder, shoulderAngle));
	// Match the rectangle's winding so their overlapping regions form a union.
	const area = lowerSilhouette.reduce((sum, point, index) => {
		const next = lowerSilhouette[(index + 1) % lowerSilhouette.length];
		return sum + point.x * next.y - next.x * point.y;
	}, 0);
	if (area < 0) lowerSilhouette.reverse();
	ctx.beginPath();
	// Match the torso's authored bottom, including its 18-unit bleed.
	ctx.rect(-2000, -2000, 5000, H + 18 + 2000);
	ctx.moveTo(lowerSilhouette[0].x, lowerSilhouette[0].y);
	for (const point of lowerSilhouette.slice(1)) ctx.lineTo(point.x, point.y);
	ctx.closePath();
	ctx.clip();
}

function drawWaveUpperSkin(ctx: CanvasRenderingContext2D, arm: ArmGeometry, palette: BlonkyPalette): Pt[] {
	const geometry = waveForearmGeometry(arm);
	ctx.save();
	clipWaveToBust(ctx, arm);
	fill(ctx, geometry.upperSkin, SKIN, 1);
	fill(ctx, geometry.upperSkin, WASH, 0.12);
	ctx.save();
	clipOutside(ctx, geometry.forearm);
	clipOutside(ctx, geometry.hand);
	stroke(ctx, geometry.upperOuter, arm.limbId, { width: 2.2, boil: 0.42, color: palette.outlineInk });
	stroke(ctx, geometry.upperInnerOutline, arm.skinInnerBoundaryId, { width: 3.45, boil: 0.46, color: palette.outlineInk });
	ctx.restore();
	ctx.restore();
	return geometry.upperSkin;
}

function drawWavingForearm(ctx: CanvasRenderingContext2D, arm: ArmGeometry, palette: BlonkyPalette, upperSkin?: Pt[]): void {
	if (!arm.wave || !upperSkin) return;
	const { forearm, hand, palmCrease, forearmFold, wristCrease } = waveForearmGeometry(arm);
	ctx.save();
	clipWaveToBust(ctx, arm);
	// One skin silhouette avoids seams or double wash at the wrist.
	const silhouette = hand.concat(forearm.slice(1, -1).reverse());
	fill(ctx, silhouette, SKIN, 1);
	fill(ctx, silhouette, WASH, 0.12);
	ctx.save();
	for (const part of [upperSkin, hand]) clipOutside(ctx, part);
	stroke(ctx, forearm.slice(1), 795 + arm.side, { width: 3.1, passes: 1, roundedStroke: true, wobble: 0.48, color: palette.outlineInk });
	ctx.restore();
	// Carry the outside of the palm into the elbow fold. The forearm
	// sits in front of the upper arm even where their skin fills overlap.
	stroke(ctx, [forearm[1], ...hand, ...forearmFold.slice(1)], 819 + arm.side, { width: 3.1, passes: 1, roundedStroke: true, wobble: 0.48, color: palette.outlineInk });
	stroke(ctx, wristCrease, 853 + arm.side, { width: 1.5, alpha: 0.4, passes: 1, wobble: 0.32, color: palette.outlineInk });
	stroke(ctx, palmCrease, 840 + arm.side, { width: 1.5, alpha: arm.wave.fingers * 0.4, passes: 1, wobble: 0.25, color: palette.outlineInk });
	ctx.restore();
}

function drawShirtSurface(
	ctx: CanvasRenderingContext2D,
	surface: Pt[],
	palette: BlonkyPalette,
	textureId: number,
	textureCount: number,
): void {
	fill(ctx, surface, palette.shirt, 1);
	stipple(
		ctx,
		surface,
		textureId,
		textureCount,
		palette.shirtTextureInk,
		palette.shirtTextureAlpha,
	);
	hatch(ctx, surface, textureId + 1, {
		spacing: 38,
		angle: -0.78,
		alpha: 0.045,
		width: 0.68,
		color: palette.shirtTextureInk,
	});
}

function drawTorso(
	ctx: CanvasRenderingContext2D,
	pose: Pose,
	geometry: TorsoGeometry,
	palette: BlonkyPalette,
	drawOutline = true,
): void {
	const { collar } = geometry;
	fill(ctx, collar.chestSkin, SKIN, 1);
	fill(ctx, collar.chestSkin, WASH, 0.11);
	drawShirtSurface(ctx, geometry.surface, palette, 750, 1320);
	if (drawOutline) {
		stroke(ctx, geometry.outline, 754, {
			width: 3.45,
			boil: 0.46,
			color: palette.outlineInk,
		});
	}
	stroke(ctx, collar.edge, 753, {
		width: 3.25,
		alpha: 0.95,
		boil: 0.46,
		color: palette.outlineInk,
	});
	stroke(ctx, collar.seam, 764, {
		width: 2.65,
		alpha: 0.9,
		boil: 0.42,
		color: palette.outlineInk,
	});

	const [upperFold, lowerFold] = bellyFolds(pose);
	stroke(ctx, upperFold, 762, { width: 1.55, alpha: 0.5, boil: 0.24, color: palette.outlineInk });
	stroke(ctx, lowerFold, 763, { width: 1.9, alpha: 0.6, boil: 0.26, color: palette.outlineInk });
}

function drawArm(
	ctx: CanvasRenderingContext2D,
	arm: ArmGeometry,
	palette: BlonkyPalette,
	textureId: number,
	drawOuterOutline = true,
): Pt[] {
	const skin = arm.wave
		? drawWaveUpperSkin(ctx, arm, palette)
		: drawLimb(ctx, arm, palette.outlineInk);

	drawShirtSurface(ctx, arm.sleeveSurface, palette, textureId, 360);
	if (drawOuterOutline) {
		stroke(ctx, arm.sleeveOuter, arm.outlineId, {
			width: 3.45,
			boil: 0.46,
			color: palette.outlineInk,
		});
	}
	drawCuffBand(
		ctx,
		arm.cuffUpper[0],
		arm.cuffUpper[1],
		arm.cuffLower[0],
		arm.cuffLower[1],
		arm.cuffId,
		palette.outlineInk,
	);
	stroke(ctx, arm.innerContour, arm.outlineId + 15, {
		width: 2.85,
		boil: 0.42,
		color: palette.outlineInk,
	});
	return skin;
}

export function drawUpperBody(
	ctx: CanvasRenderingContext2D,
	pose: Pose,
	palette: BlonkyPalette,
	showArms: boolean,
	showBody: boolean,
): () => void {
	const { collar, leftArm, rightArm, torso } = bodyGeometry(pose);
	// These are literal component layers: combined rendering executes the exact
	// same torso and arm draw calls as the standalone views, in a fixed order.
	if (showBody) drawTorso(ctx, pose, torso, palette, !showArms);
	let leftSkin: Pt[] | undefined;
	let rightSkin: Pt[] | undefined;
	if (showArms) {
		leftSkin = drawArm(ctx, leftArm, palette, 770, !showBody);
		rightSkin = drawArm(ctx, rightArm, palette, 780, !showBody);
	}
	if (showBody && showArms) {
		stroke(ctx, [collar.leftContact, ...leftArm.sleeveOuter], leftArm.outlineId, {
			width: 3.45,
			boil: 0.46,
			color: palette.outlineInk,
		});
		stroke(ctx, [...rightArm.sleeveOuter, collar.rightContact], rightArm.outlineId, {
			width: 3.45,
			boil: 0.46,
			color: palette.outlineInk,
		});
	}
	return () => {
		if (!showArms) return;
		drawWavingForearm(ctx, leftArm, palette, leftSkin);
		drawWavingForearm(ctx, rightArm, palette, rightSkin);
	};
}
