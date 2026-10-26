import { test, expect } from '@playwright/test';

// The game is driven through the page like a player would, with Math.random
// seeded so each run gets the same island, forecast and residents.
async function start(page, seed = 17) {
	await page.addInitScript((initial) => {
		let value = initial;
		Math.random = () => {
			value = (value * 1664525 + 1013904223) >>> 0;
			return value / 4294967296;
		};
		localStorage.setItem('shack:sound', 'off');
	}, seed);
	await page.routeWebSocket('**', (socket) => socket.close());
	await page.goto('/shack');
	await page.locator('[data-shack-start]').click();
	await expect(page.locator('[data-shack-night]')).toBeEnabled();
	await page.waitForFunction(() => window.shack.residents.length === 2 && window.shack.residents.every((r) => r.state !== 'arriving'));
}

async function project(page, point) {
	return page.evaluate(([x, y, z]) => {
		const g = window.shack;
		const v = new window.shackTest.THREE.Vector3(x, y, z).project(g.camera);
		const rect = g.el.stage.getBoundingClientRect();
		return { x: rect.left + ((v.x + 1) * rect.width) / 2, y: rect.top + ((1 - v.y) * rect.height) / 2 };
	}, point);
}

// Pieces are live physics, so one put back may settle by a fraction of a millimetre.
function expectNear(actual, expected) {
	actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 3));
}

async function sheetPosition(page) {
	return page.evaluate(() => {
		const p = window.shack.pieces.find((piece) => piece.kind.id === 'sheet').body.translation();
		return [p.x, p.y, p.z];
	});
}

// Drags the tin sheet onto the two crates the first morning sets out.
async function buildRoof(page) {
	const original = await sheetPosition(page);
	const from = await project(page, original);
	// Aim at where the roof will sit, as a player would: the piece follows the pointer.
	const to = await project(page, [0, 0.85, -0.65]);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 20 });
	await page.mouse.up();
	await expect(page.locator('[data-shack-goal-count]')).toHaveText('2 of 2');
	return original;
}

for (const seed of [17, 93]) {
	test(`a roof dragged onto the crates keeps both residents dry through a real night (seed ${seed})`, async ({ page }, testInfo) => {
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await start(page, seed);
		await buildRoof(page);
		await expect(page.locator('[data-shack-tenants]')).toContainText('has a dry spot');
		await page.screenshot({ path: testInfo.outputPath('roof.png') });
		await page.locator('[data-shack-night]').click();
		await page.waitForFunction(() => window.shack.phase === 'storm', null, { timeout: 25_000 });
		await page.waitForTimeout(6000);
		await page.screenshot({ path: testInfo.outputPath('night.png') });
		await page.waitForFunction(() => window.shack.phase === 'report', null, { timeout: 60_000 });
		await expect(page.locator('[data-shack-report-title]')).toHaveText("everyone's dry.");
		expect(await page.evaluate(() => window.shack.lastNightResidents.map((r) => r.result))).toEqual(['dry', 'dry']);
		if (seed === 17) {
			await page.locator('[data-shack-report-next]').click();
			await expect(page.locator('[data-shack-day]')).toHaveText('day 2');
			await expect.poll(() => page.evaluate(() => window.shack.presentResidents().length)).toBe(3);
			await expect(page.locator('[data-shack-night]')).toBeEnabled();
			await expect(page.locator('[data-shack-forecast-headline]')).toHaveText('tonight: wind');
			await expect(page.locator('[data-shack-nails]')).toHaveText('4');
		}
		expect(errors).toEqual([]);
	});
}

test('undo, redo, nails, a carried piece put back, and turning in place keep the build intact', async ({ page }) => {
	await start(page);
	const original = await buildRoof(page);
	const roof = await sheetPosition(page);
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	expectNear(await sheetPosition(page), original);
	await page.getByRole('button', { name: 'Redo', exact: true }).click();
	expectNear(await sheetPosition(page), roof);

	// Nailing uses a nail, undo gives it back, and unnailing refunds it too.
	await page.locator('[data-shack-nail]').click();
	await expect(page.locator('[data-shack-nails]')).toHaveText('1');
	expect(await page.evaluate(() => window.shack.nailBatches.length)).toBe(1);
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(page.locator('[data-shack-nails]')).toHaveText('2');
	expect(await page.evaluate(() => window.shack.nailBatches.length)).toBe(0);
	await page.getByRole('button', { name: 'Redo', exact: true }).click();
	await page.locator('[data-shack-nail]').click();
	await expect(page.locator('[data-shack-nails]')).toHaveText('2');

	// A click picks it up and it stays in hand; right-click puts it back.
	const roofPoint = await project(page, roof);
	await page.mouse.click(roofPoint.x, roofPoint.y);
	expect(await page.evaluate(() => window.shack.held?.kind.id)).toBe('sheet');
	await page.mouse.move(roofPoint.x + 80, roofPoint.y + 40, { steps: 5 });
	await page.mouse.click(roofPoint.x + 80, roofPoint.y + 40, { button: 'right' });
	expect(await page.evaluate(() => window.shack.held)).toBe(null);
	expectNear(await sheetPosition(page), roof);
	await page.evaluate(() => window.shack.select(window.shack.pieces.find((p) => p.kind.id === 'sheet')));

	// Carried from the keyboard, nudged, then put back where it was.
	await page.locator('[data-shack-stage]').focus();
	await page.keyboard.press('Space');
	expect(await page.evaluate(() => window.shack.held?.kind.id)).toBe('sheet');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Escape');
	expectNear(await sheetPosition(page), roof);

	// A support turned in place keeps its height rather than climbing onto its roof.
	const crate = await page.evaluate(() => {
		const g = window.shack;
		const piece = g.pieces.find((p) => p.kind.id === 'crate');
		g.select(piece);
		return piece.body.translation();
	});
	const rotation = await page.evaluate(() => window.shack.selected.body.rotation().w);
	await page.locator('[data-shack-rotate]').click();
	expect(await page.evaluate(() => window.shack.selected.body.translation().y)).toBeCloseTo(crate.y, 4);
	expect(await page.evaluate(() => window.shack.selected.body.rotation().w)).not.toBe(rotation);

	const zoom = await page.evaluate(() => window.shack.zoomGoal);
	await page.mouse.move(700, 500);
	await page.mouse.wheel(0, -100);
	await expect.poll(() => page.evaluate(() => window.shack.zoomGoal)).toBeGreaterThan(zoom);
});

test('touch controls fit a small phone and the help pauses the game', async ({ browser }, testInfo) => {
	const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
	const page = await context.newPage();
	await start(page);
	const position = await sheetPosition(page);
	const point = await project(page, position);
	// A tap picks it up; the buttons turn it, set it down or put it back.
	await page.touchscreen.tap(point.x, point.y);
	await expect(page.locator('[data-shack-object-name]')).toHaveText('tin sheet');
	for (const selector of ['rotate', 'flip', 'place', 'close']) {
		await expect(page.locator(`[data-shack-${selector}]`)).toBeInViewport();
	}
	const editor = await page.locator('[data-shack-editor]').boundingBox();
	expect(point.y).toBeLessThan(editor.y);
	await page.screenshot({ path: testInfo.outputPath('phone.png') });
	await page.getByRole('button', { name: 'Put it back' }).tap();
	await expect(page.locator('[data-shack-editor]')).toBeHidden();
	expectNear(await sheetPosition(page), position);
	await expect(page.locator('[data-shack-night]')).toBeInViewport();
	await page.getByRole('button', { name: 'How to play' }).tap();
	const clock = await page.evaluate(() => window.shack.clock);
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => window.shack.clock)).toBe(clock);
	await page.getByRole('button', { name: 'Close', exact: true }).tap();
	await expect(page.locator('[data-shack-help]')).not.toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await context.close();
});

test('a night with no roof says why, and the game carries on', async ({ page }) => {
	await start(page, 45);
	await page.locator('[data-shack-night]').click();
	await expect(page.locator('[data-shack-night]')).toHaveText('go anyway');
	expect(await page.evaluate(() => window.shack.phase)).toBe('build');
	await page.locator('[data-shack-night]').click();
	await page.waitForFunction(() => window.shack.phase === 'report', null, { timeout: 60_000 });
	await expect(page.locator('[data-shack-report-title]')).toHaveText("nobody's dry.");
	await expect(page.locator('[data-shack-report-list]')).toContainText('no roof');
	await page.locator('[data-shack-report-next]').click();
	await expect(page.locator('[data-shack-day]')).toHaveText('day 2');
});

test('pull a support out while building and the roof comes down', async ({ page }) => {
	await start(page);
	await buildRoof(page);
	const before = (await sheetPosition(page))[1];
	const crate = await page.evaluate(() => {
		const crates = window.shack.pieces.filter((p) => p.kind.id === 'crate').sort((a, b) => a.body.translation().x - b.body.translation().x);
		const t = crates[1].body.translation();
		return [t.x, t.y, t.z];
	});
	const from = await project(page, crate);
	const to = await project(page, [2.5, 0.4, 1.5]);
	await page.mouse.click(from.x, from.y);
	await page.mouse.move(to.x, to.y, { steps: 10 });
	await page.mouse.click(to.x, to.y);
	await expect.poll(async () => (await sheetPosition(page))[1], { timeout: 5000 }).toBeLessThan(before - 0.2);
});

test('a panel carried up to a standing door stands beside it, not on top', async ({ page }) => {
	await start(page);
	// The door stood on its end in open ground, whichever way up that is.
	await page.evaluate(() => {
		const g = window.shack;
		g.pickUp(g.pieces.find((p) => p.kind.id === 'door'), 'pointer');
		const heights = [0, 1, 2].map((pose) => {
			g.held.pose = pose;
			return g.dropShape(g.held.kind, 1.5, 1.5, g.heldRotation(g.held)).position.y;
		});
		g.held.pose = heights.indexOf(Math.max(...heights));
		g.placement = g.dropShape(g.held.kind, 1.5, 1.5, g.heldRotation(g.held));
		g.placeHeld();
	});
	await page.waitForTimeout(1000);
	const door = await page.evaluate(() => {
		const t = window.shack.pieces.find((p) => p.kind.id === 'door').body.translation();
		return [t.x, t.y, t.z];
	});
	expect(door[1]).toBeGreaterThan(0.8);
	const pallet = await page.evaluate(() => {
		const t = window.shack.pieces.find((p) => p.kind.id === 'pallet').body.translation();
		return [t.x, t.y, t.z];
	});
	const from = await project(page, pallet);
	await page.mouse.click(from.x, from.y);
	await page.locator('[data-shack-flip]').click();
	const beside = await project(page, [door[0] - 0.3, 0.6, door[2]]);
	await page.mouse.move(beside.x, beside.y, { steps: 10 });
	await page.mouse.click(beside.x, beside.y);
	await page.waitForTimeout(1000);
	const after = await page.evaluate(() => Object.fromEntries(window.shack.pieces
		.filter((p) => ['door', 'pallet'].includes(p.kind.id))
		.map((p) => { const t = p.body.translation(); return [p.kind.id, [t.x, t.y, t.z]]; })));
	expect(after.pallet[1]).toBeLessThan(1);
	expect(after.pallet[1]).toBeGreaterThan(0.4);
	expect(Math.hypot(after.door[0] - door[0], after.door[2] - door[2])).toBeLessThan(0.02);
});
