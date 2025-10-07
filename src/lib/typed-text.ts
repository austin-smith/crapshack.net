export type TypedTextOptions = {
  baseDelayMs?: number;
  jitterMs?: number;
  signal?: AbortSignal;
  cursorChar?: string;
  cursorBlinkMs?: number;
  preTypeDelayMs?: number;
  keepCursorMs?: number;
  cursorWidthPx?: number;
  cursorHeight?: string;
  cursorVerticalAlign?: string;
  cursorFadeMs?: number;
  appendEllipsis?: boolean;
  ellipsisText?: string;
  ellipsisPauseMs?: number;
};

function getReducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reveal text inside an element character-by-character with light jitter.
 * - Respects user reduced motion preference by rendering instantly.
 * - Stops cleanly if the element is disconnected or the provided AbortSignal is aborted.
 */
export async function typedText(
  element: HTMLElement | null,
  text: string,
  options: TypedTextOptions = {}
): Promise<void> {
  if (!element) return;

  const baseDelayMs = options.baseDelayMs ?? 28;
  const jitterMs = options.jitterMs ?? 32;
  const signal = options.signal;
  const cursorBlinkMs = options.cursorBlinkMs ?? 600; // slower default blink
  const preTypeDelayMs = options.preTypeDelayMs ?? 1200; // longer pre-type pause
  const keepCursorMs = options.keepCursorMs; // undefined => keep blinking indefinitely
  const cursorWidthPx = options.cursorWidthPx ?? 1;
  const cursorHeight = options.cursorHeight ?? '1em';
  const cursorVerticalAlign = options.cursorVerticalAlign ?? 'text-bottom';
  const cursorFadeMs = options.cursorFadeMs ?? 120;
  const appendEllipsis = options.appendEllipsis ?? true;
  const ellipsisText = options.ellipsisText ?? '...';
  const ellipsisPauseMs = options.ellipsisPauseMs ?? 0;

  // If user prefers reduced motion, render instantly
  if (getReducedMotionPreferred()) {
    const needsEllipsis = appendEllipsis && ellipsisText && !text.trimEnd().endsWith(ellipsisText);
    element.textContent = needsEllipsis ? text + ellipsisText : text;
    return;
  }

  // If already aborted or element is gone, render final text and exit
  if (signal?.aborted || !element.isConnected) {
    element.textContent = text;
    return;
  }

  element.textContent = '';

  // Create dedicated text node and blinking cursor element
  const textNode = document.createTextNode('');
  const cursorEl = document.createElement('span');
  cursorEl.textContent = '';
  cursorEl.setAttribute('aria-hidden', 'true');
  cursorEl.style.display = 'inline-block';
  cursorEl.style.width = `${cursorWidthPx}px`;
  cursorEl.style.height = cursorHeight;
  cursorEl.style.background = 'currentColor';
  cursorEl.style.verticalAlign = cursorVerticalAlign;
  cursorEl.style.opacity = '1';
  cursorEl.style.transition = `opacity ${cursorFadeMs}ms linear`;
  element.append(textNode, cursorEl);

  // terminal cursor
  cursorEl.style.width = '2px';

  let blinkVisible = true;
  const blinkIntervalId = window.setInterval(() => {
    // Auto-cleanup if element is gone or aborted
    if (signal?.aborted || !element.isConnected) {
      cleanup();
      return;
    }
    // Toggle visibility instead of layout-affecting changes
    blinkVisible = !blinkVisible;
    cursorEl.style.opacity = blinkVisible ? '1' : '0';
  }, cursorBlinkMs);

  const cleanup = () => {
    window.clearInterval(blinkIntervalId);
    if (cursorEl.isConnected) cursorEl.remove();
  };

  // Brief pre-type blink
  if (preTypeDelayMs > 0) {
    if (signal?.aborted || !element.isConnected) {
      element.textContent = text;
      cleanup();
      return;
    }
    await sleep(preTypeDelayMs);
  }

  for (const ch of text) {
    if (signal?.aborted || !element.isConnected) {
      element.textContent = text;
      cleanup();
      return;
    }

    textNode.data += ch;

    const delay = baseDelayMs + Math.floor(Math.random() * (jitterMs + 1));
    await sleep(delay);
  }

  // Optional ellipsis after a brief pause
  if (appendEllipsis && ellipsisText && !text.trimEnd().endsWith(ellipsisText)) {
    if (signal?.aborted || !element.isConnected) {
      element.textContent = text;
      cleanup();
      return;
    }
    if (ellipsisPauseMs > 0) {
      await sleep(ellipsisPauseMs);
    }
    for (const ch of ellipsisText) {
      if (signal?.aborted || !element.isConnected) {
        element.textContent = text + ellipsisText;
        cleanup();
        return;
      }
      textNode.data += ch;
      const delay = baseDelayMs + Math.floor(Math.random() * (jitterMs + 1));
      await sleep(delay);
    }
  }

  // After finishing: if keepCursorMs is provided, blink for that long then remove.
  // Otherwise, keep cursor blinking indefinitely until element disconnects or signal aborts.
  if (typeof keepCursorMs === 'number' && keepCursorMs >= 0) {
    await sleep(keepCursorMs);
    cleanup();
  }
}

export default typedText;
