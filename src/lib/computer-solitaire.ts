export type ComputerSolitaireScoringRow = {
	move: string;
	points: string;
	note?: string;
};

export type ComputerSolitaireTerm = {
	term: string;
	definition: string;
};

export type ComputerSolitaireVariant = {
	id: string;
	name: string;
	description: string;
	objective: string;
	rules: string[];
	scoring: ComputerSolitaireScoringRow[];
	scoringNotes: string[];
	terms: ComputerSolitaireTerm[];
};

export const computerSolitaireVariants: ComputerSolitaireVariant[] = [
	{
		id: 'klondike',
		name: 'Klondike',
		description: 'Classic Solitaire, with 1-card and 3-card draw modes.',
		objective: 'Move all 52 cards to the four foundations, building each suit from Ace to King.',
		rules: [
			'Deal seven tableau piles: the first holds one card, the second two, and so on to seven, with only each pile\'s top card face up. The rest of the deck forms the stock.',
			'Build tableau piles down in alternating colors.',
			'Move Aces to the foundations as they appear, then build each suit up to King.',
			'Only Kings can fill an empty tableau pile.',
			'In 1-card draw, flip one stock card at a time. In 3-card draw, flip three.',
			'When the stock is empty, recycle the waste back into it and keep going.',
		],
		scoring: [
			{ move: 'Waste to Tableau', points: '+5' },
			{ move: 'Waste to Foundation', points: '+10' },
			{ move: 'Tableau to Foundation', points: '+10' },
			{ move: 'Turn over Tableau card', points: '+5' },
			{ move: 'Foundation to Tableau', points: '-15' },
			{ move: 'Recycle waste in 1-card draw', points: '-100' },
		],
		scoringNotes: [
			'Winning adds a time bonus: up to 600 in 1-card draw or 900 in 3-card draw.',
			'The bonus drops by 1 point per second. Score cannot go below 0.',
		],
		terms: [
			{ term: 'Tableau', definition: 'The seven play piles where you build down in alternating colors.' },
			{ term: 'Foundations', definition: 'Four suit piles built up from Ace to King.' },
			{ term: 'Stock', definition: 'The face-down draw pile.' },
			{ term: 'Waste', definition: 'Face-up cards drawn from the stock — only the top card is playable.' },
			{ term: 'Draw mode', definition: 'How many cards you draw from the stock at a time: 1-card or 3-card.' },
		],
	},
	{
		id: 'spider',
		name: 'Spider',
		description: 'Build full King-to-Ace suit runs across ten piles, using two decks composed of 1, 2, or 4 suits.',
		objective: 'Complete eight King-to-Ace runs of one suit and clear them from the tableau.',
		rules: [
			'Deal two decks into ten tableau piles, with only each pile\'s top card face up. The remaining 50 cards form the stock.',
			'A card can move onto any card one rank higher, regardless of suit. Nothing can be placed on an Ace.',
			'Several cards move together only as a face-up run of one suit in descending order.',
			'Any card or movable run can fill an empty pile.',
			'Tap the stock to deal one face-up card onto every pile. You cannot deal while any pile is empty.',
			'A completed King-to-Ace run of one suit leaves the tableau automatically.',
			'Face-down cards turn face up when they become the top of a pile.',
		],
		scoring: [
			{ move: 'Start of game', points: '500', note: 'Spider starts every game with this balance.' },
			{ move: 'Any move or stock deal', points: '-1' },
			{ move: 'Complete a run', points: '+100' },
			{ move: 'Win time bonus', points: '+900', note: 'Reduced by elapsed time.' },
		],
		scoringNotes: ['The time bonus drops by 1 point per second. Score cannot go below 0.'],
		terms: [
			{ term: 'Tableau', definition: 'The ten play piles where you build down, regardless of suit.' },
			{ term: 'Run', definition: 'Face-up cards of one suit in descending order — only runs move together.' },
			{ term: 'Completed run', definition: 'A full King-to-Ace run of one suit. Eight complete the game.' },
			{ term: 'Stock', definition: 'The face-down pile that deals one card onto every tableau pile at once.' },
			{ term: 'Suits', definition: 'The difficulty setting: the two decks are made of 1, 2, or 4 suits, always 104 cards.' },
		],
	},
	{
		id: 'freecell',
		name: 'FreeCell',
		description: 'All 52 cards are dealt face up, with four free cells that each hold one card.',
		objective: 'Move all 52 cards to the four foundations, building each suit from Ace to King.',
		rules: [
			'Deal all 52 cards face up into eight cascades: four with 7 cards and four with 6 cards.',
			'Build cascades down in alternating colors.',
			'Use the four free cells as temporary storage for one card each.',
			'Build the foundations up by suit from Ace to King.',
			'Any card can move to an empty cascade.',
			'Ordered runs can move together when enough free cells and empty cascades are available.',
		],
		scoring: [
			{ move: 'Move cards', points: '0', note: 'FreeCell tracks time and completion.' },
			{ move: 'Win time bonus', points: '+900', note: 'Reduced by elapsed time.' },
		],
		scoringNotes: ['The time bonus drops by 1 point per second. Score cannot go below 0.'],
		terms: [
			{ term: 'Cascade', definition: 'One of eight tableau columns where all cards are face up.' },
			{ term: 'Free Cell', definition: 'A temporary single-card holding slot (four total).' },
			{ term: 'Foundations', definition: 'Four suit piles built up from Ace to King.' },
			{ term: 'Supermove', definition: 'A multi-card move made possible by open free cells and empty cascades.' },
		],
	},
	{
		id: 'pyramid',
		name: 'Pyramid',
		description: 'Remove pairs of exposed cards that total 13 to clear a 28-card pyramid.',
		objective: 'Remove all 28 cards from the pyramid. The stock and waste do not need to be empty.',
		rules: [
			'Deal 28 cards face up into a seven-row pyramid. The remaining 24 cards form the stock.',
			'Remove pairs of exposed cards whose ranks total 13. Ace counts 1, Jack 11, and Queen 12.',
			'Kings count 13 on their own and are removed singly.',
			'A card is exposed once neither card covering it remains.',
			'Tap the stock to draw one card to the waste. The top waste card can pair with exposed pyramid cards.',
			'When the stock runs out, recycle the waste back into it at most twice.',
		],
		scoring: [
			{ move: 'Remove a pair', points: '+10' },
			{ move: 'Remove a King', points: '+5' },
			{ move: 'Win time bonus', points: '+900', note: 'Reduced by elapsed time.' },
		],
		scoringNotes: ['The time bonus drops by 1 point per second. Score cannot go below 0.'],
		terms: [
			{ term: 'Pyramid', definition: 'Twenty-eight face-up cards in seven overlapping rows.' },
			{ term: 'Stock', definition: 'The face-down draw pile.' },
			{ term: 'Waste', definition: 'Face-up cards drawn from the stock — only the top card is playable.' },
			{ term: 'Discard', definition: 'Where removed pairs and Kings go — cards there are out of play.' },
			{ term: 'Recycle', definition: 'Turning the waste back into the stock. Pyramid allows two recycles.' },
		],
	},
	{
		id: 'tripeaks',
		name: 'TriPeaks',
		description: 'Play uncovered cards one rank above or below the waste to clear three peaks.',
		objective: 'Clear all 28 peak cards. The stock and waste do not need to be empty.',
		rules: [
			'Deal 28 cards into three overlapping peaks, with three face-down rows under a face-up base row of ten.',
			'Play any uncovered card one rank above or below the top waste card, regardless of suit.',
			'Ranks wrap around: a King plays on an Ace and an Ace plays on a King or a Two.',
			'A face-down card flips face up once both cards covering it are removed.',
			'Tap the stock to flip one card onto the waste. You get one pass through the stock.',
		],
		scoring: [
			{ move: 'Discard onto the waste', points: '+1…', note: 'Each consecutive discard is worth one more.' },
			{ move: 'Flip a stock card', points: '-5', note: 'Also resets the chain.' },
			{ move: 'Clear a peak', points: '+15' },
			{ move: 'Clear the board', points: '+30', note: 'Replaces the third peak bonus.' },
			{ move: 'Win time bonus', points: '+900', note: 'Reduced by elapsed time.' },
		],
		scoringNotes: ['The time bonus drops by 1 point per second. Score cannot go below 0.'],
		terms: [
			{ term: 'Peaks', definition: 'Twenty-eight cards in three overlapping peaks.' },
			{ term: 'Stock', definition: 'The face-down draw pile. You get one pass through it.' },
			{ term: 'Waste', definition: 'The growing face-up pile — play any uncovered card one rank above or below its top.' },
			{ term: 'Chain', definition: 'Consecutive discards without flipping the stock.' },
		],
	},
	{
		id: 'golf',
		name: 'Golf',
		description: 'Play column cards one rank above or below the waste, scored across a nine-hole match where lower is better.',
		objective: 'Clear the 35 column cards in as few strokes as possible across a nine-hole match.',
		rules: [
			'Deal 35 cards face up into seven columns of five. One card starts the waste, and the remaining 16 form the stock.',
			'Play any exposed column card one rank above or below the top waste card, regardless of suit.',
			'Ranks never wrap: an Ace connects only to a Two, and a King only to a Queen.',
			'Nothing plays on a King. Flip the stock to bury it.',
			'Tap the stock to flip one card onto the waste. You get one pass through the stock.',
			'The hole ends when the board is clear, or when the stock is spent and nothing plays.',
			'A match is nine holes, and the lowest total wins.',
		],
		scoring: [
			{ move: 'Play a card onto the waste', points: '-1', note: 'Your score is the cards still on the board.' },
			{ move: 'Flip a stock card', points: '0' },
			{ move: 'Clear the board', points: '-1 each', note: 'One point per stock card left.' },
		],
		scoringNotes: ['Lower is better. Golf has no time bonus, and cleared boards can score below 0.'],
		terms: [
			{ term: 'Columns', definition: 'Seven face-up piles of five cards — only each column\'s exposed card may play.' },
			{ term: 'Stock', definition: 'The face-down draw pile. You get one pass through it.' },
			{ term: 'Waste', definition: 'The growing face-up pile — play any exposed card one rank above or below its top.' },
			{ term: 'Hole', definition: 'One deal. Nine holes make a match.' },
			{ term: 'Par', definition: '45 strokes for a nine-hole match.' },
		],
	},
	{
		id: 'yukon',
		name: 'Yukon',
		description: 'Like Klondike, but with no stock — any face-up card moves along with every card stacked on it.',
		objective: 'Move all 52 cards to the four foundations, building each suit from Ace to King.',
		rules: [
			'Deal all 52 cards into seven tableau piles. There is no stock.',
			'Move any face-up card along with every card on top of it, even when they are not in sequence.',
			'The moving group\'s bottom card must land on a card of the opposite color, one rank higher.',
			'Build the foundations up by suit from Ace to King.',
			'Only Kings can fill an empty pile.',
			'Face-down cards turn face up when they become the top of a pile.',
		],
		scoring: [
			{ move: 'Tableau to Foundation', points: '+10' },
			{ move: 'Turn over Tableau card', points: '+5' },
			{ move: 'Foundation to Tableau', points: '-15' },
			{ move: 'Win time bonus', points: '+900', note: 'Reduced by elapsed time.' },
		],
		scoringNotes: ['The time bonus drops by 1 point per second. Score cannot go below 0.'],
		terms: [
			{ term: 'Tableau', definition: 'The seven play piles where you build down in alternating colors.' },
			{ term: 'Foundations', definition: 'Four suit piles built up from Ace to King.' },
			{ term: 'Group move', definition: 'Any face-up card together with every card stacked on top of it.' },
		],
	},
	{
		id: 'scorpion',
		name: 'Scorpion',
		description: 'Build down by suit to complete four King-to-Ace runs in place, moving face-up cards with everything stacked on them.',
		objective: 'Complete four King-to-Ace runs of one suit and clear them from the tableau.',
		rules: [
			'Deal 49 cards into seven tableau piles of seven. The remaining three cards form the stock.',
			'A card can move only onto the card one rank higher of its own suit. Nothing can be placed on an Ace.',
			'Move any face-up card along with every card on top of it, even when they are not in sequence.',
			'Only Kings can fill an empty pile.',
			'Tap the stock to deal its three cards onto the first three piles. You can deal only once.',
			'A completed King-to-Ace run of one suit leaves the tableau automatically.',
			'Face-down cards turn face up when they become the top of a pile.',
		],
		scoring: [
			{ move: 'Turn over Tableau card', points: '+5' },
			{ move: 'Complete a run', points: '+100' },
			{ move: 'Win time bonus', points: '+900', note: 'Reduced by elapsed time.' },
		],
		scoringNotes: ['The time bonus drops by 1 point per second. Score cannot go below 0.'],
		terms: [
			{ term: 'Tableau', definition: 'The seven play piles where you build down by suit.' },
			{ term: 'Group move', definition: 'Any face-up card together with every card stacked on top of it.' },
			{ term: 'Completed run', definition: 'A full King-to-Ace run of one suit. Four complete the game.' },
			{ term: 'Stock', definition: 'Three face-down cards, dealt onto the first three piles once.' },
		],
	},
	{
		id: 'fortythieves',
		name: 'Forty Thieves',
		description: 'Build ten columns down by suit, one card at a time, using two decks and a single pass through the stock.',
		objective: 'Move all 104 cards to the eight foundations, building each suit from Ace to King twice.',
		rules: [
			'Deal two decks into ten tableau columns of four face-up cards. The remaining 64 cards form the stock.',
			'Build tableau columns down by suit. Only the top card of a column can move.',
			'Any single available card can fill an empty column.',
			'Build the eight foundations up by suit from Ace to King, two per suit.',
			'Cards placed on a foundation never return to play.',
			'Tap the stock to flip one card onto the waste. You get one pass through the stock.',
		],
		scoring: [
			{ move: 'Waste to Tableau', points: '+5' },
			{ move: 'Waste to Foundation', points: '+10' },
			{ move: 'Tableau to Foundation', points: '+10' },
			{ move: 'Win time bonus', points: '+900', note: 'Reduced by elapsed time.' },
		],
		scoringNotes: ['The time bonus drops by 1 point per second. Score cannot go below 0.'],
		terms: [
			{ term: 'Tableau', definition: 'Ten columns of four face-up cards — build down by suit, one card at a time.' },
			{ term: 'Foundations', definition: 'Eight suit piles built up from Ace to King, two per suit.' },
			{ term: 'Stock', definition: 'The face-down draw pile. You get one pass through it.' },
			{ term: 'Waste', definition: 'Face-up cards drawn from the stock — only the top card is playable.' },
		],
	},
	{
		id: 'canfield',
		name: 'Canfield',
		description: 'Play a 13-card reserve onto foundations that start at a dealt base rank and wrap.',
		objective: 'Move all 52 cards to the four foundations, starting at the dealt base rank and wrapping from King to Ace.',
		rules: [
			'Deal 13 cards into the reserve, one base card to the first foundation, and one card to each tableau pile.',
			'Foundations start at the base rank and build up by suit, wrapping from King to Ace.',
			'Build tableau piles down in alternating colors, wrapping from Ace to King. Piles move only as a whole.',
			'An empty tableau pile fills immediately from the reserve.',
			'The reserve\'s top card is always available to play.',
			'Tap the stock to turn three cards onto the waste. Redeals are unlimited.',
		],
		scoring: [
			{ move: 'Waste to Tableau', points: '+5' },
			{ move: 'Waste to Foundation', points: '+10' },
			{ move: 'Reserve to Tableau', points: '+5' },
			{ move: 'Reserve to Foundation', points: '+10' },
			{ move: 'Tableau to Foundation', points: '+10' },
			{ move: 'Win time bonus', points: '+900', note: 'Reduced by elapsed time.' },
		],
		scoringNotes: ['The time bonus drops by 1 point per second. Score cannot go below 0.'],
		terms: [
			{ term: 'Reserve', definition: 'Thirteen cards with the top one face up and playable.' },
			{ term: 'Base card', definition: 'The card dealt to the first foundation — its rank starts all four foundations.' },
			{ term: 'Tableau', definition: 'Four piles built down in alternating colors, wrapping from Ace to King.' },
			{ term: 'Foundations', definition: 'Four suit piles built up from the base rank, wrapping from King to Ace.' },
			{ term: 'Stock', definition: 'The face-down draw pile. Three cards turn at a time, with unlimited redeals.' },
			{ term: 'Waste', definition: 'Face-up cards drawn from the stock — only the top card is playable.' },
		],
	},
];
