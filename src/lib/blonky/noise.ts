export function hash(seed: number, a: number, b = 0): number {
	let n = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(a, 0xc2b2ae35) + Math.imul(b, 0x27d4eb2f);
	n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
	return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

export function valueNoise(x: number, y: number, seed: number): number {
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
