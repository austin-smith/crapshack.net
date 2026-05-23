export type Aphorism = {
	text: string;
	weight?: number;
};

const aphorisms: Aphorism[] = [
	{ text: 'deeply, unfathomably, senselessly, terribly', weight: 3 },
	{ text: 'everything on earth with you' },
	{ text: 'in case you ever foolishly forget' },
	{ text: 'obscure popular culture' },
	{ text: 'untenable but inalterable' },
	{ text: "it's got lots to do with magnets" },
	{ text: 'on its last legs' },
	{ text: 'better days to come' },
	{ text: 'please clap' },
	{ text: 'smile and wave' },
	{ text: 'a dead dream' },
	{ text: "it doesn't even matter" },
	{ text: 'same as it ever was' },
	{ text: 'and the days go by' },
	{ text: 'powered by quiet noise' },
	{ text: 'product of lost imagination' },
	{ text: 'website for u' },
	{ text: 'website for no one' },
	{ text: 'website for to comfort' },
	{ text: 'nearing the end' },
	{ text: 'mediocre at best' },
	{ text: "dad's favorite" },
	{ text: 'shut up kiss me hold me tight' },
	{ text: 'obsessive denial of reality' },
	{ text: 'hello, friend' },
	{ text: 'here to remember for u' },
	{ text: 'uniquely, completely, imperially' },
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
