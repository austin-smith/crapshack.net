type Sticker = {
	name: string;
	source: string;
	color: string;
	artScale: number;
};

type Piece = {
	id: number;
	level: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	radius: number;
	angle: number;
	angularVelocity: number;
	age: number;
	dangerFor: number;
	supported: boolean;
	idleFor: number;
	previousX: number;
	previousY: number;
	renderedRadius: number;
	renderedX: number;
	renderedY: number;
	renderedAngle: number;
	element: HTMLDivElement;
};

type SavedPiece = {
	level: number;
	// Position and velocity are fractions of the board, so a save survives the
	// board being a different size when it is restored.
	x: number;
	y: number;
	vx: number;
	vy: number;
	angle: number;
	angularVelocity: number;
	age: number;
	dangerFor: number;
};

type SavedGame = {
	version: number;
	score: number;
	startingBest: number;
	highestLevel: number;
	currentLevel: number;
	nextLevel: number;
	spawnBag: number[];
	nudges: number;
	nudgeMerges: number;
	pieces: SavedPiece[];
};

const BEST_SCORE_KEY = 'crap-stack:best';
// A game in progress is kept in storage so a reload resumes it. Safari can kill
// the tab outright without firing any unload event, so the game is saved on a
// timer while it runs, not only on the way out. Bump the version whenever the
// ladder or the board changes shape so stale saves are dropped.
const SAVED_GAME_KEY = 'crap-stack:game';
const SAVE_VERSION = 1;
const SAVE_INTERVAL = 1000;
const FIXED_STEP = 1 / 60;
// Piece radius as a fraction of board width. The big ones are capped so two of them
// plus everything below still fits on the board.
const RADIUS_FACTORS = [0.061, 0.073, 0.087, 0.103, 0.122, 0.14, 0.159, 0.178, 0.198, 0.218];
// Which piece you get handed. Mostly small, but not so small the run drags.
const STARTING_BAG = [0, 0, 0, 1, 1, 2, 2];
const DROP_COOLDOWN = 410;
const COMBO_WINDOW = 0.68;
const NUDGE_CAPACITY = 2;
const MERGES_PER_NUDGE = 5;
const NUDGE_COOLDOWN = 0.85;

// Fraction of the board height the danger line sits at. Keep in sync with the
// `top`/`height` of `.crap-stack-danger` and `.crap-stack-guide` in CrapStack.astro.
const DANGER_LINE = 0.17;
// A freshly dropped piece passes through the danger band on its way down, so it
// only starts accruing danger once it has had time to fall clear of it.
const DANGER_GRACE = 1.15;
const DANGER_LIMIT = 1.65;

// Contact response. Every piece is a uniform disc, so its moment of inertia is
// ½mr² and the tangential effective mass of any contact collapses to
// 1/m + r²/I = 3/m — which is why the same factor of 3 shows up in all the
// friction maths below, and why a tangential impulse P changes spin by 2P/mr.
const TANGENT_MASS_FACTOR = 3;
const CONTACT_FRICTION = 0.42;
const FLOOR_GRIP = 0.9;
const WALL_GRIP = 0.55;
const WALL_FRICTION = 0.5;
const WALL_RESTITUTION = 0.2;
const FLOOR_RESTITUTION = 0.12;
const ROLLING_RESISTANCE = 0.982;
const SPIN_LIMIT = 2.4;
// Contacts never quite cancel gravity, so even a dead-still pile keeps a slow
// residual velocity that the position solver silently eats. Velocity alone
// therefore never reads as "stopped" — distance actually travelled does. A
// supported piece that has gone nowhere for SLEEP_DELAY is parked outright,
// which is what stops settled pieces from whirring in place forever.
const IDLE_STEP = 0.12;
const SLEEP_DELAY = 0.35;

function requiredElement<T extends Element>(root: Element, selector: string): T {
	const element = root.querySelector<T>(selector);
	if (!element) throw new Error(`Crap Stack is missing ${selector}`);
	return element;
}

function readBestScore(): number {
	try {
		return Number.parseInt(localStorage.getItem(BEST_SCORE_KEY) ?? '0', 10) || 0;
	} catch {
		return 0;
	}
}

function saveBestScore(score: number): void {
	try {
		localStorage.setItem(BEST_SCORE_KEY, String(score));
	} catch {
		// Storage can be unavailable without affecting the game.
	}
}

function isWhole(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function isSavedPiece(value: unknown, topLevel: number): value is SavedPiece {
	if (typeof value !== 'object' || value === null) return false;
	const piece = value as Record<string, unknown>;
	return isWhole(piece.level, topLevel)
		&& [piece.x, piece.y, piece.vx, piece.vy, piece.angle, piece.angularVelocity, piece.age, piece.dangerFor]
			.every((number) => Number.isFinite(number));
}

function isSavedGame(value: unknown, topLevel: number): value is SavedGame {
	if (typeof value !== 'object' || value === null) return false;
	const game = value as Record<string, unknown>;
	return game.version === SAVE_VERSION
		&& isWhole(game.score)
		&& isWhole(game.startingBest)
		&& isWhole(game.highestLevel, topLevel)
		&& isWhole(game.currentLevel, topLevel)
		&& isWhole(game.nextLevel, topLevel)
		&& Array.isArray(game.spawnBag) && game.spawnBag.every((level) => isWhole(level, topLevel))
		&& isWhole(game.nudges, NUDGE_CAPACITY)
		&& isWhole(game.nudgeMerges, MERGES_PER_NUDGE - 1)
		&& Array.isArray(game.pieces) && game.pieces.every((piece) => isSavedPiece(piece, topLevel));
}

function readSavedGame(topLevel: number): SavedGame | null {
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(SAVED_GAME_KEY) ?? 'null');
		return isSavedGame(saved, topLevel) ? saved : null;
	} catch {
		return null;
	}
}

function writeSavedGame(json: string): void {
	try {
		localStorage.setItem(SAVED_GAME_KEY, json);
	} catch {
		// Storage can be unavailable without affecting the game.
	}
}

function clearSavedGame(): void {
	try {
		localStorage.removeItem(SAVED_GAME_KEY);
	} catch {
		// Storage can be unavailable without affecting the game.
	}
}

function rounded(value: number, places: number): number {
	const scale = 10 ** places;
	return Math.round(value * scale) / scale;
}

function shuffledBag(): number[] {
	const bag = [...STARTING_BAG];
	for (let index = bag.length - 1; index > 0; index -= 1) {
		const swapWith = Math.floor(Math.random() * (index + 1));
		[bag[index], bag[swapWith]] = [bag[swapWith], bag[index]];
	}
	return bag;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

// Plays a class-driven CSS animation from the top. Toggling the class through a
// layout read would force a full layout mid-frame, and most of these fire from
// inside the physics step on a merge. Instead a live animation is rewound in
// place, which only needs styles. Every class is dropped once its animation is
// done, so a class that is still present means its animation is still live —
// unless reduced motion has switched it off, and then there is nothing to play.
function replayAnimation(element: HTMLElement, className: string): void {
	if (!element.classList.contains(className)) {
		element.classList.add(className);
		return;
	}
	for (const animation of element.getAnimations()) {
		if (!(animation instanceof CSSAnimation)) continue;
		animation.currentTime = 0;
		animation.play();
	}
}

// Descendants' animation events bubble up too, so only the element's own count.
function dropClassWhenAnimationEnds(element: HTMLElement, className: string): void {
	const drop = (event: AnimationEvent) => {
		if (event.target === element) element.classList.remove(className);
	};
	element.addEventListener('animationend', drop);
	element.addEventListener('animationcancel', drop);
}

// Higher rungs first appear mid-game, straight out of a merge. Fetching the
// whole ladder once the page has loaded keeps them from popping in blank, and
// holding the images keeps them in the page's memory cache.
function preloadStickers(stickers: Sticker[], into: HTMLImageElement[]): void {
	for (const sticker of stickers) {
		const image = new Image();
		image.src = sticker.source;
		into.push(image);
	}
}

export function initCrapStack(root: HTMLElement): void {
	const stickers = JSON.parse(root.dataset.stickers ?? '[]') as Sticker[];
	if (stickers.length < 2) return;

	const topLevel = stickers.length - 1;

	const stage = requiredElement<HTMLElement>(root, '[data-crap-stack-stage]');
	const piecesLayer = requiredElement<HTMLElement>(root, '[data-crap-stack-pieces]');
	const currentToken = requiredElement<HTMLElement>(root, '[data-crap-stack-current]');
	const currentImage = requiredElement<HTMLImageElement>(currentToken, 'img');
	const nextToken = requiredElement<HTMLElement>(root, '[data-crap-stack-next-token]');
	const nextImage = requiredElement<HTMLImageElement>(root, '[data-crap-stack-next]');
	const nextName = requiredElement<HTMLElement>(root, '[data-crap-stack-next-name]');
	const achievedName = requiredElement<HTMLElement>(root, '[data-crap-stack-achieved-name]');
	const progressMarkers = [...root.querySelectorAll<HTMLElement>('[data-crap-stack-progress]')];
	const guide = requiredElement<HTMLElement>(root, '[data-crap-stack-guide]');
	const hint = requiredElement<HTMLElement>(root, '[data-crap-stack-hint]');
	const comboElement = requiredElement<HTMLOutputElement>(root, '[data-crap-stack-combo]');
	const scoreElement = requiredElement<HTMLElement>(root, '[data-crap-stack-score]');
	const bestElement = requiredElement<HTMLElement>(root, '[data-crap-stack-best]');
	const finalElement = requiredElement<HTMLElement>(root, '[data-crap-stack-final]');
	const finalBest = requiredElement<HTMLElement>(root, '[data-crap-stack-final-best]');
	const gameOverPanel = requiredElement<HTMLElement>(root, '[data-crap-stack-game-over]');
	const soundButton = requiredElement<HTMLButtonElement>(root, '[data-crap-stack-sound]');
	const soundOnIcon = requiredElement<SVGElement>(root, '[data-crap-stack-sound-on]');
	const soundOffIcon = requiredElement<SVGElement>(root, '[data-crap-stack-sound-off]');
	const restartButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-crap-stack-restart]')];
	const cabinet = requiredElement<HTMLElement>(root, '.crap-stack-cabinet');
	const nudgeControls = requiredElement<HTMLElement>(root, '[data-crap-stack-nudges]');
	const nudgeButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-crap-stack-nudge]')];
	const nudgeCount = requiredElement<HTMLElement>(root, '[data-crap-stack-nudge-count]');
	const nudgeHint = requiredElement<HTMLElement>(root, '[data-crap-stack-nudge-hint]');
	const nudgeMeter = requiredElement<HTMLElement>(root, '[data-crap-stack-nudge-meter]');
	const nudgeTicks = [...root.querySelectorAll<HTMLElement>('[data-crap-stack-nudge-tick]')];
	const nudgeStatus = requiredElement<HTMLElement>(root, '[data-crap-stack-nudge-status]');

	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

	let pieces: Piece[] = [];
	let spawnBag: number[] = [];
	let width = 0;
	let height = 0;
	let dangerY = 0;
	let aimX = 0;
	let currentLevel = 0;
	let nextLevel = 0;
	let highestLevel = 0;
	let score = 0;
	let best = readBestScore();
	let startingBest = best;
	let pieceId = 0;
	let lastTime = 0;
	let accumulator = 0;
	let canDrop = true;
	let gameOver = false;
	let soundEnabled = true;
	let lastMergeAt = 0;
	let combo = 0;
	let comboTimer = 0;
	let dropTimer = 0;
	let audioContext: AudioContext | null = null;
	let nudges = NUDGE_CAPACITY;
	let nudgeMerges = 0;
	let nudgeCooldown = 0;
	let nudgeDisplay = '';
	let saveRequested = false;
	let lastSavedAt = 0;
	let savedJson = '';
	let shownDanger = '';
	let shownDangerProgress = '';
	let stageLeft: number | null = null;
	const preloadedStickers: HTMLImageElement[] = [];

	bestElement.textContent = String(best);
	if (document.readyState === 'complete') preloadStickers(stickers, preloadedStickers);
	else window.addEventListener('load', () => preloadStickers(stickers, preloadedStickers), { once: true });

	function radiusFor(level: number): number {
		return width * RADIUS_FACTORS[level];
	}

	function nextFromBag(): number {
		if (spawnBag.length === 0) spawnBag = shuffledBag();
		return spawnBag.pop() ?? 0;
	}

	function styleToken(element: HTMLElement, level: number): void {
		const sticker = stickers[level];
		element.style.setProperty('--token-color', sticker.color);
		element.style.setProperty('--art-scale', String(sticker.artScale));
	}

	function updateProgress(level: number): void {
		highestLevel = Math.max(highestLevel, level);
		achievedName.textContent = stickers[highestLevel].name;
		for (const marker of progressMarkers) {
			const markerLevel = Number.parseInt(marker.dataset.crapStackProgress ?? '0', 10);
			marker.dataset.achieved = markerLevel <= highestLevel ? 'true' : 'false';
		}
	}

	// Aiming moves with `translate`, which the compositor handles; moving `left`
	// would re-run layout on every pointer move. It applies ahead of the token's
	// own centring transform, so the two compose the way `left` did.
	function updateAim(): void {
		const offset = `${aimX}px 0`;
		currentToken.style.translate = offset;
		guide.style.translate = offset;
	}

	function updatePreview(): void {
		const radius = radiusFor(currentLevel);
		const diameter = radius * 2;
		const armed = canDrop && !gameOver;
		styleToken(currentToken, currentLevel);
		// Reassigning the same animated source restarts its animation in WebKit.
		if (currentImage.getAttribute('src') !== stickers[currentLevel].source) {
			currentImage.src = stickers[currentLevel].source;
		}
		currentToken.style.width = `${diameter}px`;
		currentToken.style.height = `${diameter}px`;
		updateAim();
		// The guide and the token fade together, so the cooldown reads as one beat
		// rather than a stray line hanging under an empty chute.
		currentToken.dataset.armed = armed ? 'true' : 'false';
		guide.dataset.armed = armed ? 'true' : 'false';

		if (nextImage.getAttribute('src') !== stickers[nextLevel].source) {
			nextImage.src = stickers[nextLevel].source;
		}
		styleToken(nextToken, nextLevel);
		nextImage.alt = stickers[nextLevel].name;
		nextName.textContent = stickers[nextLevel].name;
	}

	function setAim(clientX: number): void {
		const radius = radiusFor(currentLevel);
		// clientLeft is the stage border: pieces are laid out in the padding box,
		// so that is where the playfield's own origin sits. Pointer events can
		// outnumber frames and each measurement can force a layout, so it is taken
		// at most once a frame; frame() clears it, so it is never older than that.
		stageLeft ??= stage.getBoundingClientRect().left + stage.clientLeft;
		aimX = clamp(clientX - stageLeft, radius, width - radius);
		updateAim();
	}

	function makePiece(level: number, x: number, y: number, merged = false): Piece {
		const element = document.createElement('div');
		element.className = `crap-stack-piece${merged ? ' is-merged' : ''}`;
		styleToken(element, level);
		const image = document.createElement('img');
		image.src = stickers[level].source;
		image.alt = '';
		image.draggable = false;
		element.append(image);
		piecesLayer.append(element);
		if (merged) window.setTimeout(() => element.classList.remove('is-merged'), 290);

		return {
			id: pieceId++,
			level,
			x,
			y,
			vx: 0,
			vy: merged ? -height * 0.045 : 0,
			radius: radiusFor(level),
			angle: (Math.random() - 0.5) * 0.12,
			angularVelocity: (Math.random() - 0.5) * 0.28,
			age: 0,
			dangerFor: 0,
			supported: false,
			idleFor: 0,
			previousX: x,
			previousY: y,
			renderedRadius: 0,
			renderedX: Number.NaN,
			renderedY: Number.NaN,
			renderedAngle: Number.NaN,
			element,
		};
	}

	function ensureAudio(): AudioContext | null {
		if (!soundEnabled) return null;
		if (!audioContext) audioContext = new AudioContext();
		if (audioContext.state === 'suspended') void audioContext.resume();
		return audioContext;
	}

	function tone(frequency: number, duration: number, volume = 0.025, type: OscillatorType = 'sine'): void {
		const context = ensureAudio();
		if (!context) return;
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		const now = context.currentTime;
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(frequency, now);
		gain.gain.setValueAtTime(volume, now);
		gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
		oscillator.connect(gain).connect(context.destination);
		// Every drop, merge and nudge makes a pair of nodes, and a long game makes
		// thousands. Unhook them once the sound is over so none can outlive it.
		oscillator.addEventListener('ended', () => {
			oscillator.disconnect();
			gain.disconnect();
		}, { once: true });
		oscillator.start(now);
		oscillator.stop(now + duration);
	}

	function updateNudges(): void {
		const state = gameOver ? 'over'
			: nudgeCooldown > 0 ? 'settling'
				: nudges === 0 ? 'empty'
					: !pieces.some((piece) => piece.supported) ? 'waiting' : 'ready';
		const display = `${state}:${nudges}:${nudgeMerges}`;
		if (display === nudgeDisplay) return;
		nudgeDisplay = display;
		nudgeCount.textContent = `${nudges} / ${NUDGE_CAPACITY}`;
		nudgeHint.textContent = state === 'over' ? 'game over'
			: state === 'settling' ? 'cooldown…'
				: state === 'waiting' ? ''
					: nudges === NUDGE_CAPACITY ? `${NUDGE_CAPACITY} nudges available`
						: `${nudgeMerges} / ${MERGES_PER_NUDGE} merges to recharge`;
		for (const button of nudgeButtons) {
			// Keep keyboard play available when the active control enters cooldown.
			if (state !== 'ready' && document.activeElement === button) nudgeControls.focus({ preventScroll: true });
			button.disabled = state !== 'ready';
		}
		const progress = nudges === NUDGE_CAPACITY ? MERGES_PER_NUDGE : nudgeMerges;
		nudgeMeter.setAttribute('aria-valuenow', String(progress));
		nudgeMeter.setAttribute('aria-valuetext', nudges === NUDGE_CAPACITY
			? `${NUDGE_CAPACITY} nudges available` : `${nudgeMerges} of ${MERGES_PER_NUDGE} merges toward the next nudge`);
		for (const [index, tick] of nudgeTicks.entries()) tick.dataset.filled = String(index < progress);
	}

	function chargeNudge(): void {
		// A full bank cannot stockpile a hidden third charge. Every merge counts
		// once, including cascades; score multipliers do not accelerate charging.
		if (nudges === NUDGE_CAPACITY) return;
		nudgeMerges += 1;
		if (nudgeMerges === MERGES_PER_NUDGE) {
			nudgeMerges = 0;
			nudges += 1;
			nudgeStatus.textContent = `Nudge recharged. ${nudges} of ${NUDGE_CAPACITY} ready.`;
		}
	}

	function nudge(direction: -1 | 1): void {
		if (gameOver || nudges === 0 || nudgeCooldown > 0) return;
		// Bump pieces touching the pile, not a fresh drop still in flight. A tiny
		// lift breaks resting contacts; lighter pieces respond more than big ones.
		const resting = pieces.filter((piece) => piece.supported);
		if (resting.length === 0) return;
		nudges -= 1;
		nudgeCooldown = NUDGE_COOLDOWN;
		saveRequested = true;
		for (const piece of resting) {
			const response = Math.sqrt(radiusFor(0) / piece.radius);
			piece.vx = clamp(piece.vx + direction * width * 0.32 * response, -width * 0.55, width * 0.55);
			piece.vy = Math.max(-height * 0.21, Math.min(0, piece.vy) - height * 0.17 * response);
			piece.angularVelocity = clamp(piece.angularVelocity + direction * 0.65 * response, -SPIN_LIMIT, SPIN_LIMIT);
			piece.idleFor = 0;
			piece.supported = false;
		}
		cabinet.style.setProperty('--nudge-direction', String(direction));
		replayAnimation(cabinet, 'is-nudging');
		nudgeStatus.textContent = `Nudged ${direction < 0 ? 'left' : 'right'}. ${nudges} of ${NUDGE_CAPACITY} nudges left.`;
		updateNudges();
		tone(72, 0.14, 0.035, 'triangle');
		tone(46, 0.09, 0.018, 'sine');
	}

	function drop(): void {
		if (!canDrop || gameOver) return;
		const radius = radiusFor(currentLevel);
		pieces.push(makePiece(currentLevel, aimX, radius + 7));
		hint.dataset.dismissed = 'true';
		tone(118, 0.055, 0.016, 'triangle');
		currentLevel = nextLevel;
		nextLevel = nextFromBag();
		canDrop = false;
		saveRequested = true;
		updatePreview();
		window.clearTimeout(dropTimer);
		dropTimer = window.setTimeout(() => {
			if (gameOver) return;
			canDrop = true;
			const nextRadius = radiusFor(currentLevel);
			aimX = clamp(aimX, nextRadius, width - nextRadius);
			updatePreview();
		}, DROP_COOLDOWN);
	}

	function removePiece(piece: Piece): void {
		piece.element.remove();
	}

	function showPoints(x: number, y: number, points: number): void {
		const label = document.createElement('span');
		label.className = 'crap-stack-points';
		label.textContent = `+${points}`;
		label.style.left = `${x}px`;
		label.style.top = `${y}px`;
		piecesLayer.append(label);
		window.setTimeout(() => label.remove(), 700);
	}

	function showBurst(x: number, y: number, radius: number): void {
		const ring = document.createElement('span');
		ring.className = 'crap-stack-burst';
		ring.style.left = `${x}px`;
		ring.style.top = `${y}px`;
		ring.style.width = `${radius * 2}px`;
		ring.style.height = `${radius * 2}px`;
		piecesLayer.append(ring);
		window.setTimeout(() => ring.remove(), 620);
	}

	function bumpScore(): void {
		replayAnimation(scoreElement, 'is-bumping');
	}

	function updateScore(points: number): void {
		score += points;
		scoreElement.textContent = String(score);
		bumpScore();
		if (score > best) {
			best = score;
			bestElement.textContent = String(best);
			saveBestScore(best);
		}
	}

	function callCombo(): void {
		if (combo < 2) return;
		window.clearTimeout(comboTimer);
		comboElement.textContent = `${combo}× chain`;
		// The callout holds its last frame, so it stays live until this timer
		// takes the class away.
		replayAnimation(comboElement, 'is-showing');
		comboTimer = window.setTimeout(() => {
			comboElement.textContent = '';
			comboElement.classList.remove('is-showing');
		}, 650);
	}

	function impact(level: number): void {
		if (level < 3) return;
		replayAnimation(stage, 'is-impacting');
		if (!reducedMotion.matches && 'vibrate' in navigator) navigator.vibrate(Math.min(8 + level * 2, 24));
	}

	function mergeTouchingPieces(now: number): void {
		const consumed = new Set<number>();
		const additions: Piece[] = [];

		for (let firstIndex = 0; firstIndex < pieces.length; firstIndex += 1) {
			const first = pieces[firstIndex];
			if (consumed.has(first.id)) continue;

			for (let secondIndex = firstIndex + 1; secondIndex < pieces.length; secondIndex += 1) {
				const second = pieces[secondIndex];
				if (consumed.has(second.id) || first.level !== second.level) continue;
				const dx = second.x - first.x;
				const dy = second.y - first.y;
				if (dx * dx + dy * dy > (first.radius + second.radius) ** 2) continue;

				consumed.add(first.id);
				consumed.add(second.id);
				const x = (first.x + second.x) / 2;
				const y = (first.y + second.y) / 2;
				const topPair = first.level === topLevel;
				const level = topPair ? topLevel : first.level + 1;

				if (topPair) {
					// The ladder has no rung above this, so a matched pair clears itself
					// instead of squatting on the board forever. It pays like the merge
					// that would have come next.
					showBurst(x, y, Math.max(first.radius, second.radius) * 1.35);
				} else {
					const merged = makePiece(level, x, y, true);
					merged.vx = (first.vx + second.vx) / 2;
					merged.vy += (first.vy + second.vy) / 2;
					merged.angularVelocity = (first.angularVelocity + second.angularVelocity) / 2;
					additions.push(merged);
				}

				combo = now - lastMergeAt < COMBO_WINDOW ? combo + 1 : 1;
				lastMergeAt = now;
				const points = 5 * 2 ** (first.level + 1) * Math.min(combo, 5);
				updateScore(points);
				chargeNudge();
				updateProgress(level);
				showPoints(x, y, points);
				callCombo();
				impact(level);
				if (topPair) {
					tone(660, 0.3, 0.03, 'triangle');
					window.setTimeout(() => tone(990, 0.36, 0.024, 'sine'), 90);
				} else {
					tone(190 + level * 48, 0.12 + level * 0.008, 0.022, level > 5 ? 'sine' : 'triangle');
				}
				break;
			}
		}

		if (consumed.size === 0) return;
		saveRequested = true;
		pieces = pieces.filter((piece) => {
			if (!consumed.has(piece.id)) return true;
			removePiece(piece);
			return false;
		});
		pieces.push(...additions);
	}

	// Position-only clamp. Safe to run inside the solver loop, where re-applying
	// contact impulses would double-count them.
	function clampToField(piece: Piece): void {
		const limit = width - piece.radius;
		piece.x = limit < piece.radius ? width / 2 : clamp(piece.x, piece.radius, limit);
		const floor = height - piece.radius;
		if (piece.y > floor) {
			piece.y = floor;
			piece.supported = true;
		}
	}

	// A disc against a vertical wall touches it level with its own centre, so the
	// spin drags that contact point up or down. `side` is -1 for the left wall.
	// `pressing` is how hard the piece is driven into the wall: friction can only
	// spend what the normal contact provides, and a piece merely grazing the wall
	// on its way past provides nothing. Without that limit the wall acts as a
	// brake on anything touching it and pieces crawl down the edges.
	function applyWallSpin(piece: Piece, side: number, pressing: number): void {
		if (pressing <= 0) return;
		const slip = piece.vy + side * piece.angularVelocity * piece.radius;
		const limit = pressing * WALL_FRICTION;
		const change = clamp((slip * WALL_GRIP) / TANGENT_MASS_FACTOR, -limit, limit);
		piece.vy -= change;
		piece.angularVelocity -= (side * 2 * change) / piece.radius;
	}

	function resolveWallContact(piece: Piece): void {
		if (piece.x <= piece.radius) {
			piece.x = piece.radius;
			const pressing = Math.max(0, -piece.vx);
			if (piece.vx < 0) piece.vx = -piece.vx * WALL_RESTITUTION;
			applyWallSpin(piece, -1, pressing);
		} else if (piece.x >= width - piece.radius) {
			piece.x = width - piece.radius;
			const pressing = Math.max(0, piece.vx);
			if (piece.vx > 0) piece.vx = -piece.vx * WALL_RESTITUTION;
			applyWallSpin(piece, 1, pressing);
		}

		const floor = height - piece.radius;
		if (piece.y < floor) return;

		piece.y = floor;
		piece.supported = true;
		piece.vy = Math.abs(piece.vy) < height * 0.035 ? 0 : -Math.abs(piece.vy) * FLOOR_RESTITUTION;
		// The floor contact sits directly below the centre, so friction trades
		// sliding for rolling: it kills the slip between surface and ground.
		const slip = piece.vx - piece.angularVelocity * piece.radius;
		const change = (slip * FLOOR_GRIP) / TANGENT_MASS_FACTOR;
		piece.vx -= change;
		piece.angularVelocity += (2 * change) / piece.radius;
		piece.angularVelocity *= ROLLING_RESISTANCE;
	}

	function solvePieceCollisions(): void {
		for (let iteration = 0; iteration < 6; iteration += 1) {
			for (let firstIndex = 0; firstIndex < pieces.length; firstIndex += 1) {
				const first = pieces[firstIndex];
				for (let secondIndex = firstIndex + 1; secondIndex < pieces.length; secondIndex += 1) {
					const second = pieces[secondIndex];
					let dx = second.x - first.x;
					let dy = second.y - first.y;
					const minimumDistance = first.radius + second.radius;
					// Most pairs are nowhere near touching, so rule them out on the
					// squared distance and only take the square root for a contact.
					const distanceSquared = dx * dx + dy * dy;
					if (distanceSquared >= minimumDistance * minimumDistance) continue;
					let distance = Math.sqrt(distanceSquared);
					if (distance < 0.001) {
						dx = 0.01;
						dy = 0;
						distance = 0.01;
					}

					first.supported = true;
					second.supported = true;

					const nx = dx / distance;
					const ny = dy / distance;
					const firstMass = first.radius * first.radius;
					const secondMass = second.radius * second.radius;
					const firstInverse = 1 / firstMass;
					const secondInverse = 1 / secondMass;
					const inverseSum = firstInverse + secondInverse;
					const overlap = minimumDistance - distance;
					const correction = Math.max(0, overlap - 0.08) * 0.76 / inverseSum;
					first.x -= nx * correction * firstInverse;
					first.y -= ny * correction * firstInverse;
					second.x += nx * correction * secondInverse;
					second.y += ny * correction * secondInverse;

					const relativeX = second.vx - first.vx;
					const relativeY = second.vy - first.vy;
					const normalSpeed = relativeX * nx + relativeY * ny;
					if (normalSpeed >= 0) continue;
					const impulse = -(1.08 * normalSpeed) / inverseSum;
					const impulseX = impulse * nx;
					const impulseY = impulse * ny;
					first.vx -= impulseX * firstInverse;
					first.vy -= impulseY * firstInverse;
					second.vx += impulseX * secondInverse;
					second.vy += impulseY * secondInverse;

					const tangentX = -ny;
					const tangentY = nx;
					// Both discs drag their contact point around as they spin. Folding
					// that surface speed into the slip is what lets friction bleed
					// rotation away — measuring the linear velocities alone can only
					// ever add spin, which pins resting pieces at the clamp.
					const surfaceSpeed = first.angularVelocity * first.radius + second.angularVelocity * second.radius;
					const tangentSpeed = relativeX * tangentX + relativeY * tangentY - surfaceSpeed;
					const grip = impulse * CONTACT_FRICTION;
					const friction = clamp(-tangentSpeed / (TANGENT_MASS_FACTOR * inverseSum), -grip, grip);
					first.vx -= friction * tangentX * firstInverse;
					first.vy -= friction * tangentY * firstInverse;
					second.vx += friction * tangentX * secondInverse;
					second.vy += friction * tangentY * secondInverse;
					first.angularVelocity -= (2 * friction) / (firstMass * first.radius);
					second.angularVelocity -= (2 * friction) / (secondMass * second.radius);
				}
			}
			for (const piece of pieces) clampToField(piece);
		}
	}

	function settle(piece: Piece, delta: number): void {
		piece.angularVelocity = clamp(piece.angularVelocity, -SPIN_LIMIT, SPIN_LIMIT);
		const travelled = Math.hypot(piece.x - piece.previousX, piece.y - piece.previousY);
		if (!piece.supported || travelled > IDLE_STEP) {
			piece.idleFor = 0;
			return;
		}
		piece.idleFor += delta;
		if (piece.idleFor < SLEEP_DELAY) return;
		piece.vx = 0;
		piece.vy = 0;
		piece.angularVelocity = 0;
	}

	function endGame(): void {
		if (gameOver) return;
		gameOver = true;
		canDrop = false;
		window.clearTimeout(dropTimer);
		// A finished game has nothing to resume.
		clearSavedGame();
		savedJson = '';
		updatePreview();
		finalElement.textContent = String(score);
		finalBest.hidden = score <= startingBest;
		gameOverPanel.hidden = false;
		updateNudges();
		tone(150, 0.28, 0.035, 'sawtooth');
		window.setTimeout(() => tone(92, 0.4, 0.025, 'triangle'), 120);
		requiredElement<HTMLButtonElement>(gameOverPanel, '[data-crap-stack-restart]').focus();
	}

	function updateDanger(delta: number): void {
		let maximum = 0;
		for (const piece of pieces) {
			const intruding = piece.age > DANGER_GRACE && piece.y - piece.radius < dangerY;
			piece.dangerFor = intruding ? piece.dangerFor + delta : Math.max(0, piece.dangerFor - delta * 2.5);
			maximum = Math.max(maximum, piece.dangerFor);
			if (piece.dangerFor > DANGER_LIMIT) endGame();
		}
		showDanger(Math.min(maximum / DANGER_LIMIT, 1));
	}

	// Runs every physics step, but the meter sits at zero for most of a game, so
	// only touch the stage when what it shows actually changes.
	function showDanger(progress: number): void {
		const danger = progress > 0.04 ? 'true' : 'false';
		const progressText = progress.toFixed(3);
		if (danger !== shownDanger) {
			shownDanger = danger;
			stage.dataset.danger = danger;
		}
		if (progressText !== shownDangerProgress) {
			shownDangerProgress = progressText;
			stage.style.setProperty('--danger-progress', progressText);
		}
	}

	function physicsStep(delta: number, now: number): void {
		// Once the result is shown, neither cascades nor nudges can change it.
		if (gameOver) return;
		nudgeCooldown = Math.max(0, nudgeCooldown - delta);
		const gravity = height * 1.58;
		for (const piece of pieces) {
			piece.age += delta;
			piece.supported = false;
			piece.previousX = piece.x;
			piece.previousY = piece.y;
			piece.vy += gravity * delta;
			piece.vx *= 0.999;
			piece.vy *= 0.999;
			piece.angularVelocity *= 0.995;
			piece.x += piece.vx * delta;
			piece.y += piece.vy * delta;
			piece.angle += piece.angularVelocity * delta;
		}

		// Contact response runs once per step; the solver below only nudges
		// positions, so friction and bounce are never applied six times over.
		for (const piece of pieces) resolveWallContact(piece);
		mergeTouchingPieces(now);
		solvePieceCollisions();
		for (const piece of pieces) settle(piece, delta);
		if (!gameOver) updateDanger(delta);
	}

	function render(): void {
		for (const piece of pieces) {
			const resized = piece.renderedRadius !== piece.radius;
			if (resized) {
				piece.renderedRadius = piece.radius;
				const diameter = piece.radius * 2;
				piece.element.style.width = `${diameter}px`;
				piece.element.style.height = `${diameter}px`;
			}
			// Once a piece has come fully to rest it keeps exactly the same position,
			// so skip rebuilding a transform it already has.
			if (!resized && piece.x === piece.renderedX && piece.y === piece.renderedY && piece.angle === piece.renderedAngle) continue;
			piece.renderedX = piece.x;
			piece.renderedY = piece.y;
			piece.renderedAngle = piece.angle;
			piece.element.style.transform = `translate3d(${piece.x - piece.radius}px, ${piece.y - piece.radius}px, 0) rotate(${piece.angle}rad)`;
		}
	}

	function frame(time: number): void {
		// Book the next frame before doing any work, so a frame that throws cannot
		// stop the game loop for good.
		requestAnimationFrame(frame);
		stageLeft = null;
		if (!lastTime) lastTime = time;
		const elapsed = Math.min((time - lastTime) / 1000, 0.05);
		lastTime = time;
		accumulator += elapsed;
		let steps = 0;
		while (accumulator >= FIXED_STEP && steps < 4) {
			physicsStep(FIXED_STEP, time / 1000);
			accumulator -= FIXED_STEP;
			steps += 1;
		}
		render();
		updateNudges();
		if (saveRequested || time - lastSavedAt >= SAVE_INTERVAL) {
			lastSavedAt = time;
			saveGame();
		}
	}

	function snapshot(): SavedGame {
		return {
			version: SAVE_VERSION,
			score,
			startingBest,
			highestLevel,
			currentLevel,
			nextLevel,
			spawnBag: [...spawnBag],
			nudges,
			nudgeMerges,
			pieces: pieces.map((piece) => ({
				level: piece.level,
				x: rounded(piece.x / width, 5),
				y: rounded(piece.y / height, 5),
				vx: rounded(piece.vx / width, 5),
				vy: rounded(piece.vy / height, 5),
				angle: rounded(piece.angle, 4),
				angularVelocity: rounded(piece.angularVelocity, 4),
				// Age only matters until the danger grace runs out. Capping it keeps a
				// settled board serialising identically, so it is not rewritten.
				age: rounded(Math.min(piece.age, DANGER_GRACE), 3),
				dangerFor: rounded(piece.dangerFor, 3),
			})),
		};
	}

	function saveGame(): void {
		saveRequested = false;
		if (gameOver || width <= 0 || height <= 0) return;
		const json = JSON.stringify(snapshot());
		if (json === savedJson) return;
		savedJson = json;
		writeSavedGame(json);
	}

	function restorePiece(saved: SavedPiece): Piece {
		const piece = makePiece(saved.level, saved.x * width, saved.y * height);
		piece.vx = saved.vx * width;
		piece.vy = saved.vy * height;
		piece.angle = saved.angle;
		piece.angularVelocity = saved.angularVelocity;
		piece.age = saved.age;
		piece.dangerFor = saved.dangerFor;
		return piece;
	}

	function clearPieces(): void {
		for (const piece of pieces) removePiece(piece);
		pieces = [];
		piecesLayer.replaceChildren();
	}

	// Starts a fresh game, or picks a saved one back up where it left off.
	function startGame(saved: SavedGame | null): void {
		window.clearTimeout(dropTimer);
		window.clearTimeout(comboTimer);
		clearPieces();
		spawnBag = saved ? [...saved.spawnBag] : shuffledBag();
		score = saved?.score ?? 0;
		combo = 0;
		lastMergeAt = 0;
		highestLevel = 0;
		startingBest = saved?.startingBest ?? best;
		gameOver = false;
		canDrop = true;
		nudges = saved?.nudges ?? NUDGE_CAPACITY;
		nudgeMerges = saved?.nudgeMerges ?? 0;
		nudgeCooldown = 0;
		nudgeStatus.textContent = '';
		cabinet.classList.remove('is-nudging');
		currentLevel = saved?.currentLevel ?? nextFromBag();
		nextLevel = saved?.nextLevel ?? nextFromBag();
		for (const piece of saved?.pieces ?? []) pieces.push(restorePiece(piece));
		scoreElement.textContent = String(score);
		gameOverPanel.hidden = true;
		finalBest.hidden = true;
		hint.dataset.dismissed = pieces.length > 0 ? 'true' : 'false';
		comboElement.textContent = '';
		comboElement.classList.remove('is-showing');
		showDanger(0);
		aimX = width / 2;
		updateProgress(saved?.highestLevel ?? 0);
		updatePreview();
		updateNudges();
		saveRequested = true;
		stage.focus();
	}

	function resize(): void {
		// Pieces are absolutely positioned inside the stage, which puts them in its
		// padding box — the border-box rect would let them sink through the frame.
		const nextWidth = stage.clientWidth;
		const nextHeight = stage.clientHeight;
		// A hidden stage measures zero. Bailing before touching the stored size
		// keeps that from being mistaken for a real field the pieces scale against.
		if (nextWidth <= 0 || nextHeight <= 0) return;

		const oldWidth = width;
		const oldHeight = height;
		width = nextWidth;
		height = nextHeight;
		dangerY = height * DANGER_LINE;

		if (oldWidth > 0 && oldHeight > 0) {
			const scaleX = width / oldWidth;
			const scaleY = height / oldHeight;
			for (const piece of pieces) {
				piece.x *= scaleX;
				piece.y *= scaleY;
				piece.vx *= scaleX;
				piece.vy *= scaleY;
				piece.radius = radiusFor(piece.level);
			}
			aimX *= scaleX;
		} else {
			aimX = width / 2;
		}
		const currentRadius = radiusFor(currentLevel);
		aimX = clamp(aimX, currentRadius, width - currentRadius);
		updatePreview();
	}

	function setSound(enabled: boolean): void {
		soundEnabled = enabled;
		soundButton.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
		soundButton.setAttribute('aria-label', soundEnabled ? 'Turn sound off' : 'Turn sound on');
		soundOnIcon.classList.toggle('hidden', !soundEnabled);
		soundOffIcon.classList.toggle('hidden', soundEnabled);
		if (soundEnabled) tone(330, 0.08, 0.02, 'sine');
		else void audioContext?.suspend();
	}

	function handleKeydown(event: KeyboardEvent): void {
		// Leave browser shortcuts and editable controls alone.
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
		if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.matches('input, textarea, select'))) return;
		if (event.key.toLowerCase() === 'a' || event.key.toLowerCase() === 'd') {
			event.preventDefault();
			if (!event.repeat) nudge(event.key.toLowerCase() === 'a' ? -1 : 1);
			return;
		}
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			const direction = event.key === 'ArrowLeft' ? -1 : 1;
			const radius = radiusFor(currentLevel);
			aimX = clamp(aimX + direction * width * 0.045, radius, width - radius);
			updateAim();
			return;
		}
		if (event.key === ' ' || event.key === 'Enter') {
			if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
			event.preventDefault();
			drop();
		}
	}

	soundButton.addEventListener('click', () => setSound(!soundEnabled));
	for (const button of restartButtons) button.addEventListener('click', () => startGame(null));
	for (const button of nudgeButtons) {
		button.addEventListener('click', () => nudge(button.dataset.crapStackNudge === 'left' ? -1 : 1));
	}
	// A held activation key must not repeatedly click a focused nudge button.
	nudgeControls.addEventListener('keydown', (event) => {
		if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
	});
	dropClassWhenAnimationEnds(cabinet, 'is-nudging');
	dropClassWhenAnimationEnds(scoreElement, 'is-bumping');
	dropClassWhenAnimationEnds(stage, 'is-impacting');
	stage.addEventListener('pointermove', (event) => setAim(event.clientX));
	stage.addEventListener('pointerdown', (event) => {
		if (event.button !== 0) return;
		setAim(event.clientX);
		drop();
	});
	root.addEventListener('keydown', handleKeydown);
	// The save timer covers a tab that dies without warning; these catch the
	// latest state when the browser does announce that the page is going away.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') saveGame();
	});
	window.addEventListener('pagehide', () => saveGame());
	new ResizeObserver(resize).observe(stage);
	resize();
	// Saved positions are fractions of the board, so they need a measured board.
	startGame(width > 0 ? readSavedGame(topLevel) : null);
	requestAnimationFrame(frame);
}
