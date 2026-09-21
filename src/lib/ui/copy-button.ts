import { copyTextToClipboard } from '../clipboard';

const FEEDBACK_DURATION_MS = 2000;
const pending = new WeakSet<HTMLButtonElement>();
const resetTimers = new WeakMap<HTMLButtonElement, number>();
let initialized = false;

/** One delegated listener also handles controls added by client navigation. */
export function initCopyButtons(): void {
	if (initialized) return;
	initialized = true;

	document.addEventListener('click', async (event) => {
		if (event.defaultPrevented || !(event.target instanceof Element)) return;
		const button = event.target.closest<HTMLButtonElement>('button[data-copy-button]');
		if (!button || button.matches(':disabled, [aria-disabled="true"]') || pending.has(button)) return;
		const control = button.closest<HTMLElement>('[data-copy-control]');
		const status = control?.querySelector<HTMLElement>('[data-copy-status]');
		if (!control || !status) return;

		const setFeedback = (state: 'idle' | 'success' | 'error'): void => {
			control.dataset.state = state;
			button.querySelector('[data-copy-icon]')?.classList.toggle('hidden', state === 'success');
			button.querySelector('[data-copy-check]')?.classList.toggle('hidden', state !== 'success');
			status.classList.toggle('sr-only', state !== 'error');
			status.textContent = state === 'success' ? 'Copied to clipboard.'
				: state === 'error' ? 'Couldn’t copy. Try again.' : '';
		};

		window.clearTimeout(resetTimers.get(button));
		resetTimers.delete(button);
		setFeedback('idle');
		pending.add(button);
		button.setAttribute('aria-busy', 'true');

		// Resolve the current text for snippets that change (e.g. Docker/Compose).
		// A missing source is an error, not a successful copy of an empty string.
		const text = button.dataset.copyTarget !== undefined
			? document.getElementById(button.dataset.copyTarget)?.textContent
			: button.dataset.copyText;
		const success = text != null && await copyTextToClipboard(text);
		pending.delete(button);
		button.removeAttribute('aria-busy');
		if (!button.isConnected) return;

		setFeedback(success ? 'success' : 'error');
		if (success) {
			resetTimers.set(button, window.setTimeout(() => {
				setFeedback('idle');
				resetTimers.delete(button);
			}, FEEDBACK_DURATION_MS));
		}
	});
}
