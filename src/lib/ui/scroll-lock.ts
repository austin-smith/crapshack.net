/**
 * The page's scroll lock, shared by dialogs and open dropdowns: the page
 * can't scroll while anything holds it. A classic scrollbar's space is kept
 * while it's gone, so nothing shifts: the body is padded by its width, and
 * fixed elements can add `--scroll-lock-gap` to their offset from the right.
 */

const holders = new Set<symbol>();
let restore: (() => void) | undefined;
let listening = false;

function unlock(): void {
	restore?.();
	restore = undefined;
}

/** Locks page scrolling, and returns the function that releases this hold. */
export function lockScroll(): () => void {
	if (!listening) {
		listening = true;
		// A new page starts unlocked, whatever the last one held.
		document.addEventListener('astro:before-swap', () => {
			holders.clear();
			unlock();
		});
	}
	if (holders.size === 0) {
		const { body, documentElement: root } = document;
		const gap = window.innerWidth - root.clientWidth;
		const previous = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
		if (gap > 0) {
			body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + gap}px`;
			root.style.setProperty('--scroll-lock-gap', `${gap}px`);
		}
		body.style.overflow = 'hidden';
		restore = () => {
			body.style.overflow = previous.overflow;
			body.style.paddingRight = previous.paddingRight;
			root.style.removeProperty('--scroll-lock-gap');
		};
	}
	const holder = Symbol('scroll lock');
	holders.add(holder);
	return () => {
		if (holders.delete(holder) && holders.size === 0) unlock();
	};
}
