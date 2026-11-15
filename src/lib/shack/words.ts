// Everything the game says out loud. Lines use names or "they", never a
// guessed pronoun, and never raise their voice.

export function pick<T>(items: readonly T[], random = Math.random): T {
	return items[Math.floor(random() * items.length)];
}

export function fill(template: string, name: string): string {
	return template.replaceAll('{name}', name);
}

export const NAMES = [
	'dale', 'marnie', 'gus', 'pat', 'wendell', 'bev', 'lou', 'ruth', 'otis', 'dot',
	'hank', 'fern', 'sal', 'ida', 'merv', 'jo', 'al', 'tess', 'norm', 'viv',
	'clem', 'rhoda', 'ned', 'opal', 'stu', 'bea', 'cy', 'mo', 'lorne', 'edie',
] as const;

export const ARRIVALS = [
	'{name} moved in. they brought a spoon.',
	'{name} is here now. nobody asked.',
	'{name} arrived with no luggage and no questions.',
	'{name} moved in. they heard it was fine here.',
	'{name} drifted in. they seem okay about it.',
	'{name} showed up. they have no expectations.',
	'{name} is new. they already look tired.',
] as const;

export const CHATTER = [
	'hm.',
	'is that a door.',
	'it\'ll probably be fine.',
	'i used to have a house.',
	'don\'t mind me.',
	'what\'s the plan.',
	'nice weather. for now.',
	'i\'m not complaining.',
	'you\'re doing great. probably.',
	'is it going to rain.',
	'i can hold my breath if it helps.',
	'i like it here, mostly.',
	'the sky looks like it wants something.',
	'no rush.',
	'i\'ll just stand here.',
	'that looks sturdy. ish.',
] as const;

export const BONKED = [
	'ow.',
	'that\'s fine.',
	'i\'m okay.',
	'noted.',
] as const;

export const SHELTERING = [
	'i\'ll be here.',
	'this is my spot.',
	'wake me when it\'s over.',
	'here goes.',
	'cozy. i guess.',
] as const;

export const RESULT_LINES = {
	dry: [
		'{name} stayed dry. they won\'t mention it.',
		'{name} slept fine. suspiciously fine.',
		'{name} is dry and mildly impressed.',
		'{name} stayed dry. nobody say anything.',
	],
	damp: [
		'{name} is damp. they\'re not talking about it.',
		'{name} got a little wet. it\'s fine. it\'s fine.',
		'{name} is damp around the edges.',
	],
	soaked: [
		'{name} is soaked through and reconsidering things.',
		'{name} is completely wet. they\'re being quiet about it.',
		'{name} is soaked. they wrung out a sock at you.',
	],
	blown: [
		'{name} blew away. they looked mildly let down.',
		'{name} left on the wind. no forwarding address.',
		'{name} got carried off. they waved, sort of.',
	],
	left: [
		'{name} has had enough. they\'re going somewhere with walls.',
		'{name} packed their spoon and left.',
		'{name} moved out. they said it wasn\'t you. it was a little you.',
	],
} as const;

export const JUNK_ARRIVAL = [
	'junk washed up. it always does.',
	'more junk. the sky provides.',
	'some things fell out of the sky. help yourself.',
	'junk delivery. no signature required.',
] as const;

export const LOST_JUNK = [
	'the {name} left the island.',
	'the {name} is gone now.',
	'the {name} fell off. it happens.',
] as const;

export const NAILED = [
	'nailed.',
	'that\'s not going anywhere.',
	'nailed. probably.',
] as const;

export const CANT_NAIL = [
	'nothing to nail it to.',
	'it has to be touching something.',
] as const;

export const NO_NAILS = [
	'out of nails.',
	'no nails left. more tomorrow.',
] as const;

export const NAILED_DOWN = [
	'it\'s nailed down.',
	'that one\'s staying put.',
] as const;

export const GAME_OVER = [
	'everyone left.',
	'nobody lives here anymore.',
	'the shack is quiet now.',
] as const;

export const GAME_OVER_SUB = [
	'the shack remains. sort of.',
	'it was a good shack, in places.',
	'the junk will be fine.',
] as const;

export const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

// `angle` is the direction the wind blows from, in radians, clockwise from north.
export function compassName(angle: number): string {
	const turn = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
	return COMPASS[Math.round(turn * 8) % 8];
}

export function strengthWord(strength: number): string {
	if (strength < 0.35) return 'a breeze';
	if (strength < 0.65) return 'wind';
	if (strength < 0.95) return 'strong wind';
	if (strength < 1.25) return 'a gale';
	return 'unreasonable wind';
}
