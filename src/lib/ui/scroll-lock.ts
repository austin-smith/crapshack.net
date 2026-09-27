/**
 * The page's scroll lock, shared by dialogs and open dropdowns: while
 * anything holds it, the page can't scroll and only the most recent holder's
 * content can. A classic scrollbar's space is kept while it's gone, so nothing
 * shifts: the body is padded by its width, and fixed elements can add
 * `--scroll-lock-gap` to their offset from the right.
 */

interface Hold {
	id: symbol;
	/** The open content, which may still scroll within itself. */
	content: Element;
}

const holds: Hold[] = [];
let restore: (() => void) | undefined;
let listening = false;
let lastTouch = { x: 0, y: 0 };

/** Whether an element can scroll any further along an axis in a direction. */
function canScroll(element: Element, axis: 'x' | 'y', delta: number): boolean {
	const style = getComputedStyle(element);
	const overflow = axis === 'y' ? style.overflowY : style.overflowX;
	if (overflow !== 'auto' && overflow !== 'scroll') return false;
	const position = axis === 'y' ? element.scrollTop : element.scrollLeft;
	const end = axis === 'y'
		? element.scrollHeight - element.clientHeight
		: element.scrollWidth - element.clientWidth;
	return delta > 0 ? position < end - 1 : position > 0;
}

/** Whether a scroll by (dx, dy) from a target moves something in the content. */
function scrollsWithin(content: Element, target: EventTarget | null, dx: number, dy: number): boolean {
	if (!(target instanceof Element) || !content.contains(target)) return false;
	const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
	const delta = axis === 'x' ? dx : dy;
	for (let element: Element | null = target; element; element = element.parentElement) {
		if (canScroll(element, axis, delta)) return true;
		if (element === content) break;
	}
	return false;
}

// Scrolling is cancelled unless it moves something in the open content, so
// it can't reach the page, even where `overflow: hidden` alone doesn't stop
// it (iOS Safari scrolls the page by touch regardless).
function cancelOutside(event: Event, dx: number, dy: number): void {
	const top = holds.at(-1);
	if (!top || (dx === 0 && dy === 0)) return;
	if (!scrollsWithin(top.content, event.target, dx, dy)) event.preventDefault();
}

function onWheel(event: WheelEvent): void {
	// A pinch on a trackpad arrives as a wheel with Ctrl, and zooms.
	if (event.ctrlKey) return;
	cancelOutside(event, event.deltaX, event.deltaY);
}

function onTouchStart(event: TouchEvent): void {
	const touch = event.touches[0];
	if (touch) lastTouch = { x: touch.clientX, y: touch.clientY };
}

function onTouchMove(event: TouchEvent): void {
	// Two fingers pinch-zoom.
	const touch = event.touches[0];
	if (!touch || event.touches.length !== 1) return;
	const dx = lastTouch.x - touch.clientX;
	const dy = lastTouch.y - touch.clientY;
	lastTouch = { x: touch.clientX, y: touch.clientY };
	cancelOutside(event, dx, dy);
}

function unlock(): void {
	restore?.();
	restore = undefined;
}

/**
 * Locks page scrolling, letting only the given content scroll while it's the
 * most recent hold, and returns the function that releases this hold.
 */
export function lockScroll(content: Element): () => void {
	if (!listening) {
		listening = true;
		// A new page starts unlocked, whatever the last one held.
		document.addEventListener('astro:before-swap', () => {
			holds.length = 0;
			unlock();
		});
	}
	if (holds.length === 0) {
		const { body, documentElement: root } = document;
		const gap = window.innerWidth - root.clientWidth;
		const previous = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
		if (gap > 0) {
			body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + gap}px`;
			root.style.setProperty('--scroll-lock-gap', `${gap}px`);
		}
		body.style.overflow = 'hidden';
		const active = { passive: false };
		document.addEventListener('wheel', onWheel, active);
		document.addEventListener('touchstart', onTouchStart, { passive: true });
		document.addEventListener('touchmove', onTouchMove, active);
		restore = () => {
			body.style.overflow = previous.overflow;
			body.style.paddingRight = previous.paddingRight;
			root.style.removeProperty('--scroll-lock-gap');
			document.removeEventListener('wheel', onWheel);
			document.removeEventListener('touchstart', onTouchStart);
			document.removeEventListener('touchmove', onTouchMove);
		};
	}
	const hold = { id: Symbol('scroll lock'), content };
	holds.push(hold);
	return () => {
		const index = holds.indexOf(hold);
		if (index < 0) return;
		holds.splice(index, 1);
		if (holds.length === 0) unlock();
	};
}
