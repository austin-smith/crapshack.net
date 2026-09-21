export async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through to fallback
    }

    // Keep the fallback from stealing focus or discarding a text selection.
    const activeElement = document.activeElement;
    const selection = window.getSelection();
    const ranges = selection
        ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
        : [];
    const textarea = document.createElement('textarea');
    try {
        textarea.value = text;
        textarea.readOnly = true;
        // Avoid scrolling to bottom
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '0';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus({ preventScroll: true });
        textarea.select();
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        textarea.remove();
        if (activeElement instanceof HTMLElement && activeElement.isConnected) {
            activeElement.focus({ preventScroll: true });
        }
        if (selection && ranges.length > 0) {
            selection.removeAllRanges();
            ranges.forEach((range) => selection.addRange(range));
        }
    }
}

export function toAbsoluteUrl(maybeRelativeUrl: string): string {
    try {
        const url = new URL(maybeRelativeUrl, window.location.origin);
        // Strip query params and hash to return only the base path
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return maybeRelativeUrl;
    }
}
