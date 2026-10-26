import catalog from '../../artwork/app-icons/catalog.json';

export interface IconCredit {
	text: string;
	name: string;
	url: string;
}

export interface IconVariant {
	id: string;
	/** `<collection>-<variant>`: its card's id, its inspector panel, and its download's file name. */
	key: string;
	name: string;
	description: string;
	/** Public directory holding icon-{size}.png previews. */
	previewBase: string;
	/** Public path of the finished .icns file. */
	download: string;
	/** Filename suggested to the browser on download. */
	fileName: string;
}

export interface IconCollection {
	id: string;
	name: string;
	url: string;
	credits: IconCredit[];
	variants: IconVariant[];
}

/**
 * Shared with the offline packaging script in artwork/app-icons; the site reads only finished files.
 * Each variant publishes to public/<publicDir>/<collection>/<variant>/ and <variant>.icns beside it.
 */
const iconCollections: IconCollection[] = catalog.collections.map((app) => ({
	...app,
	variants: app.variants.map((icon) => {
		const base = `/${catalog.publicDir}/${app.id}/${icon.id}`;
		const key = `${app.id}-${icon.id}`;
		return { ...icon, key, previewBase: base, download: `${base}.icns`, fileName: `${key}.icns` };
	}),
}));

/** Every variant with its collection, in catalog order. */
export const iconEntries = iconCollections.flatMap((app) => app.variants.map((icon) => ({ app, icon })));
export type IconEntry = (typeof iconEntries)[number];

/** Every preview PNG published beside each .icns. */
const PREVIEW_SIZES = [16, 32, 64, 128, 256, 512, 1024] as const;
export type PreviewSize = (typeof PREVIEW_SIZES)[number];

export function previewSrc(icon: IconVariant, size: PreviewSize): string {
	return `${icon.previewBase}/icon-${size}.png`;
}

/** Width descriptors for icons drawn at a responsive size. */
export function responsivePreviewSet(icon: IconVariant): string {
	return PREVIEW_SIZES.filter((size) => size >= 128)
		.map((size) => `${previewSrc(icon, size)} ${size}w`)
		.join(', ');
}

/** 1× and 2× sources for an icon drawn at exactly `size` CSS pixels, as macOS picks them from the .icns. */
export function actualSizeSet(icon: IconVariant, size: Extract<PreviewSize, 16 | 32 | 64 | 128>): string {
	return `${previewSrc(icon, size)} 1x, ${previewSrc(icon, (size * 2) as PreviewSize)} 2x`;
}
