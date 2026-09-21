import type { Aphorism } from '../aphorisms';
import type { BlonkyEmote } from './types';

const DEFAULT_REACTIONS: readonly BlonkyEmote[] = ['confirm', 'shrug', 'skeptical', 'wink'];
const IMPATIENT_REACTIONS: readonly BlonkyEmote[] = ['skeptical', 'smh', 'deny'];

export function pickBlonkyReaction(
	thought: Aphorism | undefined,
	previous?: BlonkyEmote,
	pokes = 0,
	random = Math.random,
): BlonkyEmote {
	const pool = pokes >= 3 ? IMPATIENT_REACTIONS : thought?.reactions ?? DEFAULT_REACTIONS;
	const choices = pool.filter((kind) => kind !== previous);
	const available = choices.length ? choices : DEFAULT_REACTIONS.filter((kind) => kind !== previous);
	return available[Math.min(available.length - 1, Math.max(0, Math.floor(random() * available.length)))];
}
