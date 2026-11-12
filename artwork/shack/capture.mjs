// Plays the first morning of shack in Chrome, then takes the island out of its
// sky: a picture of it with a clear background, written to
// src/assets/shack/island.webp. See README.md.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dev } from 'astro';
import { chromium } from '@playwright/test';

const OUT = fileURLToPath(new URL('../../src/assets/shack/island.webp', import.meta.url));
const PORT = 4393;
// The island, forecast and residents that the game's tests also start from.
const SEED = 17;

const server = await dev({
	root: fileURLToPath(new URL('../..', import.meta.url)),
	logLevel: 'warn',
	server: { port: PORT, host: '127.0.0.1' },
	vite: { server: { strictPort: true } },
});
const browser = await chromium.launch({ channel: 'chrome' });

try {
	const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 });
	await page.addInitScript((initial) => {
		let value = initial;
		Math.random = () => {
			value = (value * 1664525 + 1013904223) >>> 0;
			return value / 4294967296;
		};
		localStorage.setItem('shack:sound', 'off');
	}, SEED);
	await page.goto(`http://127.0.0.1:${PORT}/experiments/shack`);
	await page.locator('[data-shack-start]').click();
	await page.waitForFunction(() => window.shack?.residents.length === 2 && window.shack.residents.every((r) => r.state !== 'arriving'), null, { timeout: 60_000 });

	// The tin sheet across the two crates, as the first morning asks.
	const project = (point) => page.evaluate(([x, y, z]) => {
		const g = window.shack;
		const v = new window.shackTest.THREE.Vector3(x, y, z).project(g.camera);
		const rect = g.el.stage.getBoundingClientRect();
		return { x: rect.left + ((v.x + 1) * rect.width) / 2, y: rect.top + ((1 - v.y) * rect.height) / 2 };
	}, point);
	const sheet = await page.evaluate(() => {
		const p = window.shack.pieces.find((piece) => piece.kind.id === 'sheet').body.translation();
		return [p.x, p.y, p.z];
	});
	const from = await project(sheet);
	const to = await project([0, 0.85, -0.65]);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 20 });
	await page.mouse.up();
	await page.locator('[data-shack-goal-count]').filter({ hasText: '2 of 2' }).waitFor();
	// Let go of the roof, point at nothing, and wait for the roof to settle and
	// the camera to come to rest.
	await page.keyboard.press('Escape');
	await page.mouse.move(4, 4);
	await page.waitForTimeout(4000);

	const picture = await page.evaluate(() => {
		const g = window.shack;
		const ink = g.renderer;
		const canvas = ink.renderer.domElement;
		const look = ink.look;
		const sky = [look.skyTop.clone(), look.skyBottom.clone()];

		// Only the island and what is on it: not the first morning's guide, nor
		// the marks for where it is dry. The game shows them again next frame.
		g.guide.visible = false;
		for (const marker of g.markers) marker.visible = false;
		if (g.coverageMesh) g.coverageMesh.visible = false;
		g.placementFoot.visible = false;
		g.cursorRing.visible = false;
		// And only the clouds the island floats on: those under it, wholly in
		// view. The rest of the sky's clouds are scattered far off round it.
		const THREE = window.shackTest.THREE;
		const point = new THREE.Vector3();
		const shore = g.island.outline.map((p) => point.set(p.x, 0, p.y).project(g.camera).x);
		const [west, east] = [Math.min(...shore), Math.max(...shore)];
		for (const cloud of g.island.group.getObjectByName('clouds').children) {
			cloud.geometry.computeBoundingBox();
			const { min, max } = cloud.geometry.boundingBox;
			const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => new THREE.Vector3(
				index & 1 ? max.x : min.x,
				index & 2 ? max.y : min.y,
				index & 4 ? max.z : min.z,
			).applyMatrix4(cloud.matrixWorld).project(g.camera));
			const middle = corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length;
			cloud.visible = cloud.getWorldPosition(point).y < 0
				&& middle > west && middle < east
				&& corners.every((corner) => Math.abs(corner.x) < 0.98 && Math.abs(corner.y) < 0.98);
		}

		// The same frame twice, over a black sky and over a white one. Where the
		// two differ, the sky shows through.
		const frame = (value) => {
			look.skyTop.setRGB(value, value, value);
			look.skyBottom.setRGB(value, value, value);
			ink.render(g.scene, g.camera, g.clock);
			const copy = document.createElement('canvas');
			copy.width = canvas.width;
			copy.height = canvas.height;
			const context = copy.getContext('2d');
			context.drawImage(canvas, 0, 0);
			return context.getImageData(0, 0, copy.width, copy.height);
		};
		const black = frame(0);
		const white = frame(1);
		look.skyTop.copy(sky[0]);
		look.skyBottom.copy(sky[1]);

		// In linear light, over black a pixel is its colour times its cover, and
		// over white that plus the uncovered rest.
		const linear = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
		const encoded = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
		const { width, height } = black;
		const out = new ImageData(width, height);
		let left = width, right = -1, top = height, bottom = -1;
		for (let i = 0; i < black.data.length; i += 4) {
			let shown = 0;
			for (let c = 0; c < 3; c++) shown += linear(white.data[i + c]) - linear(black.data[i + c]);
			const alpha = Math.min(1, Math.max(0, 1 - shown / 3));
			// The paper grain over the sky leaves a faint speckle; it is not the island.
			if (alpha < 0.1) continue;
			for (let c = 0; c < 3; c++) out.data[i + c] = encoded(Math.min(1, linear(black.data[i + c]) / alpha));
			out.data[i + 3] = Math.round(alpha * 255);
			const x = (i / 4) % width, y = Math.floor(i / 4 / width);
			left = Math.min(left, x); right = Math.max(right, x);
			top = Math.min(top, y); bottom = Math.max(bottom, y);
		}

		const crop = document.createElement('canvas');
		crop.width = right - left + 1;
		crop.height = bottom - top + 1;
		crop.getContext('2d').putImageData(out, -left, -top);
		return crop.toDataURL('image/webp', 0.92);
	});

	await mkdir(dirname(OUT), { recursive: true });
	await writeFile(OUT, Buffer.from(picture.split(',')[1], 'base64'));
	console.log(`wrote ${OUT}`);
} finally {
	await browser.close();
	await server.stop();
}
