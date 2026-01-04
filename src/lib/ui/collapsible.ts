/**
 * Initialize collapsible elements with animated close.
 * Native <details> doesn't animate on close, so we intercept
 * the click, run the animation, then remove the open attribute.
 */
export function initCollapsibles(root: Document | HTMLElement = document): void {
	const collapsibles = root.querySelectorAll<HTMLDetailsElement>('details.collapsible');

	collapsibles.forEach((details) => {
		const summary = details.querySelector('summary');
		const content = details.querySelector<HTMLElement>('.collapsible-content');

		if (!summary || !content) return;

		summary.addEventListener('click', (e) => {
			if (!details.open) {
				// Opening - let native behavior handle it, CSS animates expand
				return;
			}

			// Closing - prevent default and animate
			e.preventDefault();

			// Animate to collapsed state
			content.style.gridTemplateRows = '0fr';

			// Wait for transition to complete, then remove open attribute
			// Filter by target and property to avoid premature close from bubbled child transitions
			const onTransitionEnd = (e: TransitionEvent) => {
				if (e.target !== content || e.propertyName !== 'grid-template-rows') return;

				details.open = false;
				content.style.gridTemplateRows = '';
				content.removeEventListener('transitionend', onTransitionEnd);
			};

			content.addEventListener('transitionend', onTransitionEnd);
		});
	});
}
