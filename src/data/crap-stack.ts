export interface Sticker {
	name: string;
	/** Its art. */
	source: string;
	/** Its token's colour. */
	color: string;
	/** How far the art is scaled to fill its token. */
	artScale: number;
}

/** Crap stack's pieces, smallest first: two of one merge into the next. */
export const stickers: Sticker[] = [
	{ name: 'test tube', source: '/images/crap-stack/test-tube.webp', color: '#b9e4f3', artScale: 1.12 },
	{ name: 'wine', source: '/images/crap-stack/wine.webp', color: '#f2b6c4', artScale: 1.14 },
	{ name: 'milk', source: '/images/crap-stack/milk.webp', color: '#eee6d7', artScale: 1.1 },
	{ name: 'popcorn', source: '/images/crap-stack/popcorn.webp', color: '#f5cf61', artScale: 1.02 },
	{ name: 'wink', source: '/images/crap-stack/wink.webp', color: '#ef9c43', artScale: 1.08 },
	{ name: 'blinky', source: '/images/crap-stack/blinky.webp', color: '#a9d5f3', artScale: 0.92 },
	{ name: 'brows', source: '/images/crap-stack/brows.webp', color: '#cbb99c', artScale: 1.02 },
	{ name: 'hair', source: '/images/crap-stack/hair.webp', color: '#f3e86a', artScale: 0.98 },
	{ name: 'spiral', source: '/images/crap-stack/spiral.webp', color: '#d8a5cf', artScale: 1.04 },
	{ name: 'robot', source: '/images/crap-stack/robot.webp', color: '#91a6b7', artScale: 1.03 },
];
