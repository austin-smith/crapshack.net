/**
 * Creates a cozy snowfall effect on the page.
 */

interface Snowflake {
	element: HTMLDivElement;
}

interface WeatherOptions {
	/** Particle count. Fewer for small containers such as the settings previews. */
	count?: number;
	/** Multiplies particle size, so a preview tile is not full of full-size flakes. */
	scale?: number;
	/** Multiplies duration and delay. A short fall needs a short time to fall it. */
	speed?: number;
}

export function initSnowyDay(container: HTMLElement, options: WeatherOptions = {}) {
	const { count: numberOfFlakes = 100, scale = 1, speed: speedScale = 1 } = options;
	const flakes: Snowflake[] = [];

	for (let i = 0; i < numberOfFlakes; i++) {
		const flake = document.createElement('div');
		flake.className = 'snowflake';

		const x = Math.random() * 100;
		const size = (2 + Math.random() * 3) * scale; // 2-5px unscaled
		const speed = (6 + Math.random() * 6) * speedScale; // 6-12s unscaled
		const delay = Math.random() * 6 * speedScale; // 0-6s stagger unscaled
		const opacity = 0.7 + Math.random() * 0.3; // 0.7-1.0

		flake.style.left = `${x}%`;
		flake.style.width = `${size}px`;
		flake.style.height = `${size}px`;
		flake.style.opacity = `${opacity}`;
		flake.style.animationDuration = `${speed}s`;
		flake.style.animationDelay = `${delay}s`;

		container.appendChild(flake);
		flakes.push({ element: flake });
	}

	return () => {
		for (const f of flakes) f.element.remove();
	};
}
