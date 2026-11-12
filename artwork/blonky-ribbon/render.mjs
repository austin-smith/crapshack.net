// Renders the Blonky ribbon GIF: bundles frame.ts, draws every frame of the
// loop in headless Chromium, then encodes them with ffmpeg. See README.md.
//
//   node artwork/blonky-ribbon/render.mjs [output.gif]
//   node artwork/blonky-ribbon/render.mjs still.png [frame] [width]   one frame, to check a change
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const output = process.argv[2] ?? join(here, 'blonky-ribbon.gif');
const still = output.endsWith('.png');
const WIDTH = still && process.argv[4] ? Number(process.argv[4]) : 600;
// esbuild and Playwright live outside the repo, so the site's build never needs them.
const tools = process.env.BLONKY_RIBBON_TOOLS ?? join(homedir(), '.cache', 'blonky-ribbon');
const require = createRequire(join(tools, 'package.json'));
const esbuild = require('esbuild');
const { chromium } = require('playwright');

const bundle = esbuild.buildSync({
	entryPoints: [join(here, 'frame.ts')],
	bundle: true,
	format: 'iife',
	globalName: 'blonky',
	write: false,
}).outputFiles[0].text;

const frames = mkdtempSync(join(tmpdir(), 'blonky-ribbon-'));
const browser = await chromium.launch({ executablePath: process.env.BLONKY_RIBBON_CHROMIUM });
try {
	const page = await browser.newPage();
	await page.setContent('<canvas></canvas>');
	await page.addScriptTag({ content: bundle });
	const draw = (frame) => page.evaluate(({ frame, width }) => {
		const canvas = document.querySelector('canvas');
		window.blonky.drawFrame(canvas, frame, width);
		return canvas.toDataURL('image/png');
	}, { frame, width: WIDTH }).then((png) => Buffer.from(png.split(',')[1], 'base64'));

	if (still) {
		const frame = Number(process.argv[3] ?? 0);
		writeFileSync(output, await draw(frame));
		console.log(`frame ${frame} -> ${output}`);
	} else {
		const { count, fps } = await page.evaluate(() => ({ count: window.blonky.FRAMES, fps: window.blonky.FPS }));
		for (let frame = 0; frame < count; frame++) {
			writeFileSync(join(frames, `${String(frame).padStart(3, '0')}.png`), await draw(frame));
		}

		// One palette for the whole loop, so colours don't flicker between frames.
		// GIF transparency is all or nothing: pixels at least 3/8 opaque are kept.
		execFileSync('ffmpeg', [
			'-loglevel', 'error', '-y',
			'-framerate', String(fps),
			'-i', join(frames, '%03d.png'),
			'-vf', 'split[a][b];[a]palettegen=max_colors=255:stats_mode=full:reserve_transparent=1[p];[b][p]paletteuse=dither=sierra2_4a:alpha_threshold=96',
			'-loop', '0',
			output,
		], { stdio: 'inherit' });
		console.log(`${count} frames -> ${output}`);
	}
} finally {
	await browser.close();
	rmSync(frames, { recursive: true, force: true });
}
