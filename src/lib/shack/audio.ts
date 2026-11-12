// Everything is synthesised, so there is nothing to download. The rain and
// wind are one shared noise buffer pushed through different filters.

type Bed = { gain: GainNode; filter: BiquadFilterNode };

export class Sound {
	enabled: boolean;
	private context: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private rain: Bed | null = null;
	private wind: Bed | null = null;
	private lastThunk = 0;

	constructor(enabled: boolean) {
		this.enabled = enabled;
	}

	// Browsers only allow audio after a gesture, so this runs from one.
	wake(): void {
		if (!this.enabled) return;
		if (!this.context) {
			const context = new AudioContext();
			this.context = context;
			this.master = context.createGain();
			this.master.gain.value = 0.9;
			this.master.connect(context.destination);
			this.noise = this.makeNoise(context);
			this.rain = this.makeBed(context, 'bandpass', 1900, 0.5);
			this.wind = this.makeBed(context, 'lowpass', 500, 1.2);
		}
		if (this.context.state === 'suspended') void this.context.resume();
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (enabled) this.wake();
		else void this.context?.suspend();
	}

	private makeNoise(context: AudioContext): AudioBuffer {
		const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
		const data = buffer.getChannelData(0);
		for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
		return buffer;
	}

	private makeBed(context: AudioContext, type: BiquadFilterType, frequency: number, q: number): Bed {
		const source = context.createBufferSource();
		source.buffer = this.noise;
		source.loop = true;
		source.playbackRate.value = 0.7 + Math.random() * 0.6;
		const filter = context.createBiquadFilter();
		filter.type = type;
		filter.frequency.value = frequency;
		filter.Q.value = q;
		const gain = context.createGain();
		gain.gain.value = 0;
		source.connect(filter).connect(gain).connect(this.master as GainNode);
		source.start();
		return { gain, filter };
	}

	// Called every frame with how much weather there is.
	setWeather(rain: number, wind: number, snow: number): void {
		if (!this.context || !this.rain || !this.wind) return;
		const now = this.context.currentTime;
		this.rain.gain.gain.setTargetAtTime(Math.min(1, rain) * 0.09, now, 0.4);
		this.wind.gain.gain.setTargetAtTime(Math.min(1.4, wind + snow * 0.3) * 0.11, now, 0.3);
		this.wind.filter.frequency.setTargetAtTime(280 + wind * 700, now, 0.3);
	}

	private tone(frequency: number, endFrequency: number, duration: number, volume: number, type: OscillatorType, delay = 0): void {
		const context = this.context;
		if (!context || !this.enabled || !this.master) return;
		const start = context.currentTime + delay;
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(frequency, start);
		oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(volume, start + 0.006);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
		oscillator.connect(gain).connect(this.master);
		oscillator.addEventListener('ended', () => {
			oscillator.disconnect();
			gain.disconnect();
		}, { once: true });
		oscillator.start(start);
		oscillator.stop(start + duration + 0.02);
	}

	private burst(frequency: number, duration: number, volume: number, type: BiquadFilterType = 'lowpass', delay = 0): void {
		const context = this.context;
		if (!context || !this.enabled || !this.master || !this.noise) return;
		const start = context.currentTime + delay;
		const source = context.createBufferSource();
		source.buffer = this.noise;
		const filter = context.createBiquadFilter();
		filter.type = type;
		filter.frequency.value = frequency;
		const gain = context.createGain();
		gain.gain.setValueAtTime(volume, start);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
		source.connect(filter).connect(gain).connect(this.master);
		source.addEventListener('ended', () => {
			source.disconnect();
			filter.disconnect();
			gain.disconnect();
		}, { once: true });
		source.start(start, Math.random() * 1.5);
		source.stop(start + duration + 0.02);
	}

	// Something landing on something. `weight` is 0 to 1, `pitch` scales the body.
	thunk(weight: number, pitch = 1, metal = false): void {
		const now = performance.now();
		if (now - this.lastThunk < 45) return;
		this.lastThunk = now;
		const volume = 0.02 + Math.min(1, weight) * 0.08;
		if (metal) {
			this.tone(420 * pitch, 300 * pitch, 0.22, volume * 0.5, 'triangle');
			this.tone(1130 * pitch, 900 * pitch, 0.16, volume * 0.25, 'sine');
		} else {
			this.tone(150 * pitch, 70 * pitch, 0.14, volume, 'triangle');
		}
		this.burst(900 * pitch, 0.05, volume * 0.8);
	}

	pickUp(): void {
		this.tone(240, 360, 0.08, 0.035, 'sine');
	}

	cancel(): void {
		this.tone(300, 200, 0.1, 0.03, 'sine');
	}

	turn(): void {
		this.burst(2600, 0.04, 0.035, 'bandpass');
	}

	nail(): void {
		this.tone(1850, 1500, 0.12, 0.05, 'triangle');
		this.tone(1850, 1500, 0.12, 0.045, 'triangle', 0.11);
		this.tone(1900, 1550, 0.2, 0.05, 'triangle', 0.22);
		this.burst(4000, 0.03, 0.05, 'highpass', 0.22);
	}

	nope(): void {
		this.tone(190, 150, 0.12, 0.04, 'square');
	}

	thunder(distance: number): void {
		const delay = 0.2 + distance * 0.9;
		this.burst(160, 2.6, 0.5, 'lowpass', delay);
		this.burst(80, 3.4, 0.4, 'lowpass', delay + 0.15);
	}

	crack(): void {
		this.burst(3000, 0.25, 0.3, 'highpass');
		this.burst(200, 1.8, 0.5, 'lowpass', 0.05);
	}

	// A resident saying something short. Everyone hums in their own key.
	mumble(key: number): void {
		const base = 180 + key * 90;
		this.tone(base, base * 0.92, 0.09, 0.03, 'sine');
		this.tone(base * 1.12, base * 0.8, 0.14, 0.025, 'sine', 0.1);
	}

	arrive(): void {
		this.tone(520, 520, 0.18, 0.02, 'sine');
		this.tone(660, 660, 0.24, 0.02, 'sine', 0.12);
	}

	// Three unbothered notes for the morning.
	dawn(): void {
		this.tone(392, 392, 0.5, 0.03, 'sine');
		this.tone(494, 494, 0.5, 0.028, 'sine', 0.22);
		this.tone(587, 587, 0.9, 0.026, 'sine', 0.44);
	}

	dusk(): void {
		this.tone(440, 440, 0.6, 0.026, 'sine');
		this.tone(370, 370, 0.6, 0.026, 'sine', 0.25);
		this.tone(294, 294, 1.1, 0.026, 'sine', 0.5);
	}

	lose(): void {
		this.tone(300, 280, 0.4, 0.03, 'triangle');
		this.tone(250, 180, 0.8, 0.03, 'triangle', 0.3);
	}
}
