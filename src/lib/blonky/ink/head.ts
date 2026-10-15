import {
	headGeometry,
	tearGeometry,
	TEAR_BEAD_RADIUS,
	TEAR_FRONT_RADIUS,
	winkLid,
	type Pose,
	type Pt,
} from '../geometry';
import { EYE_WHITE, SKIN, TEAR_WASH, WASH } from './palette';
import { fill, inkFrame, polygonPath, stroke, TAU } from './pen';

export function drawHead(ctx: CanvasRenderingContext2D, pose: Pose, outlineInk: string): void {
	const head = headGeometry(pose);
	ctx.save();
	ctx.translate(head.pivot.x, head.pivot.y);
	ctx.rotate(head.angle);
	ctx.translate(head.offset.x, head.offset.y);
	ctx.scale(head.scale.x, head.scale.y);

	fill(ctx, head.skull, SKIN, 1);
	fill(ctx, head.skull, WASH, 0.11);
	stroke(ctx, head.outerHead, 611, { width: 1.82, boil: 0.46, color: outlineInk });
	for (const hair of head.hairs) {
		stroke(ctx, hair.points, hair.id, {
			width: 0.72,
			passes: 1,
			boil: 0.35,
			color: outlineInk,
		});
	}

	ctx.save();
	ctx.translate(head.face.x, head.face.y);
	const {
		leftEye,
		leftEyeCenter,
		leftEyeClosed,
		rightEye,
		rightEyeCenter,
		rightEyeClosed,
	} = head;
	if (!leftEyeClosed) fill(ctx, leftEye, EYE_WHITE, 1);
	if (!rightEyeClosed) fill(ctx, rightEye, EYE_WHITE, 1);
	const tears = tearGeometry(pose, head, inkFrame());
	for (const well of tears.wells) {
		ctx.save();
		polygonPath(ctx, well.eye);
		ctx.clip();
		ctx.fillStyle = TEAR_WASH;
		ctx.globalAlpha = well.amount * 0.5;
		ctx.beginPath();
		ctx.moveTo(well.outerX, well.bottom + 1);
		ctx.lineTo(well.outerX, well.waterline[0].y);
		ctx.quadraticCurveTo(well.waterline[1].x, well.waterline[1].y, well.waterline[2].x, well.waterline[2].y);
		ctx.lineTo(well.innerX + well.innerSide, well.bottom + 1);
		ctx.closePath();
		ctx.fill();
		ctx.globalAlpha = well.amount * 0.58;
		ctx.beginPath();
		ctx.arc(well.bead.x, well.bead.y, TEAR_BEAD_RADIUS, 0, TAU);
		ctx.fill();
		ctx.restore();
	}
	const drawWinkLid = (center: Pt, radius: number, side: -1 | 1, id: number): void => {
		// One open stroke: tracing both edges of a collapsed eye makes an ink
		// wedge. Keep the lid light enough to match the rest of the face.
		const { lid, tick } = winkLid(center, radius, side);
		stroke(ctx, lid, id, { width: 1.7, passes: 1, alpha: 0.94, wobble: 0.35 });
		stroke(ctx, tick, id + 30, {
			width: 0.9, passes: 1, alpha: 0.65, wobble: 0.25,
		});
	};
	if (leftEyeClosed && pose.leftWink > 0) drawWinkLid(leftEyeCenter, 12, -1, 630);
	else stroke(ctx, leftEye, 630, {
		closed: true,
		seamlessClosed: !leftEyeClosed,
		width: 1.95,
		passes: 2,
		boil: 0.34,
		fillRule: leftEyeClosed ? 'nonzero' : 'evenodd',
		roundedClosedStroke: pose.cryElapsed !== undefined && !leftEyeClosed,
	});
	if (rightEyeClosed && pose.rightWink > 0) drawWinkLid(rightEyeCenter, 10, 1, 631);
	else stroke(ctx, rightEye, 631, {
		closed: true,
		seamlessClosed: !rightEyeClosed,
		width: 1.86,
		passes: 2,
		boil: 0.34,
		fillRule: rightEyeClosed ? 'nonzero' : 'evenodd',
		roundedClosedStroke: pose.cryElapsed !== undefined && !rightEyeClosed,
	});
	for (const track of tears.tracks) {
		fill(ctx, track.mark, TEAR_WASH, 0.56);
		ctx.save();
		ctx.fillStyle = TEAR_WASH;
		ctx.globalAlpha = 0.52;
		ctx.beginPath();
		ctx.arc(track.front.x, track.front.y, TEAR_FRONT_RADIUS, 0, TAU);
		ctx.fill();
		ctx.restore();
	}
	stroke(ctx, head.leftUnderEye, 632, { width: 1.12, alpha: 0.82 * (1 - pose.leftWink * 0.15), passes: 1, boil: 0.28 });
	stroke(ctx, head.rightUnderEye, 633, { width: 1.02, alpha: 0.76 * (1 - pose.rightWink * 0.15), passes: 1, boil: 0.28 });
	stroke(ctx, head.leftBrow, 634, { width: 1.55, boil: 0.36 });
	stroke(ctx, head.rightBrow, 635, { width: 1.38, boil: 0.36 });
	stroke(ctx, head.nose, 636, { width: 1.7, boil: 0.4 });
	const mouthSmile = pose.mouthSmile;
	stroke(ctx, head.mouth, 637, { width: 1.62, boil: 0.36, wobble: 1 - mouthSmile * 0.35 });
	stroke(ctx, head.lowerLip, 638, { width: 1.08, alpha: 0.7 * (1 - mouthSmile * 0.35), passes: 1 });
	stroke(ctx, head.chin, 639, { width: 1.5, alpha: 0.7, boil: 0.34 });
	stroke(ctx, head.lowerChin, 640, { width: 1.12, alpha: 0.54, passes: 1, boil: 0.3 });
	ctx.restore();

	ctx.restore();
}
