/**
 * Whether the weather piles up: settling on things, and pooling along the
 * bottom. Off unless chosen. Everything showing weather follows it live,
 * the settings previews as well as the page.
 */

const STORAGE_KEY = 'crapshack:sky-accumulates';
const CHANGE_EVENT = 'weather-accumulation-change';

export function readAccumulation(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === '1';
	} catch {
		// Storage unavailable: it stays off.
		return false;
	}
}

export function setAccumulation(on: boolean): void {
	try {
		localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
	} catch {
		// Storage unavailable: it lasts for this page only.
	}
	document.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { on } }));
}

/** Calls `changed` whenever accumulation is turned on or off. */
export function onAccumulationChange(changed: (on: boolean) => void): void {
	document.addEventListener(CHANGE_EVENT, ((event: CustomEvent<{ on: boolean }>) => {
		changed(event.detail.on);
	}) as EventListener);
}
