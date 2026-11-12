// Renders the Blonky GIFs, with and without the ribbon: bundles frame.ts,
// draws every frame of the loop in headless Chromium, then encodes them with
// ffmpeg. See README.md.
//
//   node artwork/blonky-ribbon/render.mjs                                    both GIFs
//   node artwork/blonky-ribbon/render.mjs still.png [frame] [width] [--no-ribbon]   one frame, to check a change
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 600;
const VERSIONS = [
	{ file: 'blonky-ribbon.gif', ribbon: true },
	{ file: 'blonky-no-ribbon.gif', ribbon: false },
];

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((arg) => arg !== '--no-ribbon');
const stillPath = args[0];
const stillRibbon = !process.argv.includes('--no-ribbon');
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
	const draw = (frame, width, ribbon) => page.evaluate(({ frame, width, ribbon }) => {
		const canvas = document.querySelector('canvas');
		window.blonky.drawFrame(canvas, frame, width, ribbon);
		return canvas.toDataURL('image/png');
	}, { frame, width, ribbon }).then((png) => Buffer.from(png.split(',')[1], 'base64'));

	if (stillPath) {
		const frame = Number(args[1] ?? 0);
		writeFileSync(stillPath, await draw(frame, Number(args[2] ?? WIDTH), stillRibbon));
		console.log(`frame ${frame} -> ${stillPath}`);
	} else {
		const { count, fps } = await page.evaluate(() => ({ count: window.blonky.FRAMES, fps: window.blonky.FPS }));
		for (const { file, ribbon } of VERSIONS) {
			for (let frame = 0; frame < count; frame++) {
				writeFileSync(join(frames, `${String(frame).padStart(3, '0')}.png`), await draw(frame, WIDTH, ribbon));
			}

			// One palette for the whole loop, so colours don't flicker between frames.
			// GIF transparency is all or nothing: pixels at least 3/8 opaque are kept.
			const output = join(here, file);
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
	}
} finally {
	await browser.close();
	rmSync(frames, { recursive: true, force: true });
}
