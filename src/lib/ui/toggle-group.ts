/**
 * Toggle group initialization via event delegation.
 * Single listener handles all toggle groups on the page.
 * Includes sliding indicator animation.
 */

let initialized = false;

/**
 * Updates the sliding indicator position and size for a toggle group.
 * Handles hidden containers and CSS scale transforms.
 */
function updateSliderPosition(group: HTMLElement, targetLabel: HTMLElement): void {
	const slider = group.querySelector<HTMLElement>('.toggle-slider');
	if (!slider) return;

	const groupRect = group.getBoundingClientRect();
	const labelRect = targetLabel.getBoundingClientRect();

	// If completely hidden (width = 0), retry on next frame until visible
	if (labelRect.width === 0 || groupRect.width === 0) {
		requestAnimationFrame(() => updateSliderPosition(group, targetLabel));
		return;
	}

	// Detect scale from parent transforms (e.g., dialog scale animation)
	// Compare bounding rect to offset dimensions
	const scale = group.offsetWidth > 0 ? groupRect.width / group.offsetWidth : 1;

	// If still animating (scale != 1), retry on next frame
	if (Math.abs(scale - 1) > 0.01) {
		requestAnimationFrame(() => updateSliderPosition(group, targetLabel));
		return;
	}

	// Calculate position relative to the slider's inline start (respects padding/RTL)
	const groupStyles = getComputedStyle(group);
	const sliderStyles = getComputedStyle(slider);
	const offsetCandidates = [
		parseFloat(sliderStyles.insetInlineStart || ''),
		parseFloat(sliderStyles.left || ''),
		parseFloat(groupStyles.paddingInlineStart || ''),
		parseFloat(groupStyles.paddingLeft || ''),
	];
	const startOffset = offsetCandidates.find((value) => Number.isFinite(value)) ?? 0;
	const left = labelRect.left - groupRect.left - startOffset;
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

	// Listen for programmatic value changes via custom event
	// Usage: document.dispatchEvent(new CustomEvent('toggle-set-value', { detail: { name: 'group-name', value: 'option-value' } }))
	document.addEventListener('toggle-set-value', ((e: CustomEvent<{ name: string; value: string }>) => {
		const { name, value } = e.detail;
		const radio = document.querySelector<HTMLInputElement>(
			`[data-toggle-group="${name}"] input[value="${value}"]`
		);
		if (radio) {
			radio.checked = true;
			radio.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}) as EventListener);

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
