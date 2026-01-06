/**
 * Toggle group initialization via event delegation.
 * Single listener handles all toggle groups on the page.
 * Includes sliding indicator animation.
 */

let initialized = false;

/**
 * Updates the sliding indicator position and size for a toggle group
 */
function updateSliderPosition(group: HTMLElement, targetLabel: HTMLElement): void {
	const slider = group.querySelector<HTMLElement>('.toggle-slider');
	if (!slider) return;

	const groupRect = group.getBoundingClientRect();
	const labelRect = targetLabel.getBoundingClientRect();

	// Calculate position relative to the group's padding (0.25rem = 4px at default scale)
	// The slider starts at left: 0.25rem, so we need to offset from there
	const left = labelRect.left - groupRect.left - 4; // Subtract the initial 0.25rem offset
	const width = labelRect.width;

	slider.style.transform = `translateX(${left}px)`;
	slider.style.width = `${width}px`;
}

/**
 * Initializes a single toggle group with its sliding indicator
 */
function initToggleGroup(group: HTMLElement): void {
	const slider = group.querySelector<HTMLElement>('.toggle-slider');
	if (!slider) return;

	// Position slider on the initially checked option
	const checkedInput = group.querySelector<HTMLInputElement>('input[type="radio"]:checked');
	if (checkedInput) {
		const label = checkedInput.closest<HTMLElement>('.toggle-option')?.querySelector<HTMLElement>('.toggle-label');
		if (label) {
			// Disable transitions temporarily for initial positioning
			slider.style.transition = 'none';
			updateSliderPosition(group, label);
			// Mark as initialized to trigger opacity transition
			slider.setAttribute('data-initialized', 'true');
			// Force reflow
			void slider.offsetHeight;
			// Re-enable transitions
			slider.style.transition = '';
		}
	}
}

export function initToggleGroups(): void {
	if (initialized) return;
	initialized = true;

	// Initialize all existing toggle groups
	const groups = document.querySelectorAll<HTMLElement>('[data-toggle-group]');
	groups.forEach(initToggleGroup);

	// Handle toggle changes
	document.addEventListener('change', (e) => {
		const target = e.target;
		if (!(target instanceof HTMLInputElement)) return;
		if (target.type !== 'radio') return;
		if (!target.checked) return;

		const group = target.closest<HTMLElement>('[data-toggle-group]');
		if (!group) return;

		// Update slider position
		const label = target.closest<HTMLElement>('.toggle-option')?.querySelector<HTMLElement>('.toggle-label');
		if (label) {
			updateSliderPosition(group, label);
		}

		// Dispatch custom event
		group.dispatchEvent(
			new CustomEvent('toggle-change', {
				detail: { value: target.value },
				bubbles: true,
			})
		);
	});

	// Update slider positions on window resize
	let resizeTimeout: number;
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimeout);
		resizeTimeout = window.setTimeout(() => {
			groups.forEach((group) => {
				const checkedInput = group.querySelector<HTMLInputElement>('input[type="radio"]:checked');
				if (checkedInput) {
					const label = checkedInput.closest<HTMLElement>('.toggle-option')?.querySelector<HTMLElement>('.toggle-label');
					if (label) {
						updateSliderPosition(group, label);
					}
				}
			});
		}, 100);
	});
}
