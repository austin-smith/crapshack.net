import { openDialog } from './ui/dialog';

const initializedGalleries = new WeakSet<HTMLElement>();

/**
 * Opens the shared inspector dialog on a card's icon and steps through every
 * icon in the gallery, wrapping at the ends, with its previous/next buttons or
 * the arrow keys. Panels are rendered on the server; this only chooses which
 * one is visible.
 */
export function initAppIconGallery(root: HTMLElement): void {
	if (initializedGalleries.has(root)) return;
	initializedGalleries.add(root);

	const dialog = root.dataset.dialogId ? document.getElementById(root.dataset.dialogId) : null;
	const container = dialog?.querySelector<HTMLElement>('[data-dialog-container]');
	const content = dialog?.querySelector<HTMLElement>('[data-dialog-content]');
	const status = root.querySelector<HTMLElement>('[data-icon-status]');
	const position = root.querySelector<HTMLElement>('[data-icon-position]');
	const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-icon-panel]'));
	if (!dialog || panels.length === 0) return;

	let current = 0;

	const show = (index: number, announce: boolean) => {
		const previous = panels[current];
		current = (index + panels.length) % panels.length;
		panels.forEach((panel, i) => {
			panel.hidden = i !== current;
		});
		// Hiding the panel that held focus would leave it on a hidden element
		if (previous.hidden && previous.contains(document.activeElement)) container?.focus();
		// Each icon starts at the top, as the dialog does when it opens
		if (content) content.scrollTop = 0;
		const panel = panels[current];
		dialog.setAttribute('aria-label', panel.dataset.label ?? '');
		if (position) position.textContent = `${current + 1} of ${panels.length}`;
		// Opening already moves focus into the dialog; announce only in-place changes.
		if (status) status.textContent = announce ? `${panel.dataset.name}, ${current + 1} of ${panels.length}` : '';
	};

	root.addEventListener('click', (event) => {
		const target = event.target instanceof Element ? event.target : null;
		const trigger = target?.closest<HTMLElement>('[data-icon-inspect]');
		if (trigger) {
			const index = panels.findIndex((panel) => panel.dataset.iconPanel === trigger.dataset.iconInspect);
			if (index === -1) return;
			show(index, false);
			openDialog(dialog.id);
			return;
		}
		const step = target?.closest<HTMLElement>('[data-icon-step]');
		if (step) show(current + Number(step.dataset.iconStep), true);
	});

	dialog.addEventListener('keydown', (event) => {
		if (event.defaultPrevented || dialog.dataset.open !== 'true' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
		if (!direction) return;
		event.preventDefault();
		show(current + direction, true);
	});
}
