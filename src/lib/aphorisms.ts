import type { BlonkyEmote } from './blonky/types';

export type Aphorism = {
	text: string;
	weight?: number;
	reactions?: readonly BlonkyEmote[];
};

const aphorisms: Aphorism[] = [
	{ text: 'deeply, unfathomably, senselessly, terribly', weight: 3 },
	{ text: 'everything on earth with you', reactions: ['wink', 'confirm'] },
	{ text: 'in case you ever foolishly forget', reactions: ['skeptical', 'wink'] },
	{ text: 'obscure popular culture' },
	{ text: 'untenable but inalterable' },
	{ text: "it's got lots to do with magnets", reactions: ['shrug', 'confirm'] },
	{ text: 'on its last legs', reactions: ['sigh', 'nod-off'] },
	{ text: 'better days to come', reactions: ['wink', 'confirm'] },
	{ text: 'please clap', reactions: ['skeptical', 'sigh'] },
	{ text: 'smile and wave', reactions: ['wave'] },
	{ text: 'a dead dream', reactions: ['sigh', 'cry'] },
	{ text: "it doesn't even matter", reactions: ['shrug', 'sigh'] },
	{ text: 'same as it ever was', reactions: ['smh', 'confirm'] },
	{ text: 'and the days go by', reactions: ['nod-off', 'sigh'] },
	{ text: 'powered by quiet noise', reactions: ['shudder', 'skeptical'] },
	{ text: 'product of lost imagination', reactions: ['shrug', 'sigh'] },
	{ text: 'website for u', reactions: ['wink', 'confirm'] },
	{ text: 'website for no one', reactions: ['shrug', 'cry'] },
	{ text: 'website for to comfort', reactions: ['wink', 'confirm'] },
	{ text: 'nearing the end', reactions: ['shudder', 'sigh'] },
	{ text: 'mediocre at best', reactions: ['shrug', 'skeptical'] },
	{ text: "dad's favorite", reactions: ['wink', 'deny'] },
	{ text: 'shut up kiss me hold me tight', reactions: ['wink', 'shudder'] },
	{ text: 'obsessive denial of reality', reactions: ['deny', 'smh'] },
	{ text: 'hello, friend', reactions: ['wave', 'confirm'] },
	{ text: 'here to remember for u', reactions: ['confirm', 'wink'] },
	{ text: 'uniquely, completely, imperially' },
	{ text: 'despite all the gin', reactions: ['shudder', 'shrug'] },
	{ text: 'profoundly meaningless', reactions: ['shrug', 'nod-off'] },
	{ text: "i'm happier when ur gone", reactions: ['deny', 'skeptical'] },
];

export function pickAphorism(excludeText?: string): Aphorism | null {
	const valid = aphorisms.filter((i) => (i.weight ?? 1) > 0 && i.text !== excludeText);
	if (valid.length === 0) return null;

	const total = valid.reduce((sum, i) => sum + (i.weight ?? 1), 0);
	const r = getRandom() * total;

	let acc = 0;
	for (const item of valid) {
		acc += item.weight ?? 1;
		if (r < acc) return item;
	}
	return valid[valid.length - 1];
}

function getRandom(): number {
	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		const buf = new Uint32Array(1);
		crypto.getRandomValues(buf);
		return buf[0] / 2 ** 32;
	}
	return Math.random();
}

export default aphorisms;
