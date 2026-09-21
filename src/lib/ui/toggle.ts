export type ToggleChangeEvent = CustomEvent<{ pressed: boolean }>;

let initialized = false;

/** Native button activation handles Enter/Space; delegation also covers swapped pages. */
export function initToggles(): void {
	if (initialized) return;
	initialized = true;

	document.addEventListener('click', (event) => {
		if (event.defaultPrevented || !(event.target instanceof Element)) return;
		const button = event.target.closest<HTMLButtonElement>('button[data-ui-toggle]');
		if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;

		const pressed = button.getAttribute('aria-pressed') !== 'true';
		const change: ToggleChangeEvent = new CustomEvent('toggle-change', {
			detail: { pressed },
			bubbles: true,
			cancelable: true,
		});
		if (button.dispatchEvent(change) && !button.hasAttribute('data-controlled')) {
			button.setAttribute('aria-pressed', String(pressed));
		}
	});
}
