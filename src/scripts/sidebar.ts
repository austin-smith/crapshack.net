/*
 * Sidebar controller:
 * - Toggles open/close state
 * - Focus trap while open
 * - ESC to close
 * - Outside click via transparent overlay
 * - Scroll lock on <html>
 */

import { initCollapsibles } from '../lib/ui/collapsible';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]','area[href]','button:not([disabled])','input:not([disabled])',
    'select:not([disabled])','textarea:not([disabled])','iframe','object','embed',
    '[tabindex]:not([tabindex="-1"])','[contenteditable="true"]'
  ].join(',');
  const nodeList = Array.from(container.querySelectorAll<HTMLElement>(selector));
  return nodeList.filter((el) => {
    if (el.hasAttribute('disabled') || el.tabIndex === -1) return false;
    const isVisible = el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
    return isVisible;
  });
}

class SidebarController {
  private readonly htmlEl: HTMLElement;
  private readonly sidebar: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private isOpen = false;
  private lastFocused: Element | null = null;
  private readonly prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private lastInteraction: 'pointer' | 'keyboard' = 'pointer';
  private scrollY = 0;

  constructor(args: { sidebar: HTMLElement; overlay: HTMLElement; toggle: HTMLButtonElement }) {
    this.htmlEl = document.documentElement as HTMLElement;
    this.sidebar = args.sidebar;
    this.overlay = args.overlay;
    this.toggle = args.toggle;
    this.attachEvents();
  }

  private attachEvents() {
    this.toggle.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.overlay.addEventListener('click', () => {
      if (this.isOpen) this.close();
    });
    document.addEventListener('keydown', this.onKeyDown);

    // Track last interaction type to decide initial focus target on open
    window.addEventListener('pointerdown', () => {
      this.lastInteraction = 'pointer';
    }, { passive: true });
    window.addEventListener('keydown', () => {
      this.lastInteraction = 'keyboard';
    });

    // Close after clicking any link within the sidebar
    this.sidebar.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('a')) {
        this.close();
      }
    });

    // explicit close button removed; header toggle is the single controller

    // Randomized squiggly underline on hover/focus within the sidebar nav
    this.sidebar.addEventListener('mouseover', this.onInteractiveEnter);
    this.sidebar.addEventListener('focusin', this.onInteractiveEnter);
  }

  private isEditableTarget(target: Element | null): boolean {
    if (!target) return false;
    if (target instanceof HTMLInputElement) return true;
    if (target instanceof HTMLTextAreaElement) return true;
    if (target instanceof HTMLSelectElement) return true;
    const editableAncestor = (target as Element).closest('[contenteditable]');
    if (editableAncestor instanceof HTMLElement) {
      const attr = editableAncestor.getAttribute('contenteditable');
      if (attr === null) return true;
      return attr.toLowerCase() !== 'false';
    }
    return false;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Cmd/Ctrl + B toggles sidebar when not typing in an editable element
    const isToggleChord =
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      ((typeof e.code === 'string' && e.code.toLowerCase() === 'keyb') ||
        (typeof e.key === 'string' && e.key.toLowerCase() === 'b'));

    if (isToggleChord && !this.isEditableTarget(e.target as Element | null)) {
      e.preventDefault();
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
      return;
    }

    if (!this.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = getFocusableElements(this.sidebar);
      if (focusables.length === 0) {
        e.preventDefault();
        this.sidebar.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const currentIndex = active ? focusables.indexOf(active) : -1;
      const lastIndex = focusables.length - 1;
      let nextIndex = currentIndex;
      if (e.shiftKey) {
        nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
      } else {
        nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
      }
      e.preventDefault();
      focusables[nextIndex].focus();
    }
  };

  private onInteractiveEnter = (e: Event) => {
    const target = e.target as Element | null;
    if (!target) return;
    const anchor = target.closest('a');
    if (!anchor || !this.sidebar.contains(anchor)) return;
    const span = anchor.querySelector('.squiggle-underline') as HTMLElement | null;
    if (!span) return;

    const params = this.computeUnderlineParams();
    this.applyUnderlineVars(span, params);
  };

  private computeUnderlineParams(): {
    angleDeg: number;
    offsetEm: number;
    durationMs: number;
    delayMs: number;
    x1Pct: number;
    y1Pct: number;
    x2Pct: number;
    y2Pct: number;
  } {
    const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;
    return {
      angleDeg: randomBetween(-1.8, 1.8),
      // keep underline below text: negative offset values
      offsetEm: -randomBetween(0.14, 0.28),
      durationMs: Math.round(randomBetween(180, 360)),
      delayMs: Math.round(randomBetween(0, 180)),
      x1Pct: randomBetween(12, 28),
      y1Pct: randomBetween(30, 65),
      x2Pct: randomBetween(72, 90),
      y2Pct: randomBetween(30, 65),
    };
  }

  private applyUnderlineVars(el: HTMLElement, p: {
    angleDeg: number;
    offsetEm: number;
    durationMs: number;
    delayMs: number;
    x1Pct: number;
    y1Pct: number;
    x2Pct: number;
    y2Pct: number;
  }) {
    el.style.setProperty('--underline-angle', `${p.angleDeg.toFixed(2)}deg`);
    el.style.setProperty('--underline-offset', `${p.offsetEm.toFixed(3)}em`);
    el.style.setProperty('--wiggle-duration', `${p.durationMs}ms`);
    el.style.setProperty('--wiggle-delay', `${p.delayMs}ms`);
    el.style.setProperty('--sq-x1', `${p.x1Pct.toFixed(2)}%`);
    el.style.setProperty('--sq-y1', `${p.y1Pct.toFixed(2)}%`);
    el.style.setProperty('--sq-x2', `${p.x2Pct.toFixed(2)}%`);
    el.style.setProperty('--sq-y2', `${p.y2Pct.toFixed(2)}%`);

    // If user prefers reduced motion, we still keep the static underline reveal; animation is disabled via CSS.
    if (this.prefersReducedMotion.matches) {
      // No-op: CSS @media rule handles animation off.
    }
  }

  private open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.lastFocused = document.activeElement;
    this.sidebar.classList.remove('translate-x-full');
    this.sidebar.classList.add('translate-x-0');
    this.overlay.classList.remove('hidden');
    // Consolidate state on <html>
    this.htmlEl.setAttribute('data-sidebar-open', 'true');

    // Lock scroll without layout shift: fix body and compensate for scrollbar width
    this.scrollY = window.scrollY || window.pageYOffset || 0;
    const scrollbarWidth = Math.max(0, window.innerWidth - this.htmlEl.clientWidth);
    document.body.style.position = 'fixed';
    document.body.style.top = `-${this.scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    this.toggle.setAttribute('aria-expanded', 'true');
    this.toggle.setAttribute('aria-label', 'Close menu');

    // Always focus the dialog container to avoid auto-selecting a nav item.
    this.sidebar.focus();
  }

  private close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.sidebar.classList.add('translate-x-full');
    this.sidebar.classList.remove('translate-x-0');
    this.overlay.classList.add('hidden');
    // Release consolidated state
    this.htmlEl.removeAttribute('data-sidebar-open');

    // Restore scroll
    document.body.style.position = '';
    const top = document.body.style.top;
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.paddingRight = '';
    const scrollToY = this.scrollY || (top ? -parseInt(top, 10) || 0 : 0);
    window.scrollTo(0, scrollToY);
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.setAttribute('aria-label', 'Open menu');
    if (this.lastFocused instanceof HTMLElement) {
      this.lastFocused.focus();
    } else {
      this.toggle.focus();
    }
  }
}

function initSidebar(): void {
  const sidebar = document.getElementById('site-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggle = document.getElementById('sidebar-toggle');

  if (!(sidebar instanceof HTMLElement)) return;
  if (!(overlay instanceof HTMLElement)) return;
  if (!(toggle instanceof HTMLButtonElement)) return;

  if (toggle.dataset.controllerInitialized === 'true') return;
  toggle.dataset.controllerInitialized = 'true';

  new SidebarController({ sidebar, overlay, toggle });

  // Initialize collapsible sections within sidebar
  initCollapsibles(sidebar);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSidebar, { once: true });
} else {
  initSidebar();
}

export {};
