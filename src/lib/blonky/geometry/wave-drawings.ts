/** Camera-space hand drawings. The same 44 landmarks follow the same digits
 * through the lift; they are never independently scaled or projected. */
type Point = { x: number; y: number };
type Pair = readonly [number, number];

// Palm heel, thumb, index, middle, outside finger, outside heel.
// The carry pose has gathered fingers seen at an oblique angle.
const carry: readonly Pair[] = [
	[-72, 0], [-73, -17],
	[-84, -27], [-99, -43], [-110, -58], [-113, -71], [-107, -82], [-96, -84], [-84, -70], [-75, -48],
	[-68, -53], [-75, -78], [-86, -113], [-88, -130], [-82, -142], [-71, -145], [-59, -137], [-53, -124], [-41, -91], [-33, -77],
	[-25, -82], [-24, -117], [-21, -139], [-15, -152], [-4, -156], [8, -150], [15, -138], [15, -117], [17, -88], [24, -77],
	[33, -82], [39, -105], [48, -125], [60, -136], [73, -132], [80, -120], [77, -104], [73, -86], [76, -71], [80, -55], [79, -38], [76, -24], [72, -10], [72, 0],
];
// Mid-lift: palm turning toward us, fingers still gathered. Thumb and
// outside heel retain their thickness while the visible lengths change.
const turning: readonly Pair[] = [
	[-72, 0], [-73, -22],
	[-86, -31], [-109, -41], [-123, -52], [-125, -65], [-118, -78], [-105, -79], [-85, -64], [-73, -48],
	[-67, -52], [-72, -79], [-82, -110], [-83, -133], [-77, -147], [-65, -151], [-53, -143], [-48, -129], [-38, -91], [-29, -78],
	[-21, -84], [-20, -114], [-15, -144], [-9, -159], [2, -164], [15, -158], [21, -141], [20, -119], [18, -88], [25, -78],
	[34, -85], [45, -110], [57, -132], [69, -143], [82, -139], [88, -128], [84, -112], [76, -92], [77, -77], [81, -63], [82, -47], [78, -32], [73, -15], [72, 0],
];
// Raised but gathered: the arm has reached the greeting position.
const gathered: readonly Pair[] = [
	[-72, 0], [-74, -23],
	[-89, -32], [-113, -45], [-126, -57], [-128, -70], [-120, -84], [-107, -86], [-86, -69], [-72, -50],
	[-66, -55], [-73, -85], [-83, -120], [-84, -148], [-78, -164], [-66, -169], [-54, -160], [-49, -145], [-37, -101], [-28, -86],
	[-20, -92], [-20, -127], [-14, -160], [-8, -176], [3, -181], [16, -174], [22, -157], [20, -130], [18, -97], [25, -87],
	[34, -94], [46, -122], [58, -146], [70, -158], [83, -154], [90, -142], [85, -125], [76, -103], [78, -86], [83, -70], [85, -52], [81, -35], [74, -16], [72, 0],
];
// Open greeting. Unequal lengths and slightly bent axes follow the
// reference drawings; opening moves the digits apart without thinning them.
const open: readonly Pair[] = [
	[-72, 0], [-74, -24],
	[-91, -32], [-119, -45], [-133, -57], [-136, -70], [-128, -85], [-114, -87], [-92, -72], [-72, -52],
	[-66, -57], [-74, -87], [-86, -124], [-89, -153], [-82, -169], [-70, -174], [-58, -166], [-52, -149], [-39, -108], [-29, -91],
	[-20, -98], [-19, -135], [-12, -166], [-5, -182], [7, -187], [20, -179], [25, -163], [22, -135], [19, -103], [26, -92],
	[36, -99], [51, -126], [68, -148], [82, -160], [95, -155], [101, -143], [94, -126], [83, -105], [79, -87], [85, -70], [87, -51], [82, -34], [75, -15], [72, 0],
];

function blend(a: readonly Pair[], b: readonly Pair[], t: number): Point[] {
	return a.map(([x, y], index) => ({
		x: x + (b[index][0] - x) * t,
		y: y + (b[index][1] - y) * t,
	}));
}

export function drawnWaveHand(lift: number, openness: number): Point[] {
	const carryToTurning = Math.max(0, Math.min(1, (lift - 0.3) / 0.42));
	const turningToRaised = Math.max(0, Math.min(1, (lift - 0.72) / 0.28));
	const base = lift < 0.72
		? blend(carry, turning, carryToTurning)
		: blend(turning, gathered, turningToRaised);
	const spread = Math.max(0, Math.min(1, openness));
	return base.map((point, index) => ({
		x: point.x + (open[index][0] - gathered[index][0]) * spread,
		y: point.y + (open[index][1] - gathered[index][1]) * spread,
	}));
}

// Forearm contour from the inside wrist, around the elbow, to the outside
// wrist. Coordinates are relative to the elbow, in a 100-unit half-width.
// These are pose drawings, not the convex hull of projected cylinders.
const forearms: readonly { at: number; outline: readonly Pair[]; fold: readonly Pair[] }[] = [
	{ at: 0, outline: [[-72, 190], [-82, 204], [-86, 223], [-81, 244], [-65, 262], [-38, 274], [-5, 278], [28, 272], [55, 258], [74, 236], [82, 214], [78, 201], [75, 194], [72, 190]], fold: [[72, 190], [74, 196], [77, 201], [78, 205]] },
	{ at: 0.4, outline: [[-102, 70], [-112, 100], [-112, 128], [-100, 153], [-78, 179], [-47, 193], [-12, 196], [23, 185], [53, 164], [76, 137], [86, 109], [76, 88], [60, 76], [42, 70]], fold: [[42, 70], [55, 85], [66, 102], [73, 121]] },
	{ at: 0.6, outline: [[-104, 0], [-119, 30], [-123, 60], [-110, 86], [-80, 108], [-51, 122], [-16, 127], [20, 122], [53, 106], [78, 82], [89, 55], [83, 28], [62, 8], [40, 0]], fold: [[40, 0], [52, 24], [59, 48], [53, 65]] },
	{ at: 0.8, outline: [[-104, -62], [-117, -30], [-126, 4], [-120, 37], [-91, 65], [-64, 83], [-26, 90], [14, 88], [52, 74], [77, 50], [83, 21], [69, -8], [52, -38], [40, -62]], fold: [[40, -62], [53, -26], [60, 6], [50, 31]] },
	{ at: 1, outline: [[-104, -79], [-115, -48], [-124, -14], [-121, 20], [-105, 49], [-73, 70], [-40, 80], [-3, 81], [33, 71], [61, 52], [72, 27], [68, -4], [53, -40], [40, -79]], fold: [[40, -79], [49, -44], [57, -9], [57, 19]] },
];
export function drawnWaveForearm(lift: number): { outline: Point[]; fold: Point[] } {
	const amount = Math.max(0, Math.min(1, lift));
	const index = Math.max(1, forearms.findIndex((pose) => pose.at >= amount));
	const before = forearms[index - 1];
	const after = forearms[index];
	const t = (amount - before.at) / (after.at - before.at);
	return {
		outline: blend(before.outline, after.outline, t),
		fold: blend(before.fold, after.fold, t),
	};
}
