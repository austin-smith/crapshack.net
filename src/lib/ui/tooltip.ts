/**
 * Anchored tooltip behavior, paired with components/ui/Tooltip.astro.
 * The panel appears near a hovered/focused target with a short show delay,
 * glides between targets while visible, and flips above the target when
 * there is no room below in the scroll container.
 *
 * Markup contract (rendered by Tooltip.astro):
 * - Panel: `[data-tooltip-panel]` with an id, absolutely positioned inside its
 *   offset parent, which is also treated as the scroll container. Optional
 *   children: `[data-tooltip-caret]`, `[data-tooltip-slot="title"]`,
 *   `[data-tooltip-slot="body"]`.
 * - Targets: `[data-tooltip="<panel-id>"]` sharing the panel's offset parent,
 *   with content in `data-tooltip-title` / `data-tooltip-body`.
 *
 * JS only positions and toggles state: it sets `top` and caret `left`, and
 * reflects state as `data-open` and `data-placement="below" | "above"` on the
 * panel. All visuals live in the .tooltip-* rules in global.css.
 */

const SHOW_DELAY_MS = 150;
const HIDE_DELAY_MS = 100;
const TARGET_GAP_PX = 6;

const registry: Array<{ panel: HTMLElement; hide: () => void }> = [];

function initTooltip(panel: HTMLElement): void {
	const container = panel.offsetParent;
	if (!panel.id || !(container instanceof HTMLElement)) return;

	const targets = document.querySelectorAll<HTMLElement>(`[data-tooltip="${CSS.escape(panel.id)}"]`);
	if (targets.length === 0) return;

	const caret = panel.querySelector<HTMLElement>('[data-tooltip-caret]');
	const titleEl = panel.querySelector<HTMLElement>('[data-tooltip-slot="title"]');
	const bodyEl = panel.querySelector<HTMLElement>('[data-tooltip-slot="body"]');

	const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	let showTimer = 0;
	let hideTimer = 0;
	let visible = false;

	const setSlot = (slot: HTMLElement | null, text: string): void => {
		if (!slot) return;
		slot.textContent = text;
		slot.hidden = text === '';
	};

	const show = (target: HTMLElement): void => {
		window.clearTimeout(hideTimer);
		setSlot(titleEl, target.dataset.tooltipTitle ?? '');
		setSlot(bodyEl, target.dataset.tooltipBody ?? '');

		const height = panel.offsetHeight;
		const belowTop = target.offsetTop + target.offsetHeight + TARGET_GAP_PX;
		const aboveTop = target.offsetTop - height - TARGET_GAP_PX;
		// Prefer below; flip above only when below overflows the container and
		// above actually fits. Containers that don't scroll simply overflow.
		const fitsBelow = belowTop + height <= container.scrollTop + container.clientHeight;
		const fitsAbove = aboveTop >= container.scrollTop;
		const below = fitsBelow || !fitsAbove;

		const glide = visible && !prefersReducedMotion.matches;
		panel.style.transitionProperty = prefersReducedMotion.matches
			? 'none'
			: glide ? 'opacity, top' : 'opacity';
		panel.style.top = `${below ? belowTop : aboveTop}px`;
		panel.dataset.placement = below ? 'below' : 'above';
		if (caret) {
			caret.style.transitionProperty = glide ? 'left' : 'none';
			caret.style.left = `${target.offsetLeft + target.offsetWidth / 2 - panel.offsetLeft - caret.offsetWidth / 2}px`;
		}
		panel.dataset.open = 'true';
		visible = true;
	};

	const hide = (): void => {
		window.clearTimeout(showTimer);
		window.clearTimeout(hideTimer);
		if (!visible) return;
		panel.style.transitionProperty = prefersReducedMotion.matches ? 'none' : 'opacity';
		panel.dataset.open = 'false';
		visible = false;
	};

	const scheduleShow = (target: HTMLElement): void => {
		window.clearTimeout(hideTimer);
		window.clearTimeout(showTimer);
		if (visible) {
			show(target);
		} else {
			showTimer = window.setTimeout(() => show(target), SHOW_DELAY_MS);
		}
	};

	const scheduleHide = (): void => {
		window.clearTimeout(showTimer);
		hideTimer = window.setTimeout(() => hide(), HIDE_DELAY_MS);
	};

	targets.forEach((target) => {
		target.addEventListener('mouseenter', () => scheduleShow(target));
		target.addEventListener('mouseleave', () => scheduleHide());
		// Only keyboard-driven focus shows the tooltip; programmatic refocus
		// (e.g. a closing dialog restoring focus) stays quiet.
		target.addEventListener('focusin', () => {
			if (target.matches(':focus-visible')) show(target);
		});
		target.addEventListener('focusout', () => hide());
		target.addEventListener('click', () => hide());
	});
	container.addEventListener('scroll', () => hide(), { passive: true });

	registry.push({ panel, hide });
}

export function initTooltips(): void {
	document.querySelectorAll<HTMLElement>('[data-tooltip-panel]').forEach((panel) => {
		if (panel.dataset.tooltipInitialized === 'true') return;
		panel.dataset.tooltipInitialized = 'true';
		initTooltip(panel);
	});
}

/** Hide any open tooltips whose panel is inside root (e.g. a closing drawer). */
export function hideTooltips(root: Document | HTMLElement = document): void {
	registry.forEach((entry) => {
		if (root.contains(entry.panel)) entry.hide();
	});
}
