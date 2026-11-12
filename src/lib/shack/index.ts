// The physics engine and renderer are a few megabytes between them, so they
// load after the page has painted, behind the title card.
export async function initShack(root: HTMLElement): Promise<void> {
	const loading = root.querySelector<HTMLElement>('[data-shack-loading]');
	try {
		const [{ default: RAPIER }, { Game }] = await Promise.all([
			import('@dimforge/rapier3d-compat'),
			import('./game'),
		]);
		await RAPIER.init();
		new Game(root);
	} catch (error) {
		if (loading) loading.textContent = 'the junk didn\'t make it. this needs webgl.';
		console.error(error);
	}
}
