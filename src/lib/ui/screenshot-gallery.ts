import { openDialog } from './dialog';

type ScreenshotSource = {
	src: string;
	alt: string;
};

const initializedGalleries = new WeakSet<HTMLElement>();

function fadeInScreenshots(root: HTMLElement): void {
	const screenshots = root.querySelectorAll<HTMLImageElement>('[data-screenshot]');
	screenshots.forEach((img, i) => {
		const fadeIn = () => {
			window.setTimeout(() => {
				img.classList.remove('opacity-0');
				img.classList.add('opacity-100');
			}, i * 100);
		};

		if (img.complete) {
			fadeIn();
		} else {
			img.addEventListener('load', fadeIn, { once: true });
		}
	});
}

function initScreenshotGallery(root: HTMLElement): void {
	if (initializedGalleries.has(root)) return;
	initializedGalleries.add(root);

	const dialogId = root.dataset.dialogId;
	const toggleName = root.dataset.toggleName;
	const dialogImg = root.querySelector<HTMLImageElement>('[data-screenshot-dialog-img]');
	const toggleGroup = root.querySelector<HTMLElement>('[data-toggle-group]');
	const screenshotTriggers = Array.from(
		root.querySelectorAll<HTMLButtonElement>('[data-screenshot-trigger]')
	);

	if (!dialogId || !toggleName || !dialogImg || screenshotTriggers.length === 0) return;

	const screenshotSources = new Map<string, ScreenshotSource>();
	screenshotTriggers.forEach((trigger) => {
		const id = trigger.dataset.id;
		const src = trigger.dataset.src;
		const alt = trigger.dataset.alt;
		if (!id || !src || !alt) return;
		screenshotSources.set(id, { src, alt });
	});

	const setScreenshot = (id: string) => {
		const source = screenshotSources.get(id);
		if (!source) return;
		dialogImg.src = source.src;
		dialogImg.alt = source.alt;
	};

	screenshotTriggers.forEach((trigger) => {
		trigger.addEventListener('click', () => {
			const id = trigger.dataset.id;
			if (!id) return;

			setScreenshot(id);
			document.dispatchEvent(new CustomEvent('toggle-set-value', {
				detail: { name: toggleName, value: id }
			}));
			openDialog(dialogId);
		});
	});

	toggleGroup?.addEventListener('toggle-change', ((e: CustomEvent<{ value: string }>) => {
		setScreenshot(e.detail.value);
	}) as EventListener);

	fadeInScreenshots(root);
}

export function initScreenshotGalleries(): void {
	const galleries = document.querySelectorAll<HTMLElement>('[data-screenshot-gallery]');
	galleries.forEach((gallery) => initScreenshotGallery(gallery));
}
