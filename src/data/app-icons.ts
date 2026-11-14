import catalog from '../../artwork/app-icons/catalog.json';

export interface IconCredit {
	text: string;
	name: string;
	url: string;
}

export interface Icon {
	id: string;
	/** `<collection>-<variant>`, or a standalone icon's own id: its card's id, its inspector panel, and its download's file name. */
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

/** An app's set of icons. */
export interface IconCollection {
	id: string;
	name: string;
	/** The app's page: a path on this site, which opens in place, or another site's URL. */
	url: string;
}

export interface IconEntry {
	icon: Icon;
	/** The collection it belongs to; a standalone icon belongs to no app and has none. */
	app?: IconCollection;
	/** Owners of the artwork it adapts; none for our own apps' icons. */
	credits?: IconCredit[];
}

/**
 * Shared with the offline packaging script in artwork/app-icons; the site reads only finished files.
 * A collection's variant publishes to public/<publicDir>/<collection>/<variant>/ and <variant>.icns beside it;
 * a standalone icon to public/<publicDir>/<icon>/ and <icon>.icns.
 */
function published(icon: { id: string; name: string; description: string }, collection?: string): Icon {
	const key = collection ? `${collection}-${icon.id}` : icon.id;
	const base = `/${catalog.publicDir}/${collection ? `${collection}/` : ''}${icon.id}`;
	return { ...icon, key, previewBase: base, download: `${base}.icns`, fileName: `${key}.icns` };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en');

/** Icons that belong to no app. */
const standaloneIcons: { id: string; name: string; description: string; credits?: IconCredit[] }[] = catalog.icons;

/** Every icon, in gallery order: apps A–Z with each app's icons A–Z, then the standalone icons A–Z. */
export const iconEntries: IconEntry[] = [
	...catalog.collections.toSorted(byName).flatMap(({ id, name, url, credits, variants }) =>
		variants.toSorted(byName).map((icon): IconEntry => ({ icon: published(icon, id), app: { id, name, url }, credits })),
	),
	...standaloneIcons.toSorted(byName).map((icon): IconEntry => ({ icon: published(icon), credits: icon.credits })),
];

/** Every preview PNG published beside each .icns. */
const PREVIEW_SIZES = [16, 32, 64, 128, 256, 512, 1024] as const;
export type PreviewSize = (typeof PREVIEW_SIZES)[number];

export function previewSrc(icon: Icon, size: PreviewSize): string {
	return `${icon.previewBase}/icon-${size}.png`;
}

/** Width descriptors for icons drawn at a responsive size. */
export function responsivePreviewSet(icon: Icon): string {
	return PREVIEW_SIZES.filter((size) => size >= 128)
		.map((size) => `${previewSrc(icon, size)} ${size}w`)
		.join(', ');
}

/** 1× and 2× sources for an icon drawn at exactly `size` CSS pixels, as macOS picks them from the .icns. */
export function actualSizeSet(icon: Icon, size: Extract<PreviewSize, 16 | 32 | 64 | 128>): string {
	return `${previewSrc(icon, size)} 1x, ${previewSrc(icon, (size * 2) as PreviewSize)} 2x`;
}
