interface Shortcut {
	/** KeyboardEvent.key, compared lowercase. */
	key: string;
	/** Requires Cmd on Apple platforms, Ctrl elsewhere. */
	mod?: boolean;
	/** What it does. Contextual guards (is a dialog open?) belong in here. */
	run: () => void;
}

const registry: Shortcut[] = [];
let listening = false;

function isTyping(target: EventTarget | null): boolean {
	return (
		target instanceof Element &&
		target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null
	);
}

// An open dropdown holds the keyboard until it closes, as it does the pointer.
function isDropdownOpen(): boolean {
	return document.documentElement.hasAttribute('data-dropdown-open');
}

function onKeyDown(event: KeyboardEvent): void {
	if (event.defaultPrevented || isTyping(event.target) || isDropdownOpen()) return;

	const mod = event.metaKey || event.ctrlKey;
	const key = event.key.toLowerCase();

	for (const shortcut of registry) {
		if (key !== shortcut.key) continue;
		if (Boolean(shortcut.mod) !== mod) continue;
		// cmd+shift+b is the browser's bookmarks bar, so extra modifiers pass through.
		if (event.altKey || event.shiftKey) continue;
		event.preventDefault();
		shortcut.run();
		return;
	}
}

export function registerShortcut(shortcut: Shortcut): void {
	registry.push(shortcut);
	if (listening) return;
	document.addEventListener('keydown', onKeyDown);
	listening = true;
}
