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

type CursorSession = {
  cleanup: () => void;
  textNode: Text;
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

function getDelay(baseDelayMs: number, jitterMs: number): number {
  return baseDelayMs + Math.floor(Math.random() * (jitterMs + 1));
}

function getFinalText(text: string, options: TypedTextOptions): string {
  const appendEllipsis = options.appendEllipsis ?? true;
  const ellipsisText = options.ellipsisText ?? '...';
  const needsEllipsis = appendEllipsis && ellipsisText && !text.trimEnd().endsWith(ellipsisText);
  return needsEllipsis ? text + ellipsisText : text;
}

function shouldStop(element: HTMLElement, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || !element.isConnected);
}

function startCursor(
  element: HTMLElement,
  initialText: string,
  options: TypedTextOptions
): CursorSession {
  const signal = options.signal;
  const cursorBlinkMs = options.cursorBlinkMs ?? 600;
  const cursorWidthPx = options.cursorWidthPx ?? 2;
  const cursorHeight = options.cursorHeight ?? '1em';
  const cursorVerticalAlign = options.cursorVerticalAlign ?? 'text-bottom';
  const cursorFadeMs = options.cursorFadeMs ?? 120;

  element.textContent = '';

  const textNode = document.createTextNode(initialText);
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

  let blinkVisible = true;
  const blinkIntervalId = window.setInterval(() => {
    if (shouldStop(element, signal)) {
      cleanup();
      return;
    }

    blinkVisible = !blinkVisible;
    cursorEl.style.opacity = blinkVisible ? '1' : '0';
  }, cursorBlinkMs);

  const cleanup = () => {
    window.clearInterval(blinkIntervalId);
    if (cursorEl.isConnected) cursorEl.remove();
  };

  return { cleanup, textNode };
}

async function typeIntoSession(
  element: HTMLElement,
  session: CursorSession,
  text: string,
  options: TypedTextOptions
): Promise<boolean> {
  const baseDelayMs = options.baseDelayMs ?? 28;
  const jitterMs = options.jitterMs ?? 32;
  const signal = options.signal;

  for (const ch of text) {
    if (shouldStop(element, signal)) return false;

    session.textNode.data += ch;
    await sleep(getDelay(baseDelayMs, jitterMs));
  }

  return !shouldStop(element, signal);
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

  const signal = options.signal;
  const preTypeDelayMs = options.preTypeDelayMs ?? 1200; // longer pre-type pause
  const keepCursorMs = options.keepCursorMs; // undefined => keep blinking indefinitely
  const ellipsisText = options.ellipsisText ?? '...';
  const ellipsisPauseMs = options.ellipsisPauseMs ?? 0;
  const finalText = getFinalText(text, options);

  // If user prefers reduced motion, render instantly
  if (getReducedMotionPreferred()) {
    element.textContent = finalText;
    return;
  }

  // If already aborted or element is gone, stop without mutating the element.
  if (shouldStop(element, signal)) {
    return;
  }

  const session = startCursor(element, '', options);

  // Brief pre-type blink
  if (preTypeDelayMs > 0) {
    if (shouldStop(element, signal)) {
      session.cleanup();
      return;
    }
    await sleep(preTypeDelayMs);
  }

  if (!(await typeIntoSession(element, session, text, options))) {
    session.cleanup();
    return;
  }

  // Optional ellipsis after a brief pause
  if (finalText !== text) {
    if (shouldStop(element, signal)) {
      session.cleanup();
      return;
    }
    if (ellipsisPauseMs > 0) {
      await sleep(ellipsisPauseMs);
    }
    if (!(await typeIntoSession(element, session, ellipsisText, options))) {
      session.cleanup();
      return;
    }
  }

  // After finishing: if keepCursorMs is provided, blink for that long then remove.
  // Otherwise, keep cursor blinking indefinitely until element disconnects or signal aborts.
  if (typeof keepCursorMs === 'number' && keepCursorMs >= 0) {
    await sleep(keepCursorMs);
    session.cleanup();
  }
}

export async function eraseTypedText(
  element: HTMLElement | null,
  options: TypedTextOptions = {}
): Promise<void> {
  if (!element) return;

  const signal = options.signal;
  const eraseDelayMs = 16;
  const eraseJitterMs = 18;

  if (getReducedMotionPreferred() || shouldStop(element, signal)) {
    element.textContent = '';
    return;
  }

  const session = startCursor(element, element.innerText || element.textContent || '', options);
  const text = session.textNode.data;

  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (shouldStop(element, signal)) {
      session.cleanup();
      return;
    }

    await sleep(getDelay(eraseDelayMs, eraseJitterMs));
    session.textNode.data = text.slice(0, i);
  }

  session.cleanup();
}

export default typedText;
