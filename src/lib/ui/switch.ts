export type SwitchChangeEvent = CustomEvent<{ checked: boolean }>;

let initialized = false;

/** Native button activation handles Enter/Space; delegation also covers swapped pages. */
export function initSwitches(): void {
	if (initialized) return;
	initialized = true;

	document.addEventListener('click', (event) => {
		if (event.defaultPrevented || !(event.target instanceof Element)) return;
		const button = event.target.closest<HTMLButtonElement>('button[data-ui-switch]');
		if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;

		const checked = button.getAttribute('aria-checked') !== 'true';
		const change: SwitchChangeEvent = new CustomEvent('switch-change', {
			detail: { checked },
			bubbles: true,
			cancelable: true,
		});
		if (button.dispatchEvent(change) && !button.hasAttribute('data-controlled')) {
			button.setAttribute('aria-checked', String(checked));
		}
	});
}
