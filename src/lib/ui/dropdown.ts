import { lockScroll } from './scroll-lock';

let initialized = false;

// While a dropdown is open, as with Radix Select, the page behind it can't
// scroll and doesn't take the pointer: a press outside only closes it. Nor
// does it take keyboard shortcuts, which `data-dropdown-open` holds back.
const holds = new WeakMap<HTMLElement, () => void>();

function holdPage(dropdown: HTMLElement): void {
	if (holds.has(dropdown)) return;
	const releaseScroll = lockScroll();
	const { body, documentElement: root } = document;
	const bodyPointerEvents = body.style.pointerEvents;
	body.style.pointerEvents = 'none';
	dropdown.style.pointerEvents = 'auto';
	root.setAttribute('data-dropdown-open', '');
	holds.set(dropdown, () => {
		releaseScroll();
		body.style.pointerEvents = bodyPointerEvents;
		dropdown.style.pointerEvents = '';
		root.removeAttribute('data-dropdown-open');
	});
}

function releasePage(dropdown: HTMLElement): void {
	holds.get(dropdown)?.();
	holds.delete(dropdown);
}

// The touch that closes a dropdown mustn't reach the page behind it either.
// A mouse click goes where its press began, on the blocked page, but a tap
// clicks wherever it lands only once the finger lifts, after the dropdown
// has closed; so the page takes the pointer back after that click, or once
// the touch ends without one.
function holdPointerUntilTapEnds(): void {
	const { body } = document;
	const bodyPointerEvents = body.style.pointerEvents;
	body.style.pointerEvents = 'none';
	let fallback = 0;
	const end = (): void => {
		document.removeEventListener('click', end, true);
		document.removeEventListener('pointercancel', end, true);
		document.removeEventListener('pointerup', ended, true);
		window.clearTimeout(fallback);
		body.style.pointerEvents = bodyPointerEvents;
	};
	const ended = (): void => {
		fallback = window.setTimeout(end, 1000);
	};
	document.addEventListener('click', end, true);
	document.addEventListener('pointercancel', end, true);
	document.addEventListener('pointerup', ended, true);
}

function getTrigger(dropdown: HTMLElement): HTMLButtonElement | null {
	return dropdown.querySelector<HTMLButtonElement>('[data-dropdown-trigger]');
}

function getMenu(dropdown: HTMLElement): HTMLElement | null {
	return dropdown.querySelector<HTMLElement>('[data-dropdown-menu]');
}

function getOptions(dropdown: HTMLElement): HTMLButtonElement[] {
	return Array.from(dropdown.querySelectorAll<HTMLButtonElement>('[data-dropdown-option]'));
}

function setOpen(dropdown: HTMLElement, open: boolean): void {
	const trigger = getTrigger(dropdown);
	const menu = getMenu(dropdown);
	if (!trigger || !menu) return;

	trigger.setAttribute('aria-expanded', String(open));
	menu.hidden = !open;
	if (open) {
		holdPage(dropdown);
		const triggerRect = trigger.getBoundingClientRect();
		const spaceBelow = window.innerHeight - triggerRect.bottom;
		const needed = menu.offsetHeight + 8;
		if (spaceBelow < needed && triggerRect.top > spaceBelow) dropdown.dataset.direction = 'up';
		else delete dropdown.dataset.direction;
	} else {
		releasePage(dropdown);
	}
}

function closeOtherDropdowns(current?: HTMLElement): void {
	document.querySelectorAll<HTMLElement>('[data-dropdown]').forEach((dropdown) => {
		if (dropdown !== current) setOpen(dropdown, false);
	});
}

function selectOption(dropdown: HTMLElement, option: HTMLButtonElement): void {
	const value = option.dataset.dropdownOption;
	const label = dropdown.querySelector<HTMLElement>('[data-dropdown-label]');
	if (!value || !label) return;

	dropdown.dataset.dropdownValue = value;
	label.textContent = option.textContent?.trim() ?? '';
	getOptions(dropdown).forEach((candidate) => {
		candidate.setAttribute('aria-selected', String(candidate === option));
	});

	dropdown.dispatchEvent(new CustomEvent('dropdown-change', {
		detail: { value },
		bubbles: true,
	}));
}

function focusOption(dropdown: HTMLElement, direction: 'selected' | 'first' | 'last'): void {
	const options = getOptions(dropdown);
	if (direction === 'first') options[0]?.focus();
	if (direction === 'last') options.at(-1)?.focus();
	if (direction === 'selected') {
		options.find((option) => option.getAttribute('aria-selected') === 'true')?.focus();
	}
}

export function initDropdowns(): void {
	if (initialized) return;
	initialized = true;

	// A new page starts with nothing held.
	document.addEventListener('astro:before-swap', () => closeOtherDropdowns());

	// An open dropdown closes when an option is chosen, on Escape, from its
	// trigger, or on a press anywhere outside it, but not when focus leaves
	// it: Safari doesn't focus a clicked button, so pressing an option would
	// otherwise close the menu before the click could choose it.
	document.addEventListener('pointerdown', (event) => {
		if (!(event.target instanceof Element)) return;
		const pressed = event.target.closest<HTMLElement>('[data-dropdown]') ?? undefined;
		const closing = [...document.querySelectorAll<HTMLElement>('[data-dropdown]')]
			.some((dropdown) => dropdown !== pressed && holds.has(dropdown));
		closeOtherDropdowns(pressed);
		if (closing && event.pointerType !== 'mouse') holdPointerUntilTapEnds();
	});

	document.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;

		const trigger = target.closest<HTMLElement>('[data-dropdown-trigger]');
		if (trigger) {
			const dropdown = trigger.closest<HTMLElement>('[data-dropdown]');
			if (!dropdown) return;
			const open = trigger.getAttribute('aria-expanded') !== 'true';
			closeOtherDropdowns(dropdown);
			setOpen(dropdown, open);
			if (open) focusOption(dropdown, 'selected');
			else trigger.focus();
			return;
		}

		const option = target.closest<HTMLButtonElement>('[data-dropdown-option]');
		if (option) {
			const dropdown = option.closest<HTMLElement>('[data-dropdown]');
			if (!dropdown) return;
			selectOption(dropdown, option);
			setOpen(dropdown, false);
			getTrigger(dropdown)?.focus();
		}
	});

	document.addEventListener('keydown', (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;

		const dropdown = target.closest<HTMLElement>('[data-dropdown]');
		if (!dropdown) return;

		const trigger = target.closest<HTMLButtonElement>('[data-dropdown-trigger]');
		if (trigger) {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				closeOtherDropdowns(dropdown);
				setOpen(dropdown, true);
				focusOption(dropdown, event.key === 'ArrowDown' ? 'first' : 'last');
			}
			if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
				event.preventDefault();
				setOpen(dropdown, false);
			}
			return;
		}

		const options = getOptions(dropdown);
		const currentIndex = options.indexOf(target as HTMLButtonElement);
		if (currentIndex < 0) return;

		// Like a native select, an open list keeps focus until it's closed.
		if (event.key === 'Tab') event.preventDefault();

		let nextIndex: number | undefined;
		if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length;
		if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length;
		if (event.key === 'Home') nextIndex = 0;
		if (event.key === 'End') nextIndex = options.length - 1;
		if (nextIndex !== undefined) {
			event.preventDefault();
			options[nextIndex]?.focus();
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			setOpen(dropdown, false);
			getTrigger(dropdown)?.focus();
		}
	});

	document.addEventListener('dropdown-set-value', ((event: CustomEvent<{ id: string; value: string }>) => {
		const dropdown = document.getElementById(event.detail.id);
		const option = dropdown?.querySelector<HTMLButtonElement>(`[data-dropdown-option="${CSS.escape(event.detail.value)}"]`);
		if (dropdown && option) selectOption(dropdown, option);
	}) as EventListener);
}
