/**
 * Requests a menu item's value: `group` names its radio group, if it's in
 * one. Cancelable. An uncontrolled radio group selects the value after
 * dispatch unless the event was canceled; a controlled one leaves that to its
 * controller, through `setContextMenuRadioValue`.
 */
export type ContextMenuSelectEvent = CustomEvent<{ value: string; group?: string }>;

/** A menu is opening or has closed: dispatched on its root before it is shown, and after it closes. */
export type ContextMenuOpenChangeEvent = CustomEvent<{ open: boolean }>;

const LONG_PRESS_DELAY_MS = 600;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const VIEWPORT_MARGIN_PX = 8;

interface OpenContextMenu {
	root: HTMLElement;
	trigger: HTMLElement;
	menu: HTMLElement;
}

interface PendingLongPress {
	pointerId: number;
	root: HTMLElement;
	startX: number;
	startY: number;
	timerId: number;
}

interface ActiveClickSuppression {
	controller: AbortController;
}

let initialized = false;
let activeMenu: OpenContextMenu | undefined;
let pendingLongPress: PendingLongPress | undefined;
let activeClickSuppression: ActiveClickSuppression | undefined;

function getTriggerWrapper(root: HTMLElement): HTMLElement | null {
	return root.querySelector<HTMLElement>('[data-context-menu-trigger]');
}

function getTrigger(root: HTMLElement): HTMLElement | null {
	const wrapper = getTriggerWrapper(root);
	return wrapper?.firstElementChild instanceof HTMLElement ? wrapper.firstElementChild : wrapper;
}

function getMenu(root: HTMLElement): HTMLElement | null {
	return root.querySelector<HTMLElement>('[data-context-menu-content]');
}

function getRadioGroup(root: HTMLElement, group: string): HTMLElement | null {
	return getMenu(root)?.querySelector<HTMLElement>(
		`[data-context-menu-radio-group="${CSS.escape(group)}"]`,
	) ?? null;
}

function getSubmenuTrigger(submenu: HTMLElement): HTMLElement | null {
	return document.querySelector<HTMLElement>(
		`[data-context-menu-sub-trigger][aria-controls="${CSS.escape(submenu.id)}"]`,
	);
}

/** The submenu trigger that opens a radio group. */
function getRadioGroupTrigger(radioGroup: HTMLElement): HTMLElement | null {
	const submenu = radioGroup.closest<HTMLElement>('[data-context-menu-sub-content]');
	return submenu ? getSubmenuTrigger(submenu) : null;
}

/** Checks the radio item with `value`, and shows its label on the group's trigger. */
function selectRadioValue(radioGroup: HTMLElement, value: string): void {
	let selectedLabel = value;
	radioGroup.dataset.contextMenuValue = value;
	radioGroup.querySelectorAll<HTMLElement>('[role="menuitemradio"]').forEach((radioItem) => {
		const checked = radioItem.dataset.contextMenuValue === value;
		radioItem.setAttribute('aria-checked', String(checked));
		if (checked) selectedLabel = radioItem.textContent?.trim() || value;
	});
	const trigger = getRadioGroupTrigger(radioGroup);
	const triggerValue = trigger?.querySelector<HTMLElement>('[data-context-menu-sub-value]');
	if (triggerValue) triggerValue.textContent = selectedLabel;
	if (trigger?.dataset.contextMenuSubLabel) {
		trigger.setAttribute('aria-label', `${trigger.dataset.contextMenuSubLabel}, ${selectedLabel}`);
	}
}

/**
 * Selects `value` in a controlled radio group: the controller's counterpart
 * to an uncontrolled group selecting on its own.
 */
export function setContextMenuRadioValue(root: HTMLElement, group: string, value: string): void {
	const radioGroup = getRadioGroup(root, group);
	if (radioGroup) selectRadioValue(radioGroup, value);
}

/** Enables or disables the submenu holding a radio group. */
export function setContextMenuRadioGroupDisabled(root: HTMLElement, group: string, disabled: boolean): void {
	const radioGroup = getRadioGroup(root, group);
	const trigger = radioGroup && getRadioGroupTrigger(radioGroup);
	if (!trigger) return;
	trigger.toggleAttribute('disabled', disabled);
	if (disabled) {
		trigger.setAttribute('aria-disabled', 'true');
		if (trigger.getAttribute('aria-expanded') === 'true') closeSubmenu(trigger);
	} else {
		trigger.removeAttribute('aria-disabled');
	}
}

function dispatchOpenChange(root: HTMLElement, open: boolean): void {
	const change: ContextMenuOpenChangeEvent = new CustomEvent('context-menu-open-change', {
		detail: { open },
		bubbles: true,
	});
	root.dispatchEvent(change);
}

function getItems(menu: HTMLElement): HTMLElement[] {
	return Array.from(menu.querySelectorAll<HTMLElement>('[data-context-menu-item]'))
		.filter((item) => (
			item.closest<HTMLElement>('[role="menu"]') === menu
			&& item.getAttribute('aria-disabled') !== 'true'
			&& !item.hasAttribute('disabled')
		));
}

function getOwningMenu(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element ? target.closest<HTMLElement>('[role="menu"]') : null;
}

function getSubmenu(trigger: HTMLElement): HTMLElement | null {
	const id = trigger.getAttribute('aria-controls');
	const menu = id ? document.getElementById(id) : null;
	return menu instanceof HTMLElement ? menu : null;
}

function closeSubmenu(trigger: HTMLElement, restoreFocus = false): void {
	const menu = getSubmenu(trigger);
	trigger.setAttribute('aria-expanded', 'false');
	if (menu) menu.hidden = true;
	if (restoreFocus) trigger.focus();
}

function closeSubmenus(menu: HTMLElement, except?: HTMLElement): void {
	menu.querySelectorAll<HTMLElement>('[data-context-menu-sub-trigger][aria-expanded="true"]')
		.forEach((trigger) => {
			if (trigger !== except) closeSubmenu(trigger);
		});
}

function openSubmenu(trigger: HTMLElement, focusItem = false): void {
	const menu = getSubmenu(trigger);
	if (!menu || !activeMenu?.menu.contains(menu)) return;

	closeSubmenus(activeMenu.menu, trigger);
	trigger.setAttribute('aria-expanded', 'true');
	menu.hidden = false;
	const triggerRect = trigger.getBoundingClientRect();
	const roomRight = window.innerWidth - triggerRect.right;
	const roomLeft = triggerRect.left;
	menu.dataset.side = roomRight >= menu.offsetWidth + 6 || roomRight >= roomLeft ? 'right' : 'left';
	// Submenus open downward from their trigger row; flip one upward when it
	// would run past the bottom of the viewport.
	delete menu.dataset.align;
	if (menu.getBoundingClientRect().bottom > window.innerHeight - VIEWPORT_MARGIN_PX) {
		menu.dataset.align = 'bottom';
	}
	if (focusItem) {
		const selected = menu.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
		(selected ?? getItems(menu)[0])?.focus({ preventScroll: true });
	}
}

function getRoot(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element
		? target.closest<HTMLElement>('[data-context-menu-root]')
		: null;
}

function isTriggerTarget(target: EventTarget | null, root: HTMLElement): boolean {
	return target instanceof Element && getTriggerWrapper(root)?.contains(target) === true;
}

function prepareContextMenus(): void {
	document.querySelectorAll<HTMLElement>('[data-context-menu-root]').forEach((root) => {
		const trigger = getTrigger(root);
		const menu = getMenu(root);
		if (!trigger || !menu?.id) return;

		trigger.setAttribute('aria-haspopup', 'menu');
		trigger.setAttribute('aria-controls', menu.id);
		trigger.setAttribute('aria-expanded', String(!menu.hidden));
	});
}

function positionMenu(menu: HTMLElement, clientX: number, clientY: number): void {
	menu.style.left = '0px';
	menu.style.top = '0px';

	const maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - menu.offsetWidth - VIEWPORT_MARGIN_PX);
	const maxTop = Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - menu.offsetHeight - VIEWPORT_MARGIN_PX);
	const left = Math.min(Math.max(clientX, VIEWPORT_MARGIN_PX), maxLeft);
	const top = Math.min(Math.max(clientY, VIEWPORT_MARGIN_PX), maxTop);

	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;
}

function closeContextMenu(restoreFocus = false): void {
	if (!activeMenu) return;

	const { root, trigger, menu } = activeMenu;
	closeSubmenus(menu);
	root.removeAttribute('data-open');
	delete document.documentElement.dataset.contextMenuOpen;
	trigger.setAttribute('aria-expanded', 'false');
	menu.hidden = true;
	menu.style.removeProperty('left');
	menu.style.removeProperty('top');
	activeMenu = undefined;

	if (restoreFocus) trigger.focus();
	dispatchOpenChange(root, false);
}

function openContextMenu(
	root: HTMLElement,
	clientX: number,
	clientY: number,
	focusFirstItem = false,
): void {
	const trigger = getTrigger(root);
	const menu = getMenu(root);
	if (!trigger || !menu) return;

	closeContextMenu();
	// Before it's shown, so a controller can bring its items up to date.
	dispatchOpenChange(root, true);
	activeMenu = { root, trigger, menu };
	root.setAttribute('data-open', '');
	// While a menu is open the rest of the page is inert to the pointer, as with
	// native menus: no hover states or pointer cursor on what sits underneath.
	document.documentElement.dataset.contextMenuOpen = '';
	trigger.setAttribute('aria-expanded', 'true');
	menu.hidden = false;
	positionMenu(menu, clientX, clientY);
	const focusTarget = focusFirstItem ? getItems(menu)[0] : menu;
	focusTarget?.focus({ preventScroll: true });
}

function openContextMenuFromKeyboard(root: HTMLElement): void {
	const trigger = getTrigger(root);
	if (!trigger) return;

	const rect = trigger.getBoundingClientRect();
	openContextMenu(root, rect.left + rect.width / 2, rect.top + rect.height / 2, true);
}

function clearLongPress(): void {
	if (!pendingLongPress) return;
	window.clearTimeout(pendingLongPress.timerId);
	pendingLongPress = undefined;
}

function clearClickSuppression(): void {
	activeClickSuppression?.controller.abort();
	activeClickSuppression = undefined;
}

// Swallow the click that the browser synthesizes when `pointerId` is released
// on `target`. Used so a long-press that opens the menu and a press outside
// that dismisses it are not also delivered as clicks to whatever is underneath.
function suppressClickThroughPointerRelease(target: EventTarget, pointerId: number): void {
	clearClickSuppression();
	const controller = new AbortController();
	activeClickSuppression = { controller };

	const clear = (): void => {
		if (activeClickSuppression?.controller !== controller) return;
		clearClickSuppression();
	};
	const suppressClick = (event: Event): void => {
		event.preventDefault();
		event.stopImmediatePropagation();
		clear();
	};
	const finishPointer = (event: PointerEvent): void => {
		if (event.pointerId !== pointerId) return;
		window.setTimeout(clear, 0);
	};

	target.addEventListener('click', suppressClick, { capture: true, signal: controller.signal });
	document.addEventListener('pointerup', finishPointer, { capture: true, signal: controller.signal });
	document.addEventListener('pointercancel', finishPointer, { capture: true, signal: controller.signal });
}

function moveFocus(menu: HTMLElement, direction: 'next' | 'previous' | 'first' | 'last'): void {
	const items = getItems(menu);
	if (items.length === 0) return;

	if (direction === 'first') {
		items[0]?.focus();
		return;
	}
	if (direction === 'last') {
		items.at(-1)?.focus();
		return;
	}

	const currentIndex = items.indexOf(document.activeElement as HTMLElement);
	const offset = direction === 'next' ? 1 : -1;
	const startIndex = currentIndex < 0 ? (direction === 'next' ? -1 : 0) : currentIndex;
	items[(startIndex + offset + items.length) % items.length]?.focus();
}

export function initContextMenus(): void {
	prepareContextMenus();
	if (initialized) return;
	initialized = true;

	document.addEventListener('astro:page-load', prepareContextMenus);
	document.addEventListener('astro:before-swap', () => {
		clearLongPress();
		clearClickSuppression();
		closeContextMenu();
	});

	document.addEventListener('contextmenu', (event) => {
		const root = getRoot(event.target);
		if (!root || !isTriggerTarget(event.target, root)) return;

		event.preventDefault();
		clearLongPress();
		openContextMenu(root, event.clientX, event.clientY);
	});

	document.addEventListener('pointerdown', (event) => {
		if (event.pointerType === 'mouse') return;
		const root = getRoot(event.target);
		if (!root || !isTriggerTarget(event.target, root)) return;

		clearLongPress();
		pendingLongPress = {
			pointerId: event.pointerId,
			root,
			startX: event.clientX,
			startY: event.clientY,
			timerId: window.setTimeout(() => {
				openContextMenu(root, event.clientX, event.clientY);
				const trigger = getTrigger(root);
				if (trigger) suppressClickThroughPointerRelease(trigger, event.pointerId);
				pendingLongPress = undefined;
			}, LONG_PRESS_DELAY_MS),
		};
	});

	document.addEventListener('pointermove', (event) => {
		if (!pendingLongPress || pendingLongPress.pointerId !== event.pointerId) return;
		const movedX = Math.abs(event.clientX - pendingLongPress.startX);
		const movedY = Math.abs(event.clientY - pendingLongPress.startY);
		if (movedX > LONG_PRESS_MOVE_TOLERANCE_PX || movedY > LONG_PRESS_MOVE_TOLERANCE_PX) {
			clearLongPress();
		}
	});

	document.addEventListener('pointerup', clearLongPress);
	document.addEventListener('pointercancel', clearLongPress);

	document.addEventListener('click', (event) => {
		const item = event.target instanceof Element
			? event.target.closest<HTMLElement>('[data-context-menu-item]')
			: null;
		if (!item || !activeMenu?.menu.contains(item)) return;
		if (item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('disabled')) {
			event.preventDefault();
			return;
		}
		if (item.hasAttribute('data-context-menu-sub-trigger')) {
			event.preventDefault();
			openSubmenu(item, true);
			return;
		}
		const value = item.dataset.contextMenuValue;
		if (value !== undefined) {
			const radioGroup = item.closest<HTMLElement>('[data-context-menu-radio-group]');
			const select: ContextMenuSelectEvent = new CustomEvent('context-menu-select', {
				bubbles: true,
				cancelable: true,
				detail: { value, group: radioGroup?.dataset.contextMenuRadioGroup },
			});
			if (item.dispatchEvent(select) && radioGroup && !radioGroup.hasAttribute('data-controlled')) {
				selectRadioValue(radioGroup, value);
			}
		}
		closeContextMenu(value !== undefined);
	});

	document.addEventListener('pointerover', (event) => {
		if (!activeMenu || event.pointerType === 'touch') return;
		const item = event.target instanceof Element
			? event.target.closest<HTMLElement>('[data-context-menu-item]')
			: null;
		if (!item || getOwningMenu(item) !== activeMenu.menu) return;
		if (item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('disabled')) {
			closeSubmenus(activeMenu.menu);
			return;
		}
		if (item.hasAttribute('data-context-menu-sub-trigger')) openSubmenu(item);
		else closeSubmenus(activeMenu.menu);
	});

	document.addEventListener('pointerdown', (event) => {
		if (!activeMenu) return;
		if (event.target instanceof Node && activeMenu.menu.contains(event.target)) return;
		closeContextMenu();
		// A press outside only dismisses the menu; it must not also click what
		// is underneath (typically the trigger itself).
		suppressClickThroughPointerRelease(document, event.pointerId);
	}, true);

	document.addEventListener('keydown', (event) => {
		const root = getRoot(event.target);
		if (root && isTriggerTarget(event.target, root)) {
			if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
				event.preventDefault();
				openContextMenuFromKeyboard(root);
			}
			return;
		}

		if (!activeMenu || !(event.target instanceof Node) || !activeMenu.menu.contains(event.target)) return;
		const menu = getOwningMenu(event.target);
		if (!menu) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveFocus(menu, 'next');
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveFocus(menu, 'previous');
		}
		if (event.key === 'Home') {
			event.preventDefault();
			moveFocus(menu, 'first');
		}
		if (event.key === 'End') {
			event.preventDefault();
			moveFocus(menu, 'last');
		}
		if (event.key === 'ArrowRight' && event.target instanceof HTMLElement
			&& event.target.hasAttribute('data-context-menu-sub-trigger')) {
			event.preventDefault();
			openSubmenu(event.target, true);
		}
		if (event.key === 'ArrowLeft' && menu.hasAttribute('data-context-menu-sub-content')) {
			event.preventDefault();
			const trigger = getSubmenuTrigger(menu);
			if (trigger) closeSubmenu(trigger, true);
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			if (menu.hasAttribute('data-context-menu-sub-content')) {
				const trigger = getSubmenuTrigger(menu);
				if (trigger) closeSubmenu(trigger, true);
			} else {
				closeContextMenu(true);
			}
		}
		if (event.key === 'Tab') closeContextMenu();
	});

	window.addEventListener('blur', () => {
		clearClickSuppression();
		closeContextMenu();
	});
	window.addEventListener('resize', () => closeContextMenu());
	window.addEventListener('scroll', () => closeContextMenu(), true);
}
