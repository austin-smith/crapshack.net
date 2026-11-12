/**
 * The experiments list keeps exactly one experiment selected and marks its item
 * with `data-selected`; the page's styles show that experiment's world. The
 * selected one is the one whose name has keyboard focus, or else the one last
 * pointed at while the pointer is still over the list, or else the one the page
 * was served with. Up and Down move the focus from name to name.
 *
 * While it does this the list carries `data-selecting`, which tells the page's
 * styles that the selection follows the keyboard and the pointer. Without it,
 * as when scripts are off, the styles leave the browser's own cues in place.
 */
export function initExperiments(list: HTMLElement): void {
	const items = [...list.querySelectorAll<HTMLElement>('[data-experiment]')];
	const links = items.map((item) => item.querySelector('a'));
	const served = items.find((item) => item.hasAttribute('data-selected'));
	let focused: HTMLElement | undefined;
	let pointed: HTMLElement | undefined;

	const select = (): void => {
		const selected = focused ?? pointed ?? served;
		for (const item of items) item.toggleAttribute('data-selected', item === selected);
	};

	list.toggleAttribute('data-selecting', true);

	items.forEach((item, index) => {
		const link = links[index];
		if (!link) return;
		// Any movement over the name, not only arriving on it: the pointer may
		// already be there when the page comes back from history.
		link.addEventListener('pointermove', () => {
			if (pointed === item) return;
			pointed = item;
			select();
		});
		// A click focuses a link too, but only the keyboard's focus selects.
		link.addEventListener('focus', () => {
			focused = link.matches(':focus-visible') ? item : undefined;
			select();
		});
		link.addEventListener('blur', () => {
			if (focused === item) focused = undefined;
			select();
		});
	});
	// The pointed-at name holds until the pointer leaves the list, not the name:
	// on its way from one name to another it can cross the space beside a third.
	list.addEventListener('pointerleave', () => {
		pointed = undefined;
		select();
	});
	// A page brought back by Back or Forward returns as it was left, with the
	// name that was pointed at when it was left, though the pointer has been
	// elsewhere since.
	window.addEventListener('pageshow', (event) => {
		if (!event.persisted) return;
		pointed = undefined;
		select();
	});

	// Up and Down step from the selected name to the one before or after it,
	// going round from the last to the first and back. They work from anywhere
	// on the page that has no use of its own for them, so not while something
	// outside the list has focus.
	document.addEventListener('keydown', (event) => {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const active = document.activeElement;
		if (active && active !== document.body && !list.contains(active)) return;
		// Only where the page's styles show one world at a time: where they stack
		// them all, the keys scroll through them as they would any page.
		if (getComputedStyle(list).getPropertyValue('--experiments-layout').trim() !== 'window') return;
		const from = items.findIndex((item) => item.hasAttribute('data-selected'));
		const to = (from + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
		event.preventDefault();
		links[to]?.focus();
	});
}
