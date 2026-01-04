/**
 * Dialog utility functions for programmatic control
 */

/** Track the element that opened the dialog to return focus */
const triggerMap = new WeakMap<HTMLElement, HTMLElement>();

/** Track which dialogs have been initialized to avoid double-binding */
const initializedDialogs = new WeakSet<HTMLElement>();

/** Track currently open dialog IDs (stack order) */
const openDialogStack: string[] = [];

/** Ensure we only bind one global Escape handler */
let escapeHandlerBound = false;

function bindGlobalEscapeHandler(): void {
	if (escapeHandlerBound) return;
	escapeHandlerBound = true;

	document.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key !== 'Escape') return;

		// Close the most recently opened dialog that is still in the DOM
		while (openDialogStack.length > 0) {
			const id = openDialogStack[openDialogStack.length - 1];
			const dialog = document.getElementById(id);
			if (!dialog || dialog.dataset.open !== 'true') {
				openDialogStack.pop();
				continue;
			}
			e.preventDefault();
			closeDialog(id);
			break;
		}
	});
}

/** Track currently focused element within dialog for focus trap */
function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
	const selector = [
		'button:not([disabled])',
		'[href]',
		'input:not([disabled])',
		'select:not([disabled])',
		'textarea:not([disabled])',
		'[tabindex]:not([tabindex="-1"])',
	].join(', ');
	return Array.from(dialog.querySelectorAll<HTMLElement>(selector));
}

/**
 * Open a dialog by ID
 */
export function openDialog(id: string): void {
	const dialog = document.getElementById(id);
	if (!dialog) {
		console.warn(`Dialog with id "${id}" not found`);
		return;
	}

	// Prevent opening if already open
	if (dialog.dataset.open === 'true') {
		return;
	}

	// Store trigger element to return focus on close
	const activeElement = document.activeElement as HTMLElement;
	if (activeElement) {
		triggerMap.set(dialog, activeElement);
	}

	// Prevent body scroll
	document.body.style.overflow = 'hidden';

	// Open the dialog
	dialog.dataset.open = 'true';
	dialog.setAttribute('aria-hidden', 'false');
	openDialogStack.push(id);

	// Ensure global escape handler is registered
	bindGlobalEscapeHandler();

	// Move focus into the dialog: first focusable element, else the dialog itself
	requestAnimationFrame(() => {
		const focusable = getFocusableElements(dialog);
		const target = focusable[0] ?? dialog;

		// Ensure the dialog can receive focus for fallback
		if (target === dialog && !dialog.hasAttribute('tabindex')) {
			dialog.setAttribute('tabindex', '-1');
		}

		(target as HTMLElement)?.focus();
	});
}

/**
 * Close a dialog by ID
 */
export function closeDialog(id: string): void {
	const dialog = document.getElementById(id);
	if (!dialog) return;

	dialog.dataset.open = 'false';
	dialog.setAttribute('aria-hidden', 'true');
	// Remove from stack if present
	const idx = openDialogStack.lastIndexOf(id);
	if (idx !== -1) {
		openDialogStack.splice(idx, 1);
	}

	// Restore body scroll
	if (openDialogStack.length === 0) {
		document.body.style.overflow = '';
	}

	// Return focus to trigger element
	const trigger = triggerMap.get(dialog);
	if (trigger && typeof trigger.focus === 'function') {
		trigger.focus();
		triggerMap.delete(dialog);
	}
}

/**
 * Initialize a dialog element with event handlers
 */
export function initDialog(dialog: HTMLElement): void {
	const id = dialog.id;
	if (!id) return;

	// Skip if already initialized
	if (initializedDialogs.has(dialog)) return;
	initializedDialogs.add(dialog);

	const backdrop = dialog.querySelector<HTMLElement>('[data-dialog-backdrop]');
	const closeBtn = dialog.querySelector<HTMLElement>('[data-dialog-close]');

	// Close on backdrop click
	backdrop?.addEventListener('click', () => closeDialog(id));

	// Close on close button click
	closeBtn?.addEventListener('click', () => closeDialog(id));

	// Focus trap with Tab (on the dialog itself)
	dialog.addEventListener('keydown', (e: KeyboardEvent) => {
		if (dialog.dataset.open !== 'true') return;

		if (e.key === 'Tab') {
			const focusable = getFocusableElements(dialog);
			if (focusable.length === 0) return;

			const first = focusable[0];
			const last = focusable[focusable.length - 1];

			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	});
}

/**
 * Initialize all dialogs on the page
 */
export function initAllDialogs(): void {
	const dialogs = document.querySelectorAll<HTMLElement>('.dialog-root');
	dialogs.forEach((dialog) => initDialog(dialog));
}
