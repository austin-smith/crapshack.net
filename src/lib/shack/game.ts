import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Sound } from './audio';
import { buildIsland, ISLAND_RADIUS, type Island } from './island';
import {
	buildJunkModel,
	drawJunk,
	junkColliders,
	junkKind,
	junkPoses,
	junkShape,
	STARTER_KIT,
	type JunkKind,
	type JunkModel,
} from './junk';
import { ANY_QUERY, GRAVITY, JUNK_GROUPS, SOLID_QUERY } from './physics';
import {
	claimInkId,
	createFill,
	createInkMaterial,
	fillUniforms,
	GHOST_ID,
	HIGHLIGHT_ID,
	InkRenderer,
	WOBBLY_ID,
	inkify,
	setInkId,
} from './render';
import { Resident, type NightResult } from './residents';
import { clearAt, coverAt, findSpots, groundAt, isSafe, type Needs, type Spot } from './shelter';
import { planShelter, type ShelterPlan } from './navigation';
import { forecastFor, fromVector, Night, Precipitation, type Forecast } from './weather';
import * as words from './words';

const STEP = 1 / 60;
const MAX_STEPS = 4;
const PITCH = 0.6;
const CAMERA_DISTANCE = 40;
const TARGET_Y = -0.55;
const DRAG_THRESHOLD = 6;
const TURN = Math.PI / 4;
// Room a resident needs to themselves, centre to centre.
const SPOT_SPACING = 0.46;
// A short look ahead, run on a copy of the world, to see what would fall.
const SETTLE_STEPS = 75;
const MAX_RESIDENTS = 7;
const START_NAILS = 2;
const MAX_NAILS = 6;
// How fast full exposure soaks someone, per second of full rain.
const WET_RATE = 0.1;
// Wind force on junk: drag across its face, lift under anything flat.
const DRAG = 1.3;
const LIFT = 1.05;
// How hard the wind shoves an unsheltered resident, in metres per second.
const RESIDENT_PUSH = 1.25;
const DUSK_SECONDS = 4;
const MAX_DUSK_SECONDS = 18;
const DAWN_SECONDS = 3;
const BEST_KEY = 'shack:best';
const SOUND_KEY = 'shack:sound';
const METAL = new Set(['sheet', 'fridge', 'bathtub', 'barrel', 'sign']);

const UP = new THREE.Vector3(0, 1, 0);

const SKY = {
	dayTop: new THREE.Color('#8bb8c8'),
	dayBottom: new THREE.Color('#f4dfb5'),
	nightTop: new THREE.Color('#0f1b2a'),
	nightBottom: new THREE.Color('#2b405a'),
	glow: new THREE.Color('#f7bfcf'),
	ink: new THREE.Color('#26231f'),
	chalk: new THREE.Color('#81959e'),
	sunDay: new THREE.Color('#fff4e0'),
	sunNight: new THREE.Color('#b9c8de'),
	skyDay: new THREE.Color('#fffaf0'),
	skyNight: new THREE.Color('#90a6c4'),
	ghost: new THREE.Color('#fdd0e0'),
	ghostWobbly: new THREE.Color('#f9cfa3'),
	ghostBad: new THREE.Color('#f4a79c'),
	ghostLine: new THREE.Color('#e0588a'),
	ghostLineWobbly: new THREE.Color('#e27a2c'),
	ghostLineBad: new THREE.Color('#cf3b2e'),
};

type Phase = 'loading' | 'title' | 'build' | 'dusk' | 'storm' | 'dawn' | 'report' | 'farewell' | 'over';

type Piece = {
	id: number;
	kind: JunkKind;
	// Keeps its hand-made wobble the same when it is picked up and put back.
	seed: number;
	body: RAPIER.RigidBody;
	model: JunkModel;
	ink: THREE.ShaderMaterial;
	inkId: number;
	nailed: boolean;
	partners: Set<number>;
	// Would fall or slide if left to itself.
	wobbly: boolean;
	snow: number;
	shelter: number;
	// Wind only gets real lift under something with air beneath it, like a roof.
	lift: number;
	shelterCheck: number;
	lastSpeed: number;
	lastSound: number;
	from: { position: THREE.Vector3; quaternion: THREE.Quaternion };
};

type Held = {
	kind: JunkKind;
	yaw: number;
	// Index into the kind's poses.
	pose: number;
	seed: number;
	// Carried by the pointer, or from the keyboard.
	via: 'pointer' | 'keys';
	// Nobody sets anything down perfectly straight. Without this, a plank
	// stood on its end balances for ever.
	lean: THREE.Quaternion;
	before: BuildState;
	returnTo: { position: THREE.Vector3; quaternion: THREE.Quaternion };
};

type Placement = { position: THREE.Vector3; valid: boolean; reason?: string; support?: string };
type Bond = { a: number; b: number | null; anchor1: [number, number, number]; anchor2: [number, number, number]; frame1: [number, number, number, number]; frame2: [number, number, number, number] };
type NailBatch = { bonds: Bond[]; handles: number[]; heads: THREE.Object3D[] };
type BuildState = {
	pieces: { id: number; kind: string; seed: number; position: [number, number, number]; rotation: [number, number, number, number]; snow: number }[];
	bonds: Bond[][];
	nails: number;
	selected: number | null;
};
type NightEvidence = { travelling: number; uncovered: number; leaking: number; initiallyCovered: boolean };


type Aim = { mode: 'pointer'; x: number; y: number } | { mode: 'world'; x: number; z: number };

type Hover = { piece: Piece } | { resident: Resident } | null;

type Bubble = { element: HTMLElement; until: number };


function required<T extends Element>(root: Element, selector: string): T {
	const element = root.querySelector<T>(selector);
	if (!element) throw new Error(`Shack is missing ${selector}`);
	return element;
}

function readStored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStored(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Storage can be unavailable without affecting the game.
	}
}

// The score: one for each person who got through a night dry.
function sleeps(count: number): string {
	return `${count} dry ${count === 1 ? 'sleep' : 'sleeps'}`;
}

// What flipping into a pose does, in words.
function poseVerb(pose: string): string {
	return pose === 'flat' ? 'lays it flat' : `stands it ${pose}`;
}

function vector(value: { x: number; y: number; z: number }, target = new THREE.Vector3()): THREE.Vector3 {
	return target.set(value.x, value.y, value.z);
}

function quaternion(value: { x: number; y: number; z: number; w: number }, target = new THREE.Quaternion()): THREE.Quaternion {
	return target.set(value.x, value.y, value.z, value.w);
}

export class Game {
	private readonly root: HTMLElement;
	private readonly el;
	private readonly random = Math.random;
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

	private readonly world: RAPIER.World;
	private readonly renderer: InkRenderer;
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 90);
	private readonly raycaster = new THREE.Raycaster();
	private readonly hemi = new THREE.HemisphereLight(SKY.skyDay, '#b8c4d4', 1.9);
	private readonly sun = new THREE.DirectionalLight(SKY.sunDay, 1.25);
	private readonly island: Island;
	private readonly precipitation: Precipitation;
	private readonly sound: Sound;

	private readonly ghostFill = createFill(SKY.ghost, { transparent: true, opacity: 0.55, plain: true });
	private readonly ghostInk = createInkMaterial(GHOST_ID);
	private ghost: THREE.Group | null = null;
	private readonly cursorRing: THREE.Mesh;

	private phase: Phase = 'loading';
	private phaseTime = 0;
	private clock = 0;
	private lastTime = 0;
	private accumulator = 0;
	private width = 1;
	private height = 1;

	private yaw = Math.PI * 0.2;
	private yawGoal = Math.PI * 0.2;
	private zoom = 1;
	private zoomGoal = 1;

	private pieces: Piece[] = [];
	private readonly pieceByCollider = new Map<number, Piece>();
	private readonly pieceByBody = new Map<number, Piece>();
	private nextPieceId = 1;
	private residents: Resident[] = [];
	private departed: Resident[] = [];
	private readonly namesUsed = new Set<string>();

	private day = 0;
	private nails = START_NAILS;
	private dryNights = 0;
	private best = 0;
	// The best score before this run, so a tie is not called a new best.
	private bestBefore = 0;
	private forecast: Forecast | null = null;
	private night: Night | null = null;
	private darkness = 0;
	private flash = 0;
	private lightningIn = 6;
	private islandSnow = 0;
	private readonly push = new THREE.Vector3();
	private readonly windFrom = new THREE.Vector3(0, 0, -1);
	private readonly rainDirection = new THREE.Vector3(0, -1, 0);
	private exposureIn = 0;
	private snowIn = 0;
	private chatterIn = 8;

	private held: Held | null = null;
	private placement: Placement | null = null;
	// The last thing put down, which the nail and the buttons act on.
	private selected: Piece | null = null;
	// The press that picked something up. Let go without moving and it stays
	// in hand; drag and let go and it is set down where it was dragged to.
	private pickedOnPress = false;
	// On touch, a tap on the carried piece sets it down.
	private pressedOnGhost = false;
	private aim: Aim | null = null;
	private hover: Hover = null;
	private keyboardCursor: THREE.Vector3 | null = null;

	private readonly pointer = {
		id: -1,
		button: 0,
		down: false,
		dragging: false,
		startX: 0,
		startY: 0,
		x: 0,
		y: 0,
		// Until the first touch or click, guess from the device so the hints read right.
		type: window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse',
	};
	private readonly touches = new Map<number, { x: number; y: number }>();
	private pinchDistance = 0;
	private pinchAngle = 0;
	private wheelTurn = 0;
	private freePlacement = false;
	private undoStack: BuildState[] = [];
	private redoStack: BuildState[] = [];
	private nailBatches: NailBatch[] = [];
	private shelterPlans: (ShelterPlan | null)[] = [];
	private coverage: Spot[] = [];
	private coverageMesh: THREE.InstancedMesh | null = null;
	private readonly placementFoot = new THREE.Mesh(
		new THREE.RingGeometry(0.2, 0.24, 40).rotateX(-Math.PI / 2),
		new THREE.MeshBasicMaterial({ color: '#fff3ce', transparent: true, opacity: 0.8, depthWrite: false }),
	);
	private readonly guide = new THREE.Group();
	private guideRoof: THREE.Group | null = null;
	private readonly nightEvidence = new Map<Resident, NightEvidence>();
	private readonly lanterns: THREE.Group[] = [];
	private nightArmedUntil = 0;

	private timers: { at: number; run: () => void }[] = [];
	private readonly bubbles = new Map<Resident, Bubble>();
	private nameTag: HTMLElement;
	private tenantsSignature = '';
	private hudSignature = '';
	private restartArmedUntil = 0;
	// The night waits until the morning's junk and arrivals have landed.
	private morningUntil = 0;
	private arrivingCount = 0;
	private lastNightResidents: Resident[] = [];
	// When to next look ahead at what would fall and where is safe.
	private lookAheadAt = 0;
	private previewKey = '';
	private previewAt = 0;
	private pendingKey = '';
	// Whether the carried piece would stay where it is about to land.
	private heldWobbly = false;
	private safeSpots: Spot[] = [];
	private readonly markers: THREE.Group[] = [];
	private readonly markerMaterial = new THREE.MeshBasicMaterial({ color: '#5dbe99', transparent: true, opacity: 0.65, depthWrite: false, depthTest: false });

	constructor(root: HTMLElement) {
		this.root = root;
		this.el = {
			stage: required<HTMLElement>(root, '[data-shack-stage]'),
			undo: required<HTMLButtonElement>(root, '[data-shack-undo]'),
			redo: required<HTMLButtonElement>(root, '[data-shack-redo]'),
			close: required<HTMLButtonElement>(root, '[data-shack-close]'),
			place: required<HTMLButtonElement>(root, '[data-shack-place]'),
			editor: required<HTMLElement>(root, '[data-shack-editor]'),
			objectName: required<HTMLElement>(root, '[data-shack-object-name]'),
			objectDetail: required<HTMLElement>(root, '[data-shack-object-detail]'),
			nailLabel: required<HTMLElement>(root, '[data-shack-nail-label]'),
			lesson: required<HTMLElement>(root, '[data-shack-lesson]'),
			lessonTitle: required<HTMLElement>(root, '[data-shack-lesson-title]'),
			lessonDetail: required<HTMLElement>(root, '[data-shack-lesson-detail]'),
			help: required<HTMLDialogElement>(root, '[data-shack-help]'),
			helpOpen: required<HTMLButtonElement>(root, '[data-shack-help-open]'),
			helpClose: required<HTMLButtonElement>(root, '[data-shack-help-close]'),
			canvas: required<HTMLCanvasElement>(root, '[data-shack-canvas]'),
			bubbles: required<HTMLElement>(root, '[data-shack-bubbles]'),
			daybar: required<HTMLElement>(root, '[data-shack-daybar]'),
			day: required<HTMLElement>(root, '[data-shack-day]'),
			phase: required<HTMLElement>(root, '[data-shack-phase]'),
			forecast: required<HTMLElement>(root, '[data-shack-forecast]'),
			forecastHeadline: required<HTMLElement>(root, '[data-shack-forecast-headline]'),
			forecastDetail: required<HTMLElement>(root, '[data-shack-forecast-detail]'),
			forecastAside: required<HTMLElement>(root, '[data-shack-forecast-aside]'),
			compass: required<SVGElement>(root, '[data-shack-compass]'),
			tenantsPanel: required<HTMLElement>(root, '[data-shack-tenants-panel]'),
			tenants: required<HTMLElement>(root, '[data-shack-tenants]'),
			score: required<HTMLElement>(root, '[data-shack-score]'),
			storm: required<HTMLElement>(root, '[data-shack-storm]'),
			stormFill: required<HTMLElement>(root, '[data-shack-storm-fill]'),
			toasts: required<HTMLElement>(root, '[data-shack-toasts]'),
			announcer: required<HTMLElement>(root, '[data-shack-announcer]'),
			dock: required<HTMLElement>(root, '[data-shack-dock]'),
			hint: required<HTMLElement>(root, '[data-shack-hint]'),
			goal: required<HTMLElement>(root, '[data-shack-goal]'),
			goalCount: required<HTMLElement>(root, '[data-shack-goal-count]'),
			goalDetail: required<HTMLElement>(root, '[data-shack-goal-detail]'),
			rotate: required<HTMLButtonElement>(root, '[data-shack-rotate]'),
			flip: required<HTMLButtonElement>(root, '[data-shack-flip]'),
			flipLabel: required<HTMLElement>(root, '[data-shack-flip-label]'),
			nail: required<HTMLButtonElement>(root, '[data-shack-nail]'),
			nails: required<HTMLElement>(root, '[data-shack-nails]'),
			night: required<HTMLButtonElement>(root, '[data-shack-night]'),
			sound: required<HTMLButtonElement>(root, '[data-shack-sound]'),
			soundOn: required<SVGElement>(root, '[data-shack-sound-on]'),
			soundOff: required<SVGElement>(root, '[data-shack-sound-off]'),
			restart: required<HTMLButtonElement>(root, '[data-shack-restart]'),
			titleCard: required<HTMLElement>(root, '[data-shack-title-card]'),
			start: required<HTMLButtonElement>(root, '[data-shack-start]'),
			loading: required<HTMLElement>(root, '[data-shack-loading]'),
			ready: required<HTMLElement>(root, '[data-shack-ready]'),
			bestLine: required<HTMLElement>(root, '[data-shack-best-line]'),
			bestValue: required<HTMLElement>(root, '[data-shack-best]'),
			report: required<HTMLElement>(root, '[data-shack-report]'),
			reportKicker: required<HTMLElement>(root, '[data-shack-report-kicker]'),
			reportTitle: required<HTMLElement>(root, '[data-shack-report-title]'),
			reportList: required<HTMLElement>(root, '[data-shack-report-list]'),
			reportScore: required<HTMLElement>(root, '[data-shack-report-score]'),
			reportNext: required<HTMLButtonElement>(root, '[data-shack-report-next]'),
			over: required<HTMLElement>(root, '[data-shack-over]'),
			overTitle: required<HTMLElement>(root, '[data-shack-over-title]'),
			overSub: required<HTMLElement>(root, '[data-shack-over-sub]'),
			overScore: required<HTMLElement>(root, '[data-shack-over-score]'),
			overBest: required<HTMLElement>(root, '[data-shack-over-best]'),
			again: required<HTMLButtonElement>(root, '[data-shack-again]'),
		};

		this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
		this.world.timestep = STEP;
		this.world.numSolverIterations = 8;

		this.renderer = new InkRenderer(this.el.canvas, this.random);
		this.renderer.look.still = this.reducedMotion.matches;
		this.reducedMotion.addEventListener('change', () => {
			this.renderer.look.still = this.reducedMotion.matches;
		});

		this.sun.position.set(5, 12, 3.5);
		this.sun.castShadow = true;
		this.sun.shadow.mapSize.set(2048, 2048);
		const shadowCamera = this.sun.shadow.camera;
		shadowCamera.left = -7;
		shadowCamera.right = 7;
		shadowCamera.top = 7;
		shadowCamera.bottom = -7;
		shadowCamera.near = 1;
		shadowCamera.far = 40;
		this.sun.shadow.bias = -0.0006;
		this.sun.shadow.normalBias = 0.02;
		this.scene.add(this.hemi, this.sun, this.sun.target);

		this.island = buildIsland(this.world, this.random);
		this.scene.add(this.island.group);

		this.precipitation = new Precipitation((origin, direction, max) => {
			const hit = this.world.castRay(new RAPIER.Ray(origin, direction), max, true, undefined, ANY_QUERY);
			return hit ? hit.timeOfImpact : null;
		}, this.random);
		this.scene.add(this.precipitation.group);

		this.cursorRing = new THREE.Mesh(
			new THREE.RingGeometry(0.2, 0.28, 32).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: '#e0588a', depthTest: false, transparent: true, opacity: 0.9 }),
		);
		this.cursorRing.renderOrder = 10;
		this.cursorRing.visible = false;
		this.scene.add(this.cursorRing, this.placementFoot, this.guide);
		this.placementFoot.visible = false;

		this.nameTag = document.createElement('div');
		this.nameTag.className = 'shack-bubble shack-bubble--name';
		this.el.bubbles.append(this.nameTag);

		this.sound = new Sound(readStored(SOUND_KEY) !== 'off');
		this.reflectSound();
		this.best = Number.parseInt(readStored(BEST_KEY) ?? '0', 10) || 0;
		this.el.bestValue.textContent = String(this.best);
		this.el.bestLine.hidden = this.best === 0;

		this.listen();
		new ResizeObserver(() => this.resize()).observe(this.el.stage);
		this.resize();

		this.setPhase('title');
		this.dressTitle();
		this.el.loading.hidden = true;
		this.el.ready.hidden = false;
		this.el.start.disabled = false;
		this.el.start.focus({ preventScroll: true });
		requestAnimationFrame(this.frame);
		// Local development inspection; never expose the simulation on the public site.
		if (import.meta.env.DEV) Object.assign(window, { shack: this, shackTest: { junkKind, THREE } });
	}

	// ── Setup ──────────────────────────────────────────────────────────

	private listen(): void {
		const { stage } = this.el;
		stage.addEventListener('pointerdown', (event) => this.onPointerDown(event));
		stage.addEventListener('pointermove', (event) => this.onPointerMove(event));
		stage.addEventListener('pointerup', (event) => this.onPointerUp(event));
		stage.addEventListener('pointercancel', (event) => this.onPointerUp(event, true));
		stage.addEventListener('pointerleave', () => {
			if (!this.pointer.down) {
				this.setHover(null);
				if (!this.held && this.aim?.mode === 'pointer') this.aim = null;
			}
		});
		stage.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
		stage.addEventListener('contextmenu', (event) => event.preventDefault());
		this.root.addEventListener('keydown', (event) => this.onKeyDown(event));

		this.el.start.addEventListener('click', () => {
			this.sound.wake();
			this.startRun();
		});
		this.el.again.addEventListener('click', () => {
			this.sound.wake();
			this.startRun();
		});
		this.el.reportNext.addEventListener('click', () => this.continueFromReport());
		this.el.night.addEventListener('click', () => this.beginDusk());
		this.el.rotate.addEventListener('click', () => this.turn(1));
		this.el.flip.addEventListener('click', () => this.flip());
		this.el.nail.addEventListener('click', () => this.nailSelected());
		this.el.sound.addEventListener('click', () => {
			this.sound.setEnabled(!this.sound.enabled);
			writeStored(SOUND_KEY, this.sound.enabled ? 'on' : 'off');
			this.reflectSound();
		});
		this.el.restart.addEventListener('click', () => this.requestRestart());
		this.el.undo.addEventListener('click', () => this.undo());
		this.el.redo.addEventListener('click', () => this.redo());
		this.el.place.addEventListener('click', () => this.placeHeld());
		this.el.close.addEventListener('click', () => {
			if (this.held) this.cancelHeld();
			else this.select(null);
		});
		this.el.helpOpen.addEventListener('click', () => this.el.help.showModal());
		this.el.helpClose.addEventListener('click', () => this.el.help.close());
		window.addEventListener('blur', () => {
			if (this.held?.via === 'pointer') this.cancelHeld();
			this.pointer.down = false;
			this.pointer.dragging = false;
			this.touches.clear();
		});
		document.addEventListener('visibilitychange', () => { this.lastTime = 0; });
	}

	private reflectSound(): void {
		const on = this.sound.enabled;
		this.el.sound.setAttribute('aria-pressed', String(on));
		this.el.sound.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
		this.el.soundOn.classList.toggle('hidden', !on);
		this.el.soundOff.classList.toggle('hidden', on);
	}

	private resize(): void {
		const width = this.el.stage.clientWidth;
		const height = this.el.stage.clientHeight;
		if (width <= 0 || height <= 0) return;
		this.width = width;
		this.height = height;
		const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
		this.renderer.setSize(width, height, pixelRatio);
		this.precipitation.setResolution(width, height, pixelRatio);
		this.updateCamera(1);
	}

	// ── Phases ─────────────────────────────────────────────────────────

	private setPhase(phase: Phase): void {
		this.phase = phase;
		this.phaseTime = 0;
		this.root.dataset.phase = phase;
		const playing = phase !== 'title' && phase !== 'loading';
		this.el.daybar.hidden = !playing;
		this.el.tenantsPanel.hidden = !playing;
		this.el.dock.hidden = phase !== 'build';
		this.el.storm.hidden = phase !== 'storm';
		this.el.forecast.hidden = phase !== 'build' || !this.forecast;
		this.el.lesson.hidden = phase !== 'build' || this.day !== 1;
		this.guide.visible = phase === 'build' && this.day === 1;
		if (this.coverageMesh) this.coverageMesh.visible = phase === 'build';
		this.el.titleCard.hidden = phase !== 'title' && phase !== 'loading';
		this.el.report.hidden = phase !== 'report';
		this.el.over.hidden = phase !== 'over';
		this.el.day.textContent = `day ${this.day}`;
		this.el.phase.textContent = {
			loading: '',
			title: '',
			build: 'building',
			dusk: 'getting dark',
			storm: 'night',
			dawn: 'morning',
			report: 'morning',
			farewell: 'morning',
			over: 'over',
		}[phase];
		if (phase !== 'build') {
			this.select(null);
			this.setHover(null);
		}
		for (const marker of this.markers) marker.visible = phase === 'build' && marker.userData.used === true;
		this.hudSignature = '';
	}

	// The title screen: a quiet island with a bit of junk and one early riser.
	private dressTitle(): void {
		for (const [index, id] of ['crate', 'plank', 'tire', 'door'].entries()) {
			const angle = index * 1.7 + 0.4;
			const kind = junkKind(id);
			const at = new THREE.Vector3(Math.cos(angle) * 1.8, 0, Math.sin(angle) * 1.8);
			const q = new THREE.Quaternion().setFromAxisAngle(UP, angle);
			const placement = this.dropShape(kind, at.x, at.z, q);
			this.addPiece(kind, placement.position, q);
		}
		const resident = this.makeResident();
		resident.spawnAbove(new THREE.Vector3(0.6, 0, 0.4));
	}

	private startRun(): void {
		for (const piece of [...this.pieces]) this.removePiece(piece);
		for (const resident of [...this.residents, ...this.departed]) this.disposeResident(resident);
		this.residents = [];
		this.departed = [];
		this.namesUsed.clear();
		this.timers = [];
		this.undoStack = [];
		this.redoStack = [];
		this.keyboardCursor = null;
		this.shelterPlans = [];
		this.nightEvidence.clear();
		this.clearLanterns();
		this.precipitation.clear();
		this.held = null;
		this.removeGhost();
		this.select(null);
		this.safeSpots = [];
		this.islandSnow = 0;
		this.day = 0;
		this.dryNights = 0;
		this.bestBefore = this.best;
		this.el.score.textContent = '0';
		this.nails = START_NAILS;
		this.night = null;
		this.el.toasts.replaceChildren();
		this.el.stage.focus({ preventScroll: true });
		this.nextDay();
	}

	private nextDay(): void {
		this.day += 1;
		this.undoStack = [];
		this.redoStack = [];
		this.clearLanterns();
		this.forecast = forecastFor(this.day, this.random);
		if (this.day > 1) this.nails = Math.min(MAX_NAILS, this.nails + 2);
		for (const resident of this.residents) {
			resident.result = null;
			resident.exposure = { sky: 0, wind: 0 };
		}
		this.setPhase('build');
		this.showForecast();

		const arrivals = this.day === 1 ? 2 : this.presentResidents().length < MAX_RESIDENTS ? 1 : 0;
		for (let index = 0; index < arrivals; index += 1) this.after(1.4 + index * 1.6, () => this.arrive());
		this.morningUntil = this.clock + (arrivals ? 1.4 + (arrivals - 1) * 1.6 + 6 : 0);

		const junk = this.day === 1
			? STARTER_KIT.map(junkKind)
			: drawJunk(this.day, 3 + Math.floor(this.day / 2), this.random);
		this.after(0.2, () => this.toast(words.pick(words.JUNK_ARRIVAL, this.random)));
		if (this.day === 1) this.prepareFirstBuild();
		else this.dropJunk(junk);
		this.morningUntil = Math.max(this.morningUntil, this.clock + 0.5 + junk.length * 0.45);
		this.aimWeather();
		this.markChanged();
		this.announce(`Day ${this.day}. ${this.forecast.headline}. ${this.forecast.detail}`);
		this.updateHud();
	}

	private beginDusk(): void {
		if (this.phase !== 'build' || this.clock < this.morningUntil) return;
		if (this.held) {
			if (this.placement?.valid) this.placeHeld();
			else this.cancelHeld();
		}
		this.lookAhead();
		if (this.safeSpots.length < this.presentResidents().length && this.clock >= this.nightArmedUntil) {
			this.nightArmedUntil = this.clock + 4;
			this.toast('not everyone has a dry spot. press it again to go anyway.');
			return;
		}
		this.nightArmedUntil = 0;
		this.nightEvidence.clear();
		this.setPhase('dusk');
		this.sound.dusk();
		this.aimWeather();
		// A moment for anything still settling to settle, before anyone picks
		// a spot under it.
		this.after(1.3, () => {
			this.assignSpots();
			for (const resident of this.presentResidents()) {
				this.after(0.3 + this.random() * 1.2, () => {
					if (this.random() < 0.6) this.say(resident, words.pick(words.SHELTERING, this.random));
				});
			}
		});
		for (const resident of this.presentResidents()) resident.wet = Math.min(resident.wet, 0.15);
		this.lastNightResidents = this.presentResidents();
	}

	private beginStorm(): void {
		if (!this.forecast) return;
		for (const resident of this.presentResidents()) {
			resident.wet = 0;
			const cover = coverAt(this.world, resident.position, this.rainDirection, this.windFrom);
			this.nightEvidence.set(resident, { travelling: 0, uncovered: 0, leaking: 0, initiallyCovered: cover.roof === 1 });
		}
		this.lightShelter();
		this.night = new Night(this.forecast);
		this.lightningIn = 3 + this.random() * 4;
		this.setPhase('storm');
		this.announce(`${this.forecast.headline}.`);
	}

	private beginDawn(): void {
		this.setPhase('dawn');
		this.sound.dawn();
		for (const piece of this.pieces) {
			piece.body.resetForces(true);
			piece.body.resetTorques(true);
		}
		for (const resident of this.lastNightResidents) {
			if (resident.result !== 'blown') {
				resident.result = resident.wet < 0.22 ? 'dry' : resident.wet < 0.6 ? 'damp' : 'soaked';
			}
			if (resident.result === 'soaked') resident.patience -= 1;
			if (resident.result === 'dry') resident.patience = Math.min(2, resident.patience + 1);
			if (resident.present) resident.wakeUp();
		}
		this.night = null;
	}

	private showReport(): void {
		const results = this.lastNightResidents.map((resident) => resident.result ?? 'dry');
		const dry = results.filter((result) => result === 'dry').length;
		this.dryNights += dry;
		if (this.dryNights > this.best) {
			this.best = this.dryNights;
			writeStored(BEST_KEY, String(this.best));
		}
		this.setPhase('report');
		this.el.reportKicker.textContent = `the morning after night ${this.day}`;
		this.el.reportTitle.textContent = dry === results.length ? 'everyone\'s dry.' : dry === 0 ? 'nobody\'s dry.' : `${dry} of ${results.length} dry.`;
		const usedLines = new Set<string>();
		this.el.reportList.replaceChildren(...this.lastNightResidents.map((resident) => {
			const item = document.createElement('li');
			const mark = document.createElement('span');
			mark.className = 'shack-report__mark';
			mark.style.setProperty('--swatch', resident.color);
			const line = document.createElement('span');
			const result: NightResult = resident.result ?? 'dry';
			const unused = words.RESULT_LINES[result].filter((line) => !usedLines.has(line));
			const template = words.pick(unused.length > 0 ? unused : words.RESULT_LINES[result], this.random);
			usedLines.add(template);
			let text = words.fill(template, resident.name);
			const evidence = this.nightEvidence.get(resident);
			if (evidence && (result === 'damp' || result === 'soaked')) {
				text += evidence.travelling > Math.max(evidence.uncovered, evidence.leaking)
					? ' it got them on the way over.'
					: evidence.initiallyCovered ? ' their roof moved in the night. nails, maybe.'
						: evidence.leaking > evidence.uncovered ? ' the rain came in at the edges. a wider roof, maybe.'
							: ' there was no roof over them.';
			}
			if (resident.patience <= 0 && result !== 'blown') text += ' they\'re leaving.';
			line.textContent = text;
			item.append(mark, line);
			return item;
		}));
		const staying = this.lastNightResidents.filter((resident) => resident.present && resident.patience > 0).length;
		this.el.reportScore.textContent = staying === 0
			? `${sleeps(this.dryNights)} in all.`
			: `${dry} more tonight, ${sleeps(this.dryNights)} so far. tomorrow: more junk${this.nails < MAX_NAILS ? ', more nails' : ''}${this.presentResidents().length < MAX_RESIDENTS ? ', someone new' : ''}.`;
		this.el.reportNext.textContent = staying === 0 ? 'see them off' : 'start the day';
		this.el.reportNext.focus({ preventScroll: true });
		this.el.score.textContent = String(this.dryNights);
	}

	private continueFromReport(): void {
		if (this.phase !== 'report') return;
		for (const resident of this.residents) {
			if (resident.state === 'drifting' || resident.state === 'gone') continue;
			if (resident.patience > 0) continue;
			resident.leave(this.edgeNear(resident.position));
			this.after(0.4, () => this.toast(words.fill(words.pick(words.RESULT_LINES.left, this.random), resident.name)));
		}
		const staying = this.residents.filter((resident) => resident.patience > 0 && resident.present);
		this.departed.push(...this.residents.filter((resident) => !staying.includes(resident)));
		this.residents = staying;
		if (staying.length === 0) {
			this.setPhase('farewell');
			this.after(3.2, () => this.gameOver());
			return;
		}
		this.nextDay();
	}

	private gameOver(): void {
		this.setPhase('over');
		this.sound.lose();
		this.el.overTitle.textContent = words.pick(words.GAME_OVER, this.random);
		this.el.overSub.textContent = words.pick(words.GAME_OVER_SUB, this.random);
		this.el.overScore.textContent = `${sleeps(this.dryNights)} over ${this.day} ${this.day === 1 ? 'night' : 'nights'}.`;
		this.el.overBest.textContent = this.dryNights > this.bestBefore ? 'that\'s your best yet.' : `best: ${this.best}.`;
		this.el.bestValue.textContent = String(this.best);
		this.el.bestLine.hidden = this.best === 0;
		this.el.again.focus({ preventScroll: true });
	}

	private requestRestart(): void {
		if (this.phase === 'title' || this.phase === 'over' || this.phase === 'loading') {
			this.startRun();
			return;
		}
		if (this.clock < this.restartArmedUntil) {
			this.restartArmedUntil = 0;
			this.startRun();
			return;
		}
		this.restartArmedUntil = this.clock + 3;
		this.toast('press it again to start over.');
	}

	private updatePhase(delta: number): void {
		this.phaseTime += delta;
		if (this.phase === 'dusk' && this.phaseTime >= DUSK_SECONDS) {
			const walking = this.presentResidents().some((resident) => resident.state === 'seeking');
			if (!walking || this.phaseTime >= MAX_DUSK_SECONDS) this.beginStorm();
		}
		else if (this.phase === 'storm' && this.night?.over) this.beginDawn();
		else if (this.phase === 'dawn' && this.phaseTime >= DAWN_SECONDS) this.showReport();
		else if (this.phase === 'title') this.yawGoal += delta * 0.08;
	}

	// ── Timers and words ───────────────────────────────────────────────

	private after(seconds: number, run: () => void): void {
		this.timers.push({ at: this.clock + seconds, run });
	}

	private runTimers(): void {
		if (this.timers.length === 0) return;
		const due = this.timers.filter((timer) => timer.at <= this.clock);
		if (due.length === 0) return;
		this.timers = this.timers.filter((timer) => timer.at > this.clock);
		for (const timer of due) timer.run();
	}

	private toast(text: string): void {
		const line = document.createElement('p');
		line.textContent = text;
		this.el.toasts.append(line);
		while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild?.remove();
		window.setTimeout(() => line.classList.add('is-leaving'), 3800);
		window.setTimeout(() => line.remove(), 4300);
	}

	// Screen readers hear the forecast and the night coming without a toast.
	private announce(text: string): void {
		this.el.announcer.textContent = text;
	}

	private say(resident: Resident, text: string, seconds = 2.8): void {
		if (!resident.present && resident.state !== 'leaving') return;
		let bubble = this.bubbles.get(resident);
		if (!bubble) {
			const element = document.createElement('div');
			element.className = 'shack-bubble';
			this.el.bubbles.append(element);
			bubble = { element, until: 0 };
			this.bubbles.set(resident, bubble);
		}
		bubble.element.textContent = text;
		bubble.element.classList.add('is-showing');
		bubble.until = this.clock + seconds;
		this.sound.mumble(Math.max(0, this.residents.indexOf(resident)) % 5);
	}

	private showForecast(): void {
		const forecast = this.forecast;
		if (!forecast) return;
		this.el.forecastHeadline.textContent = forecast.headline;
		this.el.forecastDetail.textContent = forecast.detail;
		this.el.forecastAside.textContent = forecast.aside;
		this.el.forecast.hidden = false;
	}

	// ── Residents ──────────────────────────────────────────────────────

	private presentResidents(): Resident[] {
		return this.residents.filter((resident) => resident.present);
	}

	private makeResident(): Resident {
		const available = words.NAMES.filter((name) => !this.namesUsed.has(name));
		const name = words.pick(available.length > 0 ? available : words.NAMES, this.random);
		this.namesUsed.add(name);
		const resident = new Resident(this.world, name, this.random);
		this.scene.add(resident.group);
		this.residents.push(resident);
		return resident;
	}

	private arrive(): void {
		if (this.phase !== 'build') return;
		const resident = this.makeResident();
		resident.spawnAbove(this.randomGroundSpot() ?? new THREE.Vector3());
		this.toast(words.fill(words.pick(words.ARRIVALS, this.random), resident.name));
		this.sound.arrive();
		this.tenantsSignature = '';
		this.markChanged();
		this.updateGoal();
	}

	private disposeResident(resident: Resident): void {
		resident.dispose();
		this.bubbles.get(resident)?.element.remove();
		this.bubbles.delete(resident);
	}

	private edgeNear(at: THREE.Vector3): THREE.Vector3 {
		const angle = Math.atan2(at.z, at.x);
		return new THREE.Vector3(Math.cos(angle) * ISLAND_RADIUS * 1.2, 0, Math.sin(angle) * ISLAND_RADIUS * 1.2);
	}

	private randomGroundSpot(): THREE.Vector3 | null {
		for (let attempt = 0; attempt < 40; attempt += 1) {
			const angle = this.random() * Math.PI * 2;
			const radius = Math.sqrt(this.random()) * ISLAND_RADIUS * 0.8;
			const x = Math.cos(angle) * radius;
			const z = Math.sin(angle) * radius;
			if (!this.island.contains(x, z, 0.7)) continue;
			const ground = groundAt(this.world, x, z);
			if (ground && clearAt(this.world, ground)) return ground;
		}
		return null;
	}

	private nearbySpot(resident: Resident): THREE.Vector3 | null {
		for (let attempt = 0; attempt < 12; attempt += 1) {
			const angle = this.random() * Math.PI * 2;
			const reach = 0.8 + this.random() * 1.8;
			const x = resident.position.x + Math.cos(angle) * reach;
			const z = resident.position.z + Math.sin(angle) * reach;
			if (!this.island.contains(x, z, 0.8)) continue;
			const ground = groundAt(this.world, x, z);
			if (ground && clearAt(this.world, ground)) return ground;
		}
		return null;
	}

	// What makes a spot safe tonight. Rain always needs a roof; a proper wind
	// also needs a wall on the side it blows from.
	private needs(): Needs {
		return { wall: (this.forecast?.wind ?? 0) >= 0.5 };
	}

	// Tonight's rain and wind as they will be when the weather arrives.
	private aimWeather(): void {
		const forecast = this.forecast;
		if (!forecast) return;
		fromVector(forecast.windFrom, this.windFrom);
		this.rainDirection.copy(this.windFrom).multiplyScalar(-forecast.wind * 0.28).setY(-1).normalize();
	}

	private spotsIn(world: RAPIER.World): Spot[] {
		const needs = this.needs();
		const spots = findSpots(world, (x, z, margin) => this.island.contains(x, z, margin), this.rainDirection, this.windFrom, needs);
		const forecast = this.forecast;
		if (!forecast) return spots;
		// Preview the changing forecast, including rain at the peak of a gust.
		// A roof which only works before the wind turns should not show green.
		const peak = forecast.wind * (1 + forecast.gust * 1.35);
		const profiles = (forecast.shift ? [0, 0.25, 0.5, 0.75, 1] : [0]).map((progress) => {
			const from = fromVector(forecast.windFrom + forecast.shift * progress);
			return { from, rain: from.clone().multiplyScalar(-peak * 0.28).setY(-1).normalize() };
		});
		profiles.push({ from: this.windFrom.clone(), rain: new THREE.Vector3(0, -1, 0) });
		for (const spot of spots) {
			if (spot.cover.roof === 0) continue;
			for (const profile of profiles) {
				const cover = coverAt(world, spot.at, profile.rain, profile.from);
				spot.cover.roof = Math.min(spot.cover.roof, cover.roof);
				spot.cover.wall = Math.min(spot.cover.wall, cover.wall);
			}
			spot.safe = isSafe(spot.cover, needs);
			spot.score = (spot.safe ? 1 : 0) + spot.cover.roof * 0.62 + spot.cover.wall * 0.38;
		}
		return spots.sort((a, b) => b.score - a.score);
	}

	private assignSpots(): void {
		const people = this.presentResidents();
		this.shelterPlans = planShelter(this.spotsIn(this.world), people.map((resident) => resident.position), SPOT_SPACING);
		for (const [index, resident] of people.entries()) {
			const plan = this.shelterPlans[index];
			resident.seek(plan?.spot.at ?? null, plan?.route);
		}
	}

	// ── Junk ───────────────────────────────────────────────────────────

	private addPiece(
		kind: JunkKind,
		position: THREE.Vector3,
		rotation: THREE.Quaternion,
		seed = this.random() * 1000,
	): Piece {
		const body = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.dynamic()
				.setTranslation(position.x, position.y, position.z)
				.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
				.setLinearDamping(0.08)
				.setAngularDamping(0.4)
				.setCcdEnabled(true),
		);
		const model = buildJunkModel(kind, seed);
		const inkId = claimInkId();
		const ink = createInkMaterial(inkId);
		inkify(model.group, ink);
		model.group.position.copy(position);
		model.group.quaternion.copy(rotation);
		this.scene.add(model.group);
		const piece: Piece = {
			id: this.nextPieceId++,
			kind,
			seed,
			body,
			model,
			ink,
			inkId,
			nailed: false,
			partners: new Set(),
			wobbly: false,
			snow: 0,
			shelter: 1,
			lift: 1,
			shelterCheck: 0,
			lastSpeed: 0,
			lastSound: 0,
			from: { position: position.clone(), quaternion: rotation.clone() },
		};
		for (const description of junkColliders(kind)) {
			const collider = this.world.createCollider(description.setCollisionGroups(JUNK_GROUPS), body);
			this.pieceByCollider.set(collider.handle, piece);
		}
		this.pieceByBody.set(body.handle, piece);
		this.pieces.push(piece);
		this.markChanged();
		return piece;
	}

	private removePiece(piece: Piece): void {
		this.detach(piece, false);
		for (let index = 0; index < piece.body.numColliders(); index += 1) {
			this.pieceByCollider.delete(piece.body.collider(index).handle);
		}
		this.pieceByBody.delete(piece.body.handle);
		for (const other of this.pieces) other.partners.delete(piece.body.handle);
		this.world.removeRigidBody(piece.body);
		piece.model.group.removeFromParent();
		piece.model.group.traverse((child) => {
			if (child instanceof THREE.Mesh) child.geometry.dispose();
		});
		for (const material of piece.model.materials) material.dispose();
		piece.ink.dispose();
		this.pieces = this.pieces.filter((candidate) => candidate !== piece);
		if (this.hover && 'piece' in this.hover && this.hover.piece === piece) this.hover = null;
		if (this.selected === piece) this.select(null);
		this.markChanged();
	}

	// Where two bodies touch, if they do.
	private contactBetween(a: RAPIER.RigidBody, b: RAPIER.RigidBody): THREE.Vector3 | null {
		for (let first = 0; first < a.numColliders(); first += 1) {
			for (let second = 0; second < b.numColliders(); second += 1) {
				const contact = a.collider(first).contactCollider(b.collider(second), 0.05);
				if (contact && contact.distance < 0.05) {
					return vector(contact.point1).add(vector(contact.point2)).multiplyScalar(0.5);
				}
			}
		}
		return null;
	}


	private dropJunk(kinds: JunkKind[]): void {
		kinds.forEach((kind, index) => {
			this.after(0.5 + index * 0.45, () => {
				if (this.phase !== 'build') return;
				const choices = junkPoses(kind);
				const rotation = new THREE.Quaternion()
					.setFromAxisAngle(UP, this.random() * Math.PI * 2)
					.multiply(choices[Math.floor(this.random() * choices.length)].rotation);
				// Somewhere on bare ground, well clear of the edge and of anything built.
				const resting = junkShape(kind).half.y * 1.2 + 0.05;
				let bestSpot: Placement | null = null;
				for (let attempt = 0; attempt < 24; attempt += 1) {
					const angle = this.random() * Math.PI * 2;
					const radius = ISLAND_RADIUS * (0.3 + this.random() * 0.45);
					const spot = this.dropShape(kind, Math.cos(angle) * radius, Math.sin(angle) * radius, rotation);
					if (spot.valid && (!bestSpot || spot.position.y < bestSpot.position.y)) bestSpot = spot;
					if (bestSpot && bestSpot.position.y < resting) break;
				}
				const at = bestSpot?.position ?? new THREE.Vector3(0, 0.5, 0);
				const piece = this.addPiece(kind, new THREE.Vector3(at.x, at.y + 2.4, at.z), rotation);
				piece.body.setAngvel({ x: (this.random() - 0.5) * 1.2, y: (this.random() - 0.5) * 1.2, z: (this.random() - 0.5) * 1.2 }, true);
			});
		});
	}

	// Where a shape would come to rest if lowered straight down at x, z,
	// ignoring `exclude`. Rapier only updates what its queries can see when
	// the world steps, so a piece being moved is excluded rather than removed
	// first, or its old self would still be in the way.
	private dropShape(kind: JunkKind, x: number, z: number, rotation: THREE.Quaternion, exclude?: RAPIER.RigidBody): Placement {
		const shape = junkShape(kind);
		const from = { x, y: 14, z };
		const hit = this.world.castShape(
			from,
			{ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
			{ x: 0, y: -1, z: 0 },
			shape.compound,
			0,
			40,
			true,
			undefined,
			SOLID_QUERY,
			undefined,
			exclude,
		);
		if (!hit) return { position: new THREE.Vector3(x, 0.4, z), valid: false };
		const y = 14 - hit.time_of_impact + 0.01;
		return { position: new THREE.Vector3(x, y, z), valid: y < 5 && this.island.contains(x, z, -0.3), reason: y >= 5 ? 'too high. nothing up there to hold it.' : undefined, support: this.pieceByCollider.get(hit.collider.handle)?.kind.name ?? 'ground' };
	}

	// ── Holding, turning, flipping ─────────────────────────────────────

	private rotationFor(kind: JunkKind, yaw: number, pose: number, target = new THREE.Quaternion()): THREE.Quaternion {
		return target.setFromAxisAngle(UP, yaw).multiply(junkPoses(kind)[pose].rotation);
	}

	private heldRotation(held: Held, target = new THREE.Quaternion()): THREE.Quaternion {
		return this.rotationFor(held.kind, held.yaw, held.pose, target).premultiply(held.lean);
	}

	// Half a degree off true, around some level axis.
	private lean(): THREE.Quaternion {
		const heading = this.random() * Math.PI * 2;
		return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading)), 0.008);
	}

	// Which of its poses a piece is closest to, and which way it faces.
	private poseOf(kind: JunkKind, rotation: THREE.Quaternion): { pose: number; yaw: number } {
		const choices = junkPoses(kind);
		const up = UP.clone().applyQuaternion(rotation.clone().invert());
		const axis = Math.abs(up.x) >= Math.abs(up.y) && Math.abs(up.x) >= Math.abs(up.z) ? 'x' : Math.abs(up.y) >= Math.abs(up.z) ? 'y' : 'z';
		const half = junkShape(kind).half;
		let pose = choices.findIndex((choice) => choice.axis === axis);
		// A crate is the same whichever way up, so only one of its axes has a pose.
		if (pose < 0) {
			pose = choices.reduce((closest, choice, index) =>
				Math.abs(half[choice.axis] - half[axis]) < Math.abs(half[choices[closest].axis] - half[axis]) ? index : closest, 0);
		}
		const facing = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation.clone().multiply(choices[pose].rotation.clone().invert()));
		return { pose, yaw: Math.atan2(-facing.z, facing.x) };
	}

	private pickUp(piece: Piece, via: 'pointer' | 'keys'): boolean {
		if (this.phase !== 'build' || (this.day > 1 && this.clock < this.morningUntil)) return false;
		if (piece.nailed) {
			this.select(piece);
			this.toast(words.pick(words.NAILED_DOWN, this.random));
			this.sound.nope();
			return false;
		}
		const position = vector(piece.body.translation());
		const rotation = quaternion(piece.body.rotation());
		const { pose, yaw } = this.poseOf(piece.kind, rotation);
		const before = this.captureBuild();
		this.held = { kind: piece.kind, yaw, pose, seed: piece.seed, via, lean: this.lean(), before, returnTo: { position, quaternion: rotation } };
		this.previewKey = '';
		this.heldWobbly = false;
		this.removePiece(piece);
		this.select(null);
		this.sound.pickUp();
		this.buildGhost(piece.kind);
		this.setHover(null);
		return true;
	}

	private placeHeld(): boolean {
		const held = this.held;
		const placement = this.placement;
		if (!held) return false;
		if (!placement?.valid) {
			this.toast(placement?.reason ?? 'it can\'t go there.');
			this.sound.nope();
			return false;
		}
		this.remember(held.before);
		const piece = this.addPiece(held.kind, placement.position, this.heldRotation(held), held.seed);
		this.held = null;
		this.placement = null;
		this.removeGhost();
		this.sound.thunk(0.35, THREE.MathUtils.clamp(0.32 / Math.sqrt(piece.body.mass()), 0.55, 1.6), METAL.has(held.kind.id));
		this.bonkNear(placement.position, 0.9);
		this.select(piece);
		return true;
	}

	private cancelHeld(): void {
		const held = this.held;
		if (!held) return;
		this.restoreBuild(held.before);
		this.held = null;
		this.placement = null;
		this.removeGhost();
		this.sound.cancel();
	}

	private select(piece: Piece | null): void {
		this.selected = piece;
		this.hudSignature = '';
	}

	// Preserve the support level when rotating. Casting from the sky would
	// wrongly lift a crate onto the very roof it is supporting.
	private reshape(piece: Piece, yaw: number, pose: number): void {
		if (piece.nailed) {
			this.toast(words.pick(words.NAILED_DOWN, this.random));
			this.sound.nope();
			return;
		}
		const before = this.captureBuild();
		const position = vector(piece.body.translation());
		const rotation = quaternion(piece.body.rotation());
		const { kind, seed } = piece;
		const turned = this.rotationFor(kind, yaw, pose);
		const { half, centre } = junkShape(kind);
		const bottom = (q: THREE.Quaternion) => new THREE.Box3(centre.clone().sub(half), centre.clone().add(half))
			.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)).min.y;
		position.y += bottom(rotation) - bottom(turned);
		// If the turned piece would not fit where it is, it lands on top of
		// whatever is in the way, rather than refusing to turn.
		if (this.overlaps(kind, position, turned, piece.body) || position.y > 5) {
			const landing = this.dropShape(kind, position.x, position.z, turned, piece.body);
			if (!landing.valid) {
				this.toast('no room to turn it here.');
				this.sound.nope();
				return;
			}
			position.copy(landing.position);
		}
		this.removePiece(piece);
		this.select(this.addPiece(kind, position, turned, seed));
		this.remember(before);
		this.sound.turn();
	}

	private turn(direction: number): void {
		if (this.held) {
			this.held.yaw += TURN * direction;
			this.sound.turn();
		} else if (this.selected && this.phase === 'build') {
			const { pose, yaw } = this.poseOf(this.selected.kind, quaternion(this.selected.body.rotation()));
			this.reshape(this.selected, yaw + TURN * direction, pose);
		}
	}

	private flip(): void {
		if (this.held) {
			this.held.pose = (this.held.pose + 1) % junkPoses(this.held.kind).length;
			this.sound.turn();
		} else if (this.selected && this.phase === 'build') {
			const { pose, yaw } = this.poseOf(this.selected.kind, quaternion(this.selected.body.rotation()));
			this.reshape(this.selected, yaw, (pose + 1) % junkPoses(this.selected.kind).length);
		}
	}

	// The pose flipping would put the held or selected piece in next.
	private nextPoseName(): string | null {
		const kind = this.held?.kind ?? this.selected?.kind;
		if (!kind) return null;
		const choices = junkPoses(kind);
		if (choices.length < 2) return null;
		const current = this.held ? this.held.pose : this.poseOf(kind, quaternion((this.selected as Piece).body.rotation())).pose;
		return choices[(current + 1) % choices.length].name;
	}

	private buildGhost(kind: JunkKind): void {
		this.removeGhost();
		const model = buildJunkModel(kind, 0);
		for (const material of model.materials) material.dispose();
		model.group.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			child.material = this.ghostFill;
			child.castShadow = false;
			child.receiveShadow = false;
		});
		inkify(model.group, this.ghostInk);
		this.ghost = model.group;
		this.scene.add(this.ghost);
	}

	private removeGhost(): void {
		this.placementFoot.visible = false;
		if (!this.ghost) return;
		this.ghost.removeFromParent();
		this.ghost.traverse((child) => {
			if (child instanceof THREE.Mesh) child.geometry.dispose();
		});
		this.ghost = null;
	}

	// The piece goes where the pointer is: pushed along the line of sight
	// until it bumps into something, then let down onto whatever is under
	// it. A sheet aimed across a gap comes to rest on both sides, and a panel
	// aimed beside a door stands beside it rather than climbing on top.
	private placementFromRay(ray: THREE.Ray, held: Held): Placement | null {
		const rotation = this.heldRotation(held);
		const sweep = this.world.castShape(
			ray.origin,
			{ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
			ray.direction,
			junkShape(held.kind).compound,
			0,
			200,
			true,
			undefined,
			SOLID_QUERY,
		);
		if (!sweep) {
			if (Math.abs(ray.direction.y) < 0.0001) return null;
			const beyond = ray.at(-ray.origin.y / ray.direction.y, new THREE.Vector3());
			return this.resolvePlacement(held, beyond.x, beyond.z);
		}
		// Backed off a little, so it isn't touching what it bumped into on the way down.
		const stopped = ray.at(Math.max(0, sweep.time_of_impact - 0.02), new THREE.Vector3());
		const snapped = new THREE.Vector3(this.snapped(stopped.x), stopped.y, this.snapped(stopped.z));
		return this.lowerFrom(held.kind, snapped, rotation)
			?? this.lowerFrom(held.kind, stopped, rotation)
			?? this.dropShape(held.kind, stopped.x, stopped.z, rotation);
	}

	// Lines things up on a small grid, unless Alt is held.
	private snapped(value: number): number {
		return this.freePlacement ? value : Math.round(value / 0.125) * 0.125;
	}

	// Lowered from above, onto the top of whatever is there.
	private resolvePlacement(held: Held, x: number, z: number): Placement {
		return this.dropShape(held.kind, this.snapped(x), this.snapped(z), this.heldRotation(held));
	}

	// Let straight down from `from` onto whatever is under it. Nothing if it
	// would start inside something, or there is nothing under it at all.
	private lowerFrom(kind: JunkKind, from: THREE.Vector3, rotation: THREE.Quaternion): Placement | null {
		if (this.overlaps(kind, from, rotation)) return null;
		const hit = this.world.castShape(
			from,
			{ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
			{ x: 0, y: -1, z: 0 },
			junkShape(kind).compound,
			0,
			20,
			true,
			undefined,
			SOLID_QUERY,
		);
		if (!hit) return null;
		const position = new THREE.Vector3(from.x, from.y - hit.time_of_impact + 0.01, from.z);
		return {
			position,
			valid: position.y < 5 && this.island.contains(position.x, position.z, -0.3),
			reason: position.y >= 5 ? 'too high. nothing up there to hold it.' : undefined,
			support: this.pieceByCollider.get(hit.collider.handle)?.kind.name ?? 'ground',
		};
	}

	private overlaps(kind: JunkKind, position: THREE.Vector3, rotation: THREE.Quaternion, exclude?: RAPIER.RigidBody): boolean {
		const shape = junkShape(kind).compound;
		let blocked = false;
		this.world.intersectionsWithShape(position, rotation, shape, (collider) => {
			const contact = collider.contactShape(shape, position, rotation, 0);
			// Resting physics contacts can sink a couple of millimetres into
			// their support. That must not prevent editing the next morning.
			blocked = !contact || contact.distance < -0.003;
			return !blocked;
		}, undefined, SOLID_QUERY, undefined, exclude);
		return blocked;
	}

	private updateGhost(): void {
		const held = this.held;
		const ghost = this.ghost;
		if (!held || !ghost) {
			this.placement = null;
			return;
		}
		const aim = this.aim;
		if (aim?.mode === 'pointer') this.placement = this.placementFromRay(this.rayFrom(aim.x, aim.y), held);
		else if (aim?.mode === 'world') this.placement = this.resolvePlacement(held, aim.x, aim.z);
		const placement = this.placement;
		ghost.visible = placement !== null;
		if (!placement) return;
		ghost.position.copy(placement.position);
		this.placementFoot.visible = true;
		this.placementFoot.position.set(placement.position.x, 0.035, placement.position.z);
		this.heldRotation(held, ghost.quaternion);
		const tone = !placement.valid ? 'bad' : this.heldWobbly ? 'wobbly' : 'good';
		this.renderer.look.ghost.copy(tone === 'bad' ? SKY.ghostLineBad : tone === 'wobbly' ? SKY.ghostLineWobbly : SKY.ghostLine);
		this.ghostFill.color.copy(tone === 'bad' ? SKY.ghostBad : tone === 'wobbly' ? SKY.ghostWobbly : SKY.ghost);
	}

	// ── Nails ──────────────────────────────────────────────────────────

	// Nails whatever the pointer is over, or else the last thing put down.
	private nailSelected(): void {
		const hovered = this.hover && 'piece' in this.hover ? this.hover.piece : null;
		const piece = hovered ?? this.selected;
		if (this.phase !== 'build' || this.held || !piece || (this.day > 1 && this.clock < this.morningUntil)) return;
		const before = this.captureBuild();
		if (piece.nailed) {
			this.detach(piece, true);
			this.remember(before);
			this.toast('unnailed. you get the nails back.');
			this.markChanged();
			return;
		}
		if (this.nails <= 0) { this.toast(words.pick(words.NO_NAILS, this.random)); return; }
		const bonds: Bond[] = [];
		for (const body of [this.island.body, ...this.pieces.filter((other) => other !== piece).map((other) => other.body)]) {
			const point = this.contactBetween(piece.body, body);
			if (!point) continue;
			const inverse = quaternion(piece.body.rotation()).invert();
			const otherInverse = quaternion(body.rotation()).invert();
			bonds.push({ a: piece.id, b: this.pieceByBody.get(body.handle)?.id ?? null,
				anchor1: point.clone().sub(vector(piece.body.translation())).applyQuaternion(inverse).toArray(),
				anchor2: point.clone().sub(vector(body.translation())).applyQuaternion(otherInverse).toArray(),
				frame1: inverse.toArray(), frame2: otherInverse.toArray() });
		}
		if (!bonds.length) { this.toast(words.pick(words.CANT_NAIL, this.random)); this.sound.nope(); return; }
		this.connect(bonds);
		this.nails -= 1;
		this.remember(before);
		this.sound.nail();
		this.toast(words.pick(words.NAILED, this.random));
		this.markChanged();
	}

	private connect(bonds: Bond[]): void {
		const batch: NailBatch = { bonds, handles: [], heads: [] };
		for (const bond of bonds) {
			const piece = this.pieces.find((candidate) => candidate.id === bond.a);
			const other = bond.b === null ? this.island.body : this.pieces.find((candidate) => candidate.id === bond.b)?.body;
			if (!piece || !other) continue;
			const joint = this.world.createImpulseJoint(RAPIER.JointData.fixed(
				new THREE.Vector3(...bond.anchor1), new THREE.Quaternion(...bond.frame1),
				new THREE.Vector3(...bond.anchor2), new THREE.Quaternion(...bond.frame2)), piece.body, other, true);
			batch.handles.push(joint.handle);
			const point = new THREE.Vector3(...bond.anchor1).applyQuaternion(quaternion(piece.body.rotation())).add(vector(piece.body.translation()));
			batch.heads.push(this.addNailHead(piece, point, vector(piece.body.translation()), quaternion(piece.body.rotation()).invert()));
		}
		this.nailBatches.push(batch);
		this.refreshBonds();
	}

	private refreshBonds(): void {
		for (const piece of this.pieces) { piece.nailed = false; piece.partners.clear(); }
		for (const batch of this.nailBatches) for (const bond of batch.bonds) {
			const a = this.pieces.find((piece) => piece.id === bond.a);
			const b = this.pieces.find((piece) => piece.id === bond.b);
			if (a) { a.nailed = true; a.partners.add(b?.body.handle ?? this.island.body.handle); }
			if (b) { b.nailed = true; if (a) b.partners.add(a.body.handle); }
		}
		this.hudSignature = '';
	}

	private detach(piece: Piece, refund: boolean): void {
		const removed = this.nailBatches.filter((batch) => batch.bonds.some((bond) => bond.a === piece.id || bond.b === piece.id));
		for (const batch of removed) {
			for (const handle of batch.handles) {
				const joint = this.world.getImpulseJoint(handle);
				if (joint) this.world.removeImpulseJoint(joint, true);
			}
			for (const head of batch.heads) {
				head.removeFromParent();
				if (head instanceof THREE.Mesh) { head.geometry.dispose(); (head.material as THREE.Material).dispose(); }
			}
		}
		this.nailBatches = this.nailBatches.filter((batch) => !removed.includes(batch));
		if (refund) this.nails = Math.min(MAX_NAILS, this.nails + removed.length);
		this.refreshBonds();
	}

	private captureBuild(): BuildState {
		return {
			pieces: this.pieces.map((piece) => ({ id: piece.id, kind: piece.kind.id, seed: piece.seed,
				position: vector(piece.body.translation()).toArray(), rotation: quaternion(piece.body.rotation()).toArray(), snow: piece.snow })),
			bonds: structuredClone(this.nailBatches.map((batch) => batch.bonds)), nails: this.nails, selected: this.selected?.id ?? null,
		};
	}

	private restoreBuild(state: BuildState): void {
		this.held = null;
		this.removeGhost();
		for (const piece of [...this.pieces]) this.removePiece(piece);
		for (const saved of state.pieces) {
			const piece = this.addPiece(junkKind(saved.kind), new THREE.Vector3(...saved.position), new THREE.Quaternion(...saved.rotation), saved.seed);
			piece.id = saved.id;
			piece.snow = saved.snow;
		}
		for (const bonds of state.bonds) this.connect(bonds);
		this.nails = state.nails;
		this.select(this.pieces.find((piece) => piece.id === state.selected) ?? null);
		// Refresh Rapier's query pipeline before the next preview.
		this.world.step();
		this.previewKey = '';
		this.markChanged();
	}

	private remember(before: BuildState): void {
		this.undoStack.push(before);
		if (this.undoStack.length > 40) this.undoStack.shift();
		this.redoStack = [];
		this.hudSignature = '';
	}

	private undo(): void {
		if (this.phase !== 'build' || (this.day > 1 && this.clock < this.morningUntil)) return;
		if (this.held) { this.cancelHeld(); return; }
		const previous = this.undoStack.pop();
		if (!previous) return;
		this.redoStack.push(this.captureBuild());
		this.restoreBuild(previous);
		this.sound.cancel();
		this.toast('undone.');
	}

	private redo(): void {
		if (this.phase !== 'build' || this.held || (this.day > 1 && this.clock < this.morningUntil)) return;
		const next = this.redoStack.pop();
		if (!next) return;
		this.undoStack.push(this.captureBuild());
		this.restoreBuild(next);
		this.sound.thunk(0.2, 1);
	}

	private addNailHead(piece: Piece, point: THREE.Vector3, position: THREE.Vector3, inverse: THREE.Quaternion): THREE.Object3D {
		// Nudged out from the piece's middle so the head is not buried in the joint.
		const outward = point.clone().sub(position);
		const local = outward.clone().add(outward.clone().normalize().multiplyScalar(0.03)).applyQuaternion(inverse);
		const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 10), createFill('#5d6468'));
		head.position.copy(local);
		head.quaternion.setFromUnitVectors(UP, outward.normalize().applyQuaternion(inverse));
		piece.model.group.add(head);
		inkify(head, piece.ink);
		return head;
	}

	// ── Pointer and keys ───────────────────────────────────────────────

	private rayFrom(clientX: number, clientY: number): THREE.Ray {
		const rect = this.el.canvas.getBoundingClientRect();
		const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
		this.raycaster.setFromCamera(ndc, this.camera);
		return this.raycaster.ray;
	}

	private pickAt(ray: THREE.Ray): Hover {
		const hit = this.world.castRay(new RAPIER.Ray(ray.origin, ray.direction), 200, true, undefined, ANY_QUERY);
		if (!hit) return null;
		const piece = this.pieceByCollider.get(hit.collider.handle);
		if (piece) return { piece };
		const resident = this.residents.find((candidate) => candidate.collider?.handle === hit.collider.handle);
		return resident ? { resident } : null;
	}

	private pickBelow(x: number, z: number): Hover {
		return this.pickAt(new THREE.Ray(new THREE.Vector3(x, 14, z), new THREE.Vector3(0, -1, 0)));
	}

	private setHover(hover: Hover): void {
		const previous = this.hover;
		if (previous && 'resident' in previous) previous.resident.setHighlighted(false);
		this.hover = hover;
		if (hover && 'resident' in hover) hover.resident.setHighlighted(true);
	}

	private refreshHover(): void {
		if (this.held || this.pointer.dragging || !['build', 'dusk', 'storm', 'dawn', 'title'].includes(this.phase)) {
			if (this.hover) this.setHover(null);
			return;
		}
		let found: Hover = null;
		if (this.keyboardCursor) found = this.pickBelow(this.keyboardCursor.x, this.keyboardCursor.z);
		else if (this.aim?.mode === 'pointer' && this.pointer.type !== 'touch') found = this.pickAt(this.rayFrom(this.aim.x, this.aim.y));
		if (found && 'piece' in found && this.phase !== 'build') found = null;
		const same = found && this.hover
			&& (('piece' in found && 'piece' in this.hover && found.piece === this.hover.piece)
				|| ('resident' in found && 'resident' in this.hover && found.resident === this.hover.resident));
		if (!same && (found || this.hover)) this.setHover(found);
	}

	// Selected and hovered junk draws in pink, wobbly junk in the warning colour.
	private updateInk(): void {
		const hovered = this.hover && 'piece' in this.hover ? this.hover.piece : null;
		const building = this.phase === 'build';
		for (const piece of this.pieces) {
			const id = building && piece.wobbly
				? WOBBLY_ID
				: piece === this.selected || piece === hovered ? HIGHLIGHT_ID : piece.inkId;
			setInkId(piece.ink, id);
		}
	}

	private onPointerDown(event: PointerEvent): void {
		this.el.stage.focus({ preventScroll: true });
		this.sound.wake();
		this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
		// Capture keeps a drag going off the edge of the stage. It can refuse a
		// pointer the browser no longer considers active, which is harmless.
		try {
			this.el.stage.setPointerCapture(event.pointerId);
		} catch {
			// Carry on without capture.
		}
		if (this.touches.size === 2) {
			// Two fingers look around. Whatever is in hand stays in hand.
			const [a, b] = [...this.touches.values()];
			this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
			this.pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
			this.pointer.dragging = true;
			this.pickedOnPress = false;
			return;
		}
		Object.assign(this.pointer, {
			id: event.pointerId,
			button: event.button,
			down: true,
			dragging: false,
			startX: event.clientX,
			startY: event.clientY,
			x: event.clientX,
			y: event.clientY,
			type: event.pointerType,
		});
		this.keyboardCursor = null;
		this.pickedOnPress = false;
		this.pressedOnGhost = false;
		if (event.button === 2 && this.held) {
			this.cancelHeld();
			return;
		}
		if (event.button !== 0 || this.phase !== 'build') return;
		if (this.held) {
			this.pressedOnGhost = !!this.placement && this.screenDistance(this.placement.position, event.clientX, event.clientY) < 48;
			if (event.pointerType !== 'touch') this.aim = { mode: 'pointer', x: event.clientX, y: event.clientY };
			return;
		}
		this.aim = { mode: 'pointer', x: event.clientX, y: event.clientY };
		const hit = this.pickAt(this.rayFrom(event.clientX, event.clientY));
		if (hit && 'piece' in hit) {
			const at = hit.piece.body.translation();
			this.pickedOnPress = this.pickUp(hit.piece, 'pointer');
			// On touch the piece waits where it was until the finger moves it.
			if (this.pickedOnPress && event.pointerType === 'touch') this.aim = { mode: 'world', x: at.x, z: at.z };
		}
	}

	private onPointerMove(event: PointerEvent): void {
		if (this.touches.has(event.pointerId)) this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (this.touches.size === 2) {
			const [a, b] = [...this.touches.values()];
			const distance = Math.hypot(a.x - b.x, a.y - b.y);
			const angle = Math.atan2(b.y - a.y, b.x - a.x);
			if (this.pinchDistance > 0) this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * (distance / this.pinchDistance), 0.7, 1.8);
			let turn = angle - this.pinchAngle;
			turn = Math.atan2(Math.sin(turn), Math.cos(turn));
			this.yawGoal -= turn;
			this.yaw = this.yawGoal;
			this.pinchDistance = distance;
			this.pinchAngle = angle;
			return;
		}
		this.freePlacement = event.altKey;
		const touch = event.pointerType === 'touch';
		const pressing = this.pointer.down && event.pointerId === this.pointer.id;
		const far = pressing && Math.hypot(event.clientX - this.pointer.startX, event.clientY - this.pointer.startY) > DRAG_THRESHOLD;
		// A mouse carries the piece wherever it goes. A finger carries it only
		// while dragging it, so touching somewhere else does not move it.
		const fingerOnPiece = touch && pressing && (this.pickedOnPress || this.pressedOnGhost);
		if (!touch || fingerOnPiece) {
			this.keyboardCursor = null;
			this.pointer.type = event.pointerType;
			if (!this.held || !touch || far) this.aim = { mode: 'pointer', x: event.clientX, y: event.clientY };
		}
		if (!pressing) return;
		const dx = event.clientX - this.pointer.x;
		this.pointer.x = event.clientX;
		this.pointer.y = event.clientY;
		// With something in hand, the main button or a finger on it moves it.
		// Anything else, dragged far enough, turns the view.
		if (this.held && ((!touch && this.pointer.button === 0) || fingerOnPiece)) return;
		if (!this.pointer.dragging && far) this.pointer.dragging = true;
		if (this.pointer.dragging) {
			this.yawGoal -= dx * 0.0075;
			this.yaw = this.yawGoal;
		}
	}

	private onPointerUp(event: PointerEvent, cancelled = false): void {
		this.touches.delete(event.pointerId);
		if (this.el.stage.hasPointerCapture(event.pointerId)) this.el.stage.releasePointerCapture(event.pointerId);
		if (event.pointerId !== this.pointer.id) {
			if (this.touches.size === 0) this.pointer.dragging = false;
			return;
		}
		const moved = Math.hypot(event.clientX - this.pointer.startX, event.clientY - this.pointer.startY) > DRAG_THRESHOLD;
		const turnedView = this.pointer.dragging;
		const primary = this.pointer.button === 0;
		const picked = this.pickedOnPress;
		const onGhost = this.pressedOnGhost;
		this.pointer.down = false;
		this.pointer.dragging = false;
		this.pickedOnPress = false;
		this.pressedOnGhost = false;
		if (cancelled || !primary || turnedView) return;

		if (this.held) {
			// Picked up by this same press and not moved: it stays in hand.
			if (picked && !moved) return;
			const touch = event.pointerType === 'touch';
			// On touch, a tap anywhere but the piece moves it there instead.
			if (touch && !moved && !onGhost) {
				const target = this.placementFromRay(this.rayFrom(event.clientX, event.clientY).clone(), this.held);
				if (target) this.aim = { mode: 'world', x: target.position.x, z: target.position.z };
				return;
			}
			if (!touch || moved) this.aim = { mode: 'pointer', x: event.clientX, y: event.clientY };
			this.updateGhost();
			// Dragged somewhere it cannot go, it goes back. Clicked there, it stays in hand.
			if (!this.placeHeld() && moved) this.cancelHeld();
			return;
		}
		if (!moved) this.act(this.pickAt(this.rayFrom(event.clientX, event.clientY)));
	}

	private act(hit: Hover): void {
		if (hit && 'resident' in hit) {
			this.poke(hit.resident);
			return;
		}
		if (this.phase === 'build' && !hit) this.select(null);
	}

	private screenDistance(at: THREE.Vector3, clientX: number, clientY: number): number {
		const projected = at.clone().project(this.camera);
		const rect = this.el.canvas.getBoundingClientRect();
		const x = rect.left + ((projected.x + 1) / 2) * rect.width;
		const y = rect.top + ((1 - projected.y) / 2) * rect.height;
		return Math.hypot(x - clientX, y - clientY);
	}

	private poke(resident: Resident): void {
		if (!resident.present) return;
		const line = this.phase === 'storm' && resident.wet > 0.4
			? 'i\'m wet.'
			: this.phase === 'storm'
				? 'not now.'
				: words.pick(words.CHATTER, this.random);
		this.say(resident, line);
		resident.lookAtCamera = true;
	}

	// Scrolling turns whatever is in hand, and zooms otherwise. A trackpad
	// sends many small steps, so they add up to one turn at a time.
	private onWheel(event: WheelEvent): void {
		event.preventDefault();
		if (this.held) {
			this.wheelTurn += event.deltaY;
			if (Math.abs(this.wheelTurn) >= 40) {
				this.turn(Math.sign(this.wheelTurn));
				this.wheelTurn = 0;
			}
			return;
		}
		this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * Math.exp(-event.deltaY * 0.0012), 0.7, 1.8);
	}

	private moveCursor(right: number, forward: number): void {
		if (this.phase !== 'build') return;
		if (this.selected && !this.held && this.pickUp(this.selected, 'keys')) this.keyboardCursor = this.held!.returnTo.position.clone();
		if (!this.keyboardCursor) {
			const start = this.placement?.position ?? (this.selected ? vector(this.selected.body.translation()) : new THREE.Vector3());
			this.keyboardCursor = new THREE.Vector3(start.x, 0, start.z);
		}
		const step = 0.125;
		const along = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
		const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		this.keyboardCursor.addScaledVector(side, right * step).addScaledVector(along, forward * step);
		const distance = Math.hypot(this.keyboardCursor.x, this.keyboardCursor.z);
		if (distance > ISLAND_RADIUS) this.keyboardCursor.multiplyScalar(ISLAND_RADIUS / distance);
		this.aim = { mode: 'world', x: this.keyboardCursor.x, z: this.keyboardCursor.z };
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.isComposing || this.el.help.open) return;
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) this.redo(); else this.undo();
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.isContentEditable || target?.matches('input, textarea, select')) return;
		const onButton = target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
		const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
		const handled = (() => {
			switch (key) {
				case '?':
					this.el.help.showModal();
					return true;
				case 'r':
					this.turn(event.shiftKey ? -1 : 1);
					return true;
				case 'f':
					this.flip();
					return true;
				case 'n':
					this.nailSelected();
					return true;
				case 'q':
					this.yawGoal += Math.PI / 4;
					return true;
				case 'e':
					this.yawGoal -= Math.PI / 4;
					return true;
				case '=':
				case '+':
					this.zoomGoal = Math.min(1.8, this.zoomGoal * 1.15);
					return true;
				case '-':
					this.zoomGoal = Math.max(0.7, this.zoomGoal / 1.15);
					return true;
				case 'Escape':
					if (this.held) this.cancelHeld();
					else if (this.selected) this.select(null);
					else return false;
					return true;
				case 'ArrowLeft':
					this.moveCursor(-1, 0);
					return true;
				case 'ArrowRight':
					this.moveCursor(1, 0);
					return true;
				case 'ArrowUp':
					this.moveCursor(0, 1);
					return true;
				case 'ArrowDown':
					this.moveCursor(0, -1);
					return true;
				case ' ':
				case 'Enter': {
					if (onButton) return false;
					if (this.held) {
						this.placeHeld();
						return true;
					}
					if (this.selected) {
						const piece = this.selected;
						this.keyboardCursor = vector(piece.body.translation());
						this.aim = { mode: 'world', x: this.keyboardCursor.x, z: this.keyboardCursor.z };
						this.pickUp(piece, 'keys');
						return true;
					}
					if (!this.keyboardCursor) {
						this.moveCursor(0, 0);
						return true;
					}
					const hit = this.pickBelow(this.keyboardCursor.x, this.keyboardCursor.z);
					if (hit && 'piece' in hit) this.pickUp(hit.piece, 'keys');
					else this.act(hit);
					return true;
				}
				default:
					return false;
			}
		})();
		if (handled) event.preventDefault();
	}

	// ── Simulation ─────────────────────────────────────────────────────

	private step(): void {
		const storming = this.phase === 'storm' && this.night;
		const residentPush = this.push.clone().multiplyScalar(RESIDENT_PUSH);
		for (const resident of this.residents) resident.steer(STEP, { push: residentPush }, (x, z) => this.island.contains(x, z, -0.1));
		for (const resident of this.departed) resident.steer(STEP, { push: residentPush }, (x, z) => this.island.contains(x, z, -0.1));
		if (storming) this.applyWeather();
		for (const piece of this.pieces) {
			vector(piece.body.translation(), piece.from.position);
			quaternion(piece.body.rotation(), piece.from.quaternion);
		}
		this.world.step();
		this.listenForImpacts();
	}

	private applyWeather(): void {
		const speed = this.push.length();
		const direction = speed > 0 ? this.push.clone().divideScalar(speed) : new THREE.Vector3();
		const pressure = speed * speed;
		const snowing = (this.night?.snow ?? 0) > 0.01;
		const axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
		for (const piece of this.pieces) {
			const body = piece.body;
			// Forces and torques both persist between steps until cleared, and a
			// force applied off-centre adds torque, so both are reset every step.
			body.resetForces(false);
			body.resetTorques(false);
			const rotation = quaternion(body.rotation());
			axes[0].set(1, 0, 0).applyQuaternion(rotation);
			axes[1].set(0, 1, 0).applyQuaternion(rotation);
			axes[2].set(0, 0, 1).applyQuaternion(rotation);
			const half = junkShape(piece.kind).half;
			const solid = 1 - (piece.kind.porosity ?? 0);
			const face = (normal: THREE.Vector3) => 4 * (
				half.y * half.z * Math.abs(axes[0].dot(normal))
				+ half.x * half.z * Math.abs(axes[1].dot(normal))
				+ half.x * half.y * Math.abs(axes[2].dot(normal))
			) * solid;
			const top = face(UP);
			const tall = Math.abs(axes[0].y) * half.x + Math.abs(axes[1].y) * half.y + Math.abs(axes[2].y) * half.z;
			const at = body.translation();
			if (speed > 0.05) {
				piece.shelterCheck -= 1;
				if (piece.shelterCheck <= 0) {
					piece.shelterCheck = 10 + (piece.id % 7);
					const upwind = { x: -direction.x, y: 0, z: -direction.z };
					const hit = this.world.castRay(new RAPIER.Ray(at, upwind), 3.5, true, undefined, SOLID_QUERY, undefined, body);
					piece.shelter = hit ? 0.3 : 1;
					const below = this.world.castRay(new RAPIER.Ray(at, { x: 0, y: -1, z: 0 }), tall + 0.12, true, undefined, SOLID_QUERY, undefined, body);
					piece.lift = below ? 0.2 : 1;
				}
				const push = pressure * piece.shelter;
				const force = direction.clone().multiplyScalar(DRAG * push * face(direction)).addScaledVector(UP, LIFT * push * top * piece.lift);
				body.addForceAtPoint(force, { x: at.x, y: at.y + tall * 0.35, z: at.z }, true);
			}
			if (snowing && piece.snow > 0.02) body.addForce({ x: 0, y: -piece.snow * top * 3, z: 0 }, true);
		}
	}

	// A piece that was moving and suddenly is not has hit something.
	private listenForImpacts(): void {
		for (const piece of this.pieces) {
			if (piece.body.isSleeping()) {
				piece.lastSpeed = 0;
				continue;
			}
			const velocity = piece.body.linvel();
			const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
			const drop = piece.lastSpeed - speed;
			piece.lastSpeed = speed;
			if (drop < 1.1 || this.clock - piece.lastSound < 0.12) continue;
			piece.lastSound = this.clock;
			const mass = piece.body.mass();
			const weight = Math.min(1, drop * Math.sqrt(mass) * 0.35);
			const pitch = THREE.MathUtils.clamp(0.32 / Math.sqrt(mass), 0.55, 1.6);
			this.sound.thunk(weight, pitch, METAL.has(piece.kind.id));
			if (drop > 3) this.bonkNear(vector(piece.body.translation()), 0.7);
		}
	}

	private bonkNear(at: THREE.Vector3, radius: number): void {
		for (const resident of this.presentResidents()) {
			const dx = resident.position.x - at.x;
			const dz = resident.position.z - at.z;
			if (dx * dx + dz * dz > radius * radius || at.y < resident.position.y + 0.4) continue;
			if ((this.bubbles.get(resident)?.until ?? 0) > this.clock) continue;
			this.say(resident, words.pick(words.BONKED, this.random), 1.6);
		}
	}

	private strike(): void {
		// Lightning goes for the tallest thing with nothing over it.
		let tallest: Piece | null = null;
		let height = 0.8;
		for (const piece of this.pieces) {
			const at = piece.body.translation();
			if (at.y <= height || !this.island.contains(at.x, at.z, 0)) continue;
			const cover = this.world.castRay(new RAPIER.Ray(at, { x: 0, y: 1, z: 0 }), 10, true, undefined, SOLID_QUERY, undefined, piece.body);
			if (cover) continue;
			tallest = piece;
			height = at.y;
		}
		this.flash = 1;
		if (!tallest || this.random() < 0.35) {
			this.sound.thunder(0.5 + this.random());
			return;
		}
		const at = vector(tallest.body.translation());
		this.precipitation.strike(at);
		const mass = tallest.body.mass();
		tallest.body.applyImpulse({ x: this.push.x * mass * 0.9, y: mass * 3.5, z: this.push.z * mass * 0.9 }, true);
		tallest.body.applyTorqueImpulse({ x: (this.random() - 0.5) * mass, y: 0, z: (this.random() - 0.5) * mass }, true);
		this.sound.crack();
	}

	private updateWeather(delta: number): void {
		const night = this.night;
		if (night && this.phase === 'storm') {
			night.elapsed += delta;
			night.push(this.clock, this.push);
			fromVector(night.windFrom, this.windFrom);
			this.rainDirection.set(this.push.x * 0.28, -1, this.push.z * 0.28).normalize();
			this.el.stormFill.style.setProperty('--progress', night.progress.toFixed(3));
			if (night.forecast.lightning && night.envelope > 0.5) {
				this.lightningIn -= delta;
				if (this.lightningIn <= 0) {
					this.lightningIn = 4 + this.random() * 6;
					this.strike();
				}
			}
			this.exposureIn -= delta;
			if (this.exposureIn <= 0) {
				this.exposureIn = 0.2;
				this.weatherResidents(0.2, night.rain + night.snow * 0.75);
			}
			this.snowIn -= delta;
			if (this.snowIn <= 0 && night.snow > 0.01) {
				this.snowIn = 0.5;
				this.gatherSnow(0.5, night.snow);
			}
		} else {
			this.push.multiplyScalar(Math.exp(-delta * 2));
			if (this.phase === 'dusk') this.calmResidents();
		}
		const rain = night && this.phase === 'storm' ? night.rain : 0;
		const snow = night && this.phase === 'storm' ? night.snow : 0;
		this.precipitation.update(delta, this.clock, rain, snow, this.push);
		this.sound.setWeather(rain, this.push.length(), snow);

		if (this.phase !== 'storm') {
			const melt = delta * (this.phase === 'build' ? 0.012 : 0.004);
			this.islandSnow = Math.max(0, this.islandSnow - melt);
			for (const piece of this.pieces) piece.snow = Math.max(0, piece.snow - melt);
			for (const resident of this.residents) {
				if (this.phase === 'build' || this.phase === 'report') resident.wet = Math.max(0, resident.wet - delta * 0.04);
			}
		}
		for (const material of this.island.snowMaterials) {
			const uniforms = fillUniforms(material);
			if (uniforms) uniforms.uSnow.value = this.islandSnow;
		}
		for (const piece of this.pieces) {
			for (const material of piece.model.materials) {
				const uniforms = fillUniforms(material);
				if (uniforms) uniforms.uSnow.value = piece.snow;
			}
		}

		this.flash = Math.max(0, this.flash - delta * 3.5);
		const flicker = this.flash > 0.4 && this.flash < 0.6 ? 0.3 : 1;
		this.renderer.look.flash = this.flash * flicker * (this.reducedMotion.matches ? 0.3 : 1);
	}

	// Nothing reaches anyone before the weather starts.
	private calmResidents(): void {
		for (const resident of this.presentResidents()) resident.exposure = { sky: 0, wind: 0 };
	}

	private weatherResidents(seconds: number, wetness: number): void {
		for (const resident of this.presentResidents()) {
			if (resident.state !== 'sheltering' && resident.state !== 'seeking') continue;
			const cover = coverAt(this.world, resident.position, this.rainDirection, this.windFrom);
			resident.exposure = { sky: 1 - cover.roof, wind: 1 - cover.wall };
			const amount = resident.exposure.sky * wetness * WET_RATE * seconds;
			resident.wet = Math.min(1.2, resident.wet + amount);
			const evidence = this.nightEvidence.get(resident);
			if (evidence) {
				if (resident.state === 'seeking') evidence.travelling += amount;
				else if (cover.roof === 0) evidence.uncovered += amount;
				else evidence.leaking += amount;
			}
		}
	}

	private gatherSnow(seconds: number, amount: number): void {
		this.islandSnow = Math.min(1, this.islandSnow + seconds * amount * 0.05);
		for (const piece of this.pieces) {
			const at = piece.body.translation();
			const open = !this.world.castRay(new RAPIER.Ray(at, { x: 0, y: 1, z: 0 }), 10, true, undefined, SOLID_QUERY, undefined, piece.body);
			if (open) piece.snow = Math.min(1, piece.snow + seconds * amount * 0.06);
		}
	}

	private checkLostJunk(): void {
		for (const piece of [...this.pieces]) {
			const at = piece.body.translation();
			if (at.y > -14) continue;
			this.removePiece(piece);
			if (this.phase !== 'title') this.toast(words.fill(words.pick(words.LOST_JUNK, this.random), piece.kind.name));
		}
	}

	private tidyResidents(delta: number): void {
		const arriving = this.residents.filter((resident) => resident.state === 'arriving').length;
		if (arriving !== this.arrivingCount) {
			this.arrivingCount = arriving;
			if (this.phase === 'build') this.markChanged();
		}
		for (const resident of [...this.departed]) {
			if (resident.state !== 'gone') continue;
			this.disposeResident(resident);
			this.departed = this.departed.filter((candidate) => candidate !== resident);
			this.tenantsSignature = '';
		}
		for (const resident of this.residents) {
			if (resident.state === 'idle' && (this.phase === 'build' || this.phase === 'title')) {
				resident.potter(delta, () => this.nearbySpot(resident));
			}
		}
	}

	private chatter(delta: number): void {
		if (this.phase !== 'build' && this.phase !== 'title') return;
		this.chatterIn -= delta;
		if (this.chatterIn > 0) return;
		this.chatterIn = 9 + this.random() * 12;
		const idle = this.presentResidents().filter((resident) => resident.state === 'idle');
		if (idle.length === 0) return;
		this.say(words.pick(idle, this.random), words.pick(words.CHATTER, this.random));
	}

	// ── Drawing ────────────────────────────────────────────────────────

	private updateCamera(delta: number): void {
		const ease = this.reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 8);
		this.yaw += (this.yawGoal - this.yaw) * ease;
		this.zoom += (this.zoomGoal - this.zoom) * ease;
		const target = new THREE.Vector3(0, TARGET_Y, 0);
		this.camera.position.set(
			Math.sin(this.yaw) * Math.cos(PITCH) * CAMERA_DISTANCE,
			TARGET_Y + Math.sin(PITCH) * CAMERA_DISTANCE,
			Math.cos(this.yaw) * Math.cos(PITCH) * CAMERA_DISTANCE,
		);
		this.camera.lookAt(target);
		const aspect = this.width / this.height;
		// Wide screens fit the island's height; tall ones fit its width.
		const half = Math.max(5.9, 6.1 / aspect) / this.zoom;
		this.camera.left = -half * aspect;
		this.camera.right = half * aspect;
		this.camera.top = half;
		this.camera.bottom = -half;
		this.camera.updateProjectionMatrix();
		this.camera.updateMatrixWorld();
	}

	private updateLook(delta: number): void {
		const goal = this.phase === 'dusk'
			? Math.min(1, this.phaseTime / DUSK_SECONDS)
			: this.phase === 'storm'
				? 1
				: this.phase === 'dawn'
					? Math.max(0, 1 - this.phaseTime / DAWN_SECONDS)
					: 0;
		this.darkness += (goal - this.darkness) * (1 - Math.exp(-delta * 4));
		const dark = this.darkness;
		const glow = 4 * dark * (1 - dark);
		const look = this.renderer.look;
		look.skyTop.copy(SKY.dayTop).lerp(SKY.nightTop, dark);
		look.skyBottom.copy(SKY.dayBottom).lerp(SKY.nightBottom, dark).lerp(SKY.glow, glow * 0.65);
		look.ink.copy(SKY.ink).lerp(SKY.chalk, THREE.MathUtils.smoothstep(dark, 0.4, 0.8));
		this.precipitation.setInk(look.ink);
		this.sun.intensity = THREE.MathUtils.lerp(1.25, 0.3, dark);
		this.sun.color.copy(SKY.sunDay).lerp(SKY.sunNight, dark);
		this.hemi.intensity = THREE.MathUtils.lerp(1.9, 1.25, dark);
		this.hemi.color.copy(SKY.skyDay).lerp(SKY.skyNight, dark);
		this.island.clouds.setGloom(dark);
	}

	private syncPieces(alpha: number): void {
		const position = new THREE.Vector3();
		const rotation = new THREE.Quaternion();
		for (const piece of this.pieces) {
			vector(piece.body.translation(), position);
			quaternion(piece.body.rotation(), rotation);
			piece.model.group.position.lerpVectors(piece.from.position, position, alpha);
			piece.model.group.quaternion.slerpQuaternions(piece.from.quaternion, rotation, alpha);
		}
	}

	private project(at: THREE.Vector3): { x: number; y: number } {
		const projected = at.clone().project(this.camera);
		return { x: ((projected.x + 1) / 2) * this.width, y: ((1 - projected.y) / 2) * this.height };
	}

	private updateBubbles(): void {
		for (const [resident, bubble] of this.bubbles) {
			if (bubble.until < this.clock || resident.state === 'gone') {
				bubble.element.classList.remove('is-showing');
				continue;
			}
			const { x, y } = this.project(resident.position.clone().add(new THREE.Vector3(0, 1.05, 0)));
			bubble.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-12%, -100%)`;
		}
		const hovered = this.hover && 'resident' in this.hover ? this.hover.resident : null;
		const speaking = hovered && (this.bubbles.get(hovered)?.until ?? 0) > this.clock;
		if (hovered && !speaking) {
			const { x, y } = this.project(hovered.position.clone().add(new THREE.Vector3(0, 1.0, 0)));
			this.nameTag.textContent = hovered.name;
			this.nameTag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
			this.nameTag.classList.add('is-showing');
		} else {
			this.nameTag.classList.remove('is-showing');
		}
	}

	private statusOf(resident: Resident): string {
		if (this.phase === 'build' && resident.present && resident.state !== 'arriving') {
			const plan = this.shelterPlans[this.presentResidents().indexOf(resident)];
			return plan?.spot.safe ? 'has a dry spot' : plan ? 'has a damp spot' : 'has nowhere to go';
		}
		switch (resident.state) {
			case 'arriving':
				return 'on the way';
			case 'seeking':
				return 'finding a spot';
			case 'sheltering':
				return resident.wet < 0.22 ? 'dry' : resident.wet < 0.6 ? 'damp' : 'soaked';
			case 'leaving':
				return 'leaving';
			case 'drifting':
			case 'gone':
				return resident.result === 'blown' ? 'blew away' : 'gone';
			default:
				return resident.wet > 0.6 ? 'drying off' : resident.result === 'dry' ? 'pleased, quietly' : 'around';
		}
	}

	private renderTenants(): void {
		const everyone = [...this.residents, ...this.departed.filter((resident) => resident.state !== 'gone')];
		const signature = everyone
			.map((resident) => `${resident.name}:${this.statusOf(resident)}:${resident.patience}:${Math.round(resident.wet * 10)}:${resident.present}`)
			.join('|');
		if (signature === this.tenantsSignature) return;
		this.tenantsSignature = signature;
		const showWet = this.phase === 'storm' || this.phase === 'dusk' || this.phase === 'dawn';
		this.el.tenants.replaceChildren(...everyone.map((resident) => {
			const item = document.createElement('li');
			item.dataset.gone = String(!resident.present);
			const swatch = document.createElement('span');
			swatch.className = 'shack-tenant__swatch';
			swatch.style.setProperty('--swatch', resident.color);
			const name = document.createElement('span');
			name.className = 'shack-tenant__name';
			name.textContent = resident.name;
			const patience = document.createElement('span');
			patience.className = 'shack-tenant__patience';
			patience.textContent = resident.present ? '●'.repeat(Math.max(0, resident.patience)) + '○'.repeat(Math.max(0, 2 - resident.patience)) : '';
			patience.setAttribute('aria-label', `patience ${resident.patience} of 2`);
			const status = document.createElement('span');
			status.className = 'shack-tenant__status';
			status.textContent = this.statusOf(resident);
			item.append(swatch, name, patience, status);
			if (showWet && resident.present) {
				const wet = document.createElement('span');
				wet.className = 'shack-tenant__wet';
				wet.style.setProperty('--wet', `${Math.min(100, Math.round(resident.wet * 100))}%`);
				wet.setAttribute('aria-hidden', 'true');
				item.append(wet);
			}
			return item;
		}));
	}

	private hintText(): string {
		if (this.phase === 'dusk') return 'everyone\'s finding a spot.';
		if (this.phase === 'storm') return 'nothing to do now but watch.';
		if (this.phase !== 'build') return '';
		const touch = this.pointer.type === 'touch';
		if (this.clock < this.morningUntil && !this.held) return this.day === 1 ? 'people are arriving. start without them.' : 'junk incoming.';
		if (this.held) {
			if (this.held.via === 'keys') return 'arrows move it · space sets it down · R turns · F flips · esc puts it back';
			return touch
				? 'drag it where it goes, or tap there · then tap it to set it down'
				: 'click to set it down · scroll or R turns it · F flips it · right-click puts it back';
		}
		const hover = this.hover && 'piece' in this.hover ? this.hover.piece : null;
		if (hover && !touch) return hover.nailed ? `${hover.kind.name}. nailed down · N unnails it` : `${hover.kind.name} · click to pick it up · N nails it`;
		return touch
			? 'tap junk to pick it up · drag the sky to look around'
			: 'click junk to pick it up · drag the sky to look around';
	}

	private updateHud(): void {
		this.renderTenants();
		const hoverPiece = this.hover && 'piece' in this.hover;
		const cursor = this.pointer.dragging || this.held ? 'grabbing' : hoverPiece ? 'grab' : this.hover ? 'pointer' : 'default';
		const hint = this.hintText();
		const morning = this.clock < this.morningUntil;
		const delivery = morning && this.day > 1;
		const flipTo = this.nextPoseName();
		const kind = this.held?.kind ?? this.selected?.kind;
		const locked = !!this.selected?.nailed;
		const placement = this.placement;
		const detail = this.held
			? !placement?.valid ? placement?.reason ?? 'it can\'t go there.'
				: this.heldWobbly ? 'it won\'t stay up there.'
					: `on the ${placement.support ?? 'ground'}.`
			: locked ? 'nailed down. unnail it to move it.'
				: this.selected?.wobbly ? 'it won\'t stay up like that. prop it up or nail it.'
					: kind?.blurb ?? '';
		const armed = this.clock < this.nightArmedUntil;
		const signature = [cursor, hint, detail, this.nails, kind?.id, flipTo, morning, locked, !!this.held, this.undoStack.length, this.redoStack.length, armed].join('|');
		if (signature !== this.hudSignature) {
			this.hudSignature = signature;
			this.root.dataset.cursor = cursor;
			this.el.hint.textContent = hint;
			this.el.editor.hidden = !kind;
			this.el.objectName.textContent = kind?.name ?? '';
			this.el.objectDetail.textContent = detail;
			this.el.editor.dataset.warning = String((!!this.held && (!placement?.valid || this.heldWobbly)) || !!this.selected?.wobbly);
			this.el.nails.textContent = String(this.nails);
			this.el.nailLabel.textContent = locked ? 'unnail' : 'nail';
			this.el.nail.setAttribute('aria-label', locked ? 'Unnail it and get the nails back' : `Nail it to what it's touching (${this.nails} left)`);
			this.el.rotate.disabled = !kind || locked || delivery;
			this.el.flip.disabled = !flipTo || locked || delivery;
			this.el.flipLabel.textContent = flipTo === 'flat' ? 'lay flat' : flipTo === 'upright' ? 'stand up' : 'on its side';
			this.el.flip.setAttribute('aria-label', flipTo ? `Flip: ${poseVerb(flipTo)}` : 'Flip');
			this.el.nail.hidden = !!this.held;
			this.el.nail.disabled = !this.selected || (!locked && this.nails <= 0) || delivery;
			this.el.place.hidden = !this.held;
			this.el.place.disabled = !placement?.valid;
			this.el.close.setAttribute('aria-label', this.held ? 'Put it back' : 'Let go of it');
			this.el.undo.disabled = (!this.held && !this.undoStack.length) || delivery;
			this.el.redo.disabled = !!this.held || !this.redoStack.length || delivery;
			this.el.night.disabled = morning;
			this.el.night.textContent = morning ? (this.day === 1 ? 'someone\'s coming…' : 'junk incoming…') : armed ? 'go anyway' : 'bring on the night';
		}
		if (this.forecast) {
			const toward = fromVector(this.forecast.windFrom).negate();
			const screenX = toward.x * Math.cos(this.yaw) - toward.z * Math.sin(this.yaw);
			const screenUp = -toward.x * Math.sin(this.yaw) - toward.z * Math.cos(this.yaw);
			this.el.compass.style.transform = `rotate(${Math.atan2(screenX, screenUp).toFixed(3)}rad)`;
		}
	}

	// ── Looking ahead ──────────────────────────────────────────────────

	// Something moved: look again shortly, once things stop changing.
	private markChanged(): void {
		this.lookAheadAt = this.clock + 0.15;
	}

	// Runs a copy of the island forward a second or so with everything let
	// go, to find what would fall, then finds the safe spots in what is left.
	// `extra` is the piece being carried, tried out where it would land.
	// Nothing here touches the real world.
	private simulate(extra: { kind: JunkKind; position: THREE.Vector3; rotation: THREE.Quaternion } | null): {
		wobbly: Map<Piece, boolean>;
		extraWobbly: boolean;
		spots: Spot[];
		coverage: Spot[];
		plans: (ShelterPlan | null)[];
	} {
		const copy = RAPIER.World.restoreSnapshot(this.world.takeSnapshot());
		copy.timestep = STEP;
		for (const resident of [...this.residents, ...this.departed]) {
			if (resident.body) copy.removeRigidBody(copy.getRigidBody(resident.body.handle));
		}
		for (const piece of this.pieces) copy.getRigidBody(piece.body.handle).setBodyType(RAPIER.RigidBodyType.Dynamic, true);
		let trial: RAPIER.RigidBody | null = null;
		if (extra) {
			const { position, rotation } = extra;
			trial = copy.createRigidBody(
				RAPIER.RigidBodyDesc.dynamic()
					.setTranslation(position.x, position.y, position.z)
					.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }),
			);
			for (const description of junkColliders(extra.kind)) copy.createCollider(description.setCollisionGroups(JUNK_GROUPS), trial);
		}
		for (let step = 0; step < SETTLE_STEPS; step += 1) copy.step();
		const fell = (body: RAPIER.RigidBody, position: THREE.Vector3, rotation: THREE.Quaternion): boolean =>
			vector(body.translation()).distanceTo(position) > 0.15 || quaternion(body.rotation()).angleTo(rotation) > 0.3;
		const wobbly = new Map<Piece, boolean>();
		for (const piece of this.pieces) {
			const settled = copy.getRigidBody(piece.body.handle);
			wobbly.set(piece, fell(settled, vector(piece.body.translation()), quaternion(piece.body.rotation())));
		}
		const extraWobbly = trial !== null && extra !== null && fell(trial, extra.position, extra.rotation);
		this.aimWeather();
		const coverage = this.spotsIn(copy);
		const plans = planShelter(coverage, this.presentResidents().map((resident) => resident.position), SPOT_SPACING);
		const spots = plans.flatMap((plan) => plan?.spot.safe ? [plan.spot] : []);
		copy.free();
		return { wobbly, extraWobbly, spots, coverage, plans };
	}

	private lookAhead(): void {
		this.lookAheadAt = 0;
		const result = this.simulate(null);
		for (const [piece, wobbly] of result.wobbly) piece.wobbly = wobbly;
		this.safeSpots = result.spots;
		this.coverage = result.coverage;
		this.shelterPlans = result.plans;
		this.showSafeSpots();
	}

	// While something is carried, tries it where it would land, a few times
	// a second, so its colour and the safe spots say what dropping it there
	// would do before you let go.
	private previewHeld(): void {
		const held = this.held;
		const placement = this.placement;
		if (!held || !placement) return;
		const key = placement.valid
			? `${placement.position.x.toFixed(2)}:${placement.position.y.toFixed(2)}:${placement.position.z.toFixed(2)}:${held.yaw.toFixed(3)}:${held.pose}`
			: 'nowhere';
		// Wait for it to stay put a moment, so moving across the island does
		// not set the colours and counts flickering.
		if (key !== this.pendingKey) {
			this.pendingKey = key;
			this.previewAt = this.clock + 0.1;
			return;
		}
		if (key === this.previewKey || this.clock < this.previewAt) return;
		this.previewKey = key;
		const result = this.simulate(placement.valid ? { kind: held.kind, position: placement.position, rotation: this.heldRotation(held) } : null);
		for (const [piece, wobbly] of result.wobbly) piece.wobbly = wobbly;
		this.heldWobbly = placement.valid && result.extraWobbly;
		this.safeSpots = result.spots;
		this.coverage = result.coverage;
		this.shelterPlans = result.plans;
		this.showSafeSpots();
	}

	private makeMarker(): THREE.Group {
		const marker = new THREE.Group();
		const ring = new THREE.Mesh(new THREE.RingGeometry(0.19, 0.23, 32).rotateX(-Math.PI / 2), this.markerMaterial);
		const person = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.26, 4, 10), this.markerMaterial);
		person.position.y = 0.34;
		marker.add(ring, person);
		marker.renderOrder = 4;
		this.scene.add(marker);
		return marker;
	}

	private showSafeSpots(): void {
		const show = this.phase === 'build';
		for (const [index, spot] of this.safeSpots.entries()) {
			const marker = this.markers[index] ?? this.makeMarker();
			this.markers[index] = marker;
			marker.position.set(spot.at.x, spot.at.y + 0.015, spot.at.z);
			marker.userData.used = true;
			marker.visible = show;
		}
		for (const marker of this.markers.slice(this.safeSpots.length)) { marker.userData.used = false; marker.visible = false; }
		if (!this.coverageMesh) {
			this.coverageMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 0.28).rotateX(-Math.PI / 2),
				new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: false, depthTest: false, side: THREE.DoubleSide }), 1600);
			this.coverageMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			this.coverageMesh.frustumCulled = false;
			this.coverageMesh.renderOrder = 2;
			this.scene.add(this.coverageMesh);
		}
		const matrix = new THREE.Matrix4();
		let count = 0;
		for (const spot of this.coverage) {
			if (spot.cover.roof <= 0 || count >= 1600) continue;
			this.coverageMesh.setMatrixAt(count, matrix.makeTranslation(spot.at.x, spot.at.y + 0.022, spot.at.z));
			this.coverageMesh.setColorAt(count, new THREE.Color(spot.safe ? '#62bb91' : '#edb25e'));
			count++;
		}
		this.coverageMesh.count = count;
		this.coverageMesh.instanceMatrix.needsUpdate = true;
		if (this.coverageMesh.instanceColor) this.coverageMesh.instanceColor.needsUpdate = true;
		this.coverageMesh.visible = show;
		this.tenantsSignature = '';
		this.updateGoal();
	}

	private updateGoal(): void {
		const people = this.presentResidents().length;
		const safe = Math.min(this.safeSpots.length, people);
		const done = people > 0 && safe >= people;
		this.el.goalCount.textContent = `${safe} of ${people}`;
		this.el.goal.dataset.met = String(done);
		const wall = this.needs().wall && this.forecast ? ` and a wall to the ${words.compassName(this.forecast.windFrom)}` : '';
		this.el.goalDetail.textContent = done
			? 'room for everyone. they\'ll find it themselves.'
			: `green ground stays dry. it needs a roof at head height${wall}, and a way in.`;
		if (this.guideRoof) this.guideRoof.visible = this.day === 1 && !done;
		this.el.lessonTitle.textContent = done ? 'that\'ll do.' : 'one roof. two people.';
		this.el.lessonDetail.textContent = done
			? 'the green ground is dry. at nightfall, everyone walks over on their own.'
			: 'put the tin sheet across the two crates. leave room underneath.';
	}

	private prepareFirstBuild(): void {
		// A deliberate first puzzle: two ready supports, one obvious roof, and
		// extra materials to experiment with. Later deliveries remain surprising.
		const kit: [string, number, number][] = [
			['crate', -0.9, -0.65], ['crate', 0.9, -0.65], ['sheet', 0, 1.55],
			['door', -2.5, 0.55], ['plank', -2, -1.7], ['plank', 2.35, 1.2], ['tire', 2.1, -1.6], ['pallet', -1.3, 2.5],
		];
		for (const [id, x, z] of kit) {
			const kind = junkKind(id);
			const rotation = this.rotationFor(kind, 0, 0);
			// The stump and windsock are somewhere random. Anything that would
			// land on one is walked round the island until it sits on grass.
			const resting = junkShape(kind).half.y + 0.05;
			let landing = this.dropShape(kind, x, z, rotation);
			for (let step = 1; step < 12 && landing.position.y > resting; step += 1) {
				const angle = step * 0.35;
				landing = this.dropShape(kind, x * Math.cos(angle) - z * Math.sin(angle), x * Math.sin(angle) + z * Math.cos(angle), rotation);
			}
			this.addPiece(kind, landing.position, rotation);
			this.world.step();
		}
		if (!this.guideRoof) {
			const model = buildJunkModel(junkKind('sheet'), 0);
			for (const material of model.materials) material.dispose();
			const material = new THREE.MeshBasicMaterial({ color: '#fff7d7', transparent: true, opacity: 0.24, depthWrite: false });
			model.group.traverse((child) => { if (child instanceof THREE.Mesh) { child.material = material; child.castShadow = false; } });
			model.group.position.set(0, 0.85, -0.65);
			this.guide.add(model.group);
			this.guideRoof = model.group;
		}
		this.guideRoof.visible = true;
	}

	private clearLanterns(): void {
		for (const lantern of this.lanterns) {
			lantern.removeFromParent();
			lantern.traverse((child) => { if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); } });
		}
		this.lanterns.length = 0;
	}

	private lightShelter(): void {
		this.clearLanterns();
		for (const plan of this.shelterPlans.slice(0, 4)) {
			if (!plan) continue;
			const lantern = new THREE.Group();
			if (this.lanterns.some((other) => other.position.distanceTo(plan.spot.at) < 1.2)) continue;
			const light = new THREE.PointLight('#ffc985', 0.2, 1.8, 1.2);
			light.position.y = 0.28;
			const glow = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe1a3' }));
			glow.position.y = 0.12;
			const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.035, 10), createFill('#5d5242'));
			base.position.y = 0.04;
			const cap = base.clone();
			cap.geometry = base.geometry.clone();
			cap.material = base.material.clone();
			cap.position.y = 0.19;
			const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 5, 12), createFill('#5d5242'));
			handle.position.y = 0.23;
			lantern.add(light, glow, base, cap, handle);
			lantern.position.copy(plan.spot.at).add(new THREE.Vector3(0.18, 0.03, 0.12));
			this.lanterns.push(lantern);
			this.scene.add(lantern);
		}
	}

	private updateScenery(delta: number): void {
		this.island.clouds.update(delta, this.clock);
		if (this.phase === 'storm' || this.phase === 'dawn' || this.phase === 'dusk') {
			const shown = this.push.length() > 0.05
				? this.push
				: this.forecast ? fromVector(this.forecast.windFrom).multiplyScalar(-0.3) : new THREE.Vector3();
			this.island.windsock.update(shown, Math.max(0.3, shown.length()), this.clock);
		} else if (this.forecast && this.phase === 'build') {
			// In daylight the sock points where tonight's wind will blow.
			this.island.windsock.update(fromVector(this.forecast.windFrom).negate(), 0.55, this.clock);
		} else {
			this.island.windsock.update(new THREE.Vector3(1, 0, 0.3), 0.15, this.clock);
		}
		if (this.keyboardCursor && this.phase === 'build') {
			const ground = this.world.castRay(
				new RAPIER.Ray({ x: this.keyboardCursor.x, y: 14, z: this.keyboardCursor.z }, { x: 0, y: -1, z: 0 }),
				30,
				true,
				undefined,
				SOLID_QUERY,
			);
			this.cursorRing.position.set(this.keyboardCursor.x, ground ? 14 - ground.timeOfImpact + 0.02 : 0.02, this.keyboardCursor.z);
			this.cursorRing.visible = !this.held;
		} else {
			this.cursorRing.visible = false;
		}
	}

	private readonly frame = (now: number): void => {
		// Book the next frame first, so one that throws cannot stop the game.
		requestAnimationFrame(this.frame);
		if (document.hidden || this.el.help.open) { this.lastTime = 0; return; }
		const time = now / 1000;
		const delta = this.lastTime ? Math.min(0.05, Math.max(0, time - this.lastTime)) : STEP;
		this.lastTime = time;
		this.clock += delta;

		this.runTimers();
		this.updatePhase(delta);
		this.updateWeather(delta);

		this.accumulator += delta;
		let steps = 0;
		while (this.accumulator >= STEP && steps < MAX_STEPS) {
			this.step();
			this.accumulator -= STEP;
			steps += 1;
		}
		if (steps === MAX_STEPS) this.accumulator = 0;
		this.syncPieces(this.accumulator / STEP);
		if (this.phase === 'build' && this.lookAheadAt > 0 && this.clock >= this.lookAheadAt && !this.held) this.lookAhead();
		this.checkLostJunk();
		this.tidyResidents(delta);
		this.chatter(delta);

		const stillness = this.reducedMotion.matches;
		for (const resident of [...this.residents, ...this.departed]) {
			resident.syncFromBody();
			resident.animate(delta, this.clock, this.yaw, stillness);
		}

		this.updateCamera(delta);
		this.updateLook(delta);
		this.refreshHover();
		this.updateInk();
		this.updateGhost();
		if (this.phase === 'build') this.previewHeld();
		this.updateScenery(delta);
		this.updateBubbles();
		this.updateHud();
		this.renderer.render(this.scene, this.camera, this.clock);
	};
}
