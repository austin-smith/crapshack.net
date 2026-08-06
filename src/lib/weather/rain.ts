/**
 * Creates a cozy rain effect on the page
 */

interface Raindrop {
	element: HTMLDivElement;
	x: number;
	speed: number;
	delay: number;
}

interface WeatherOptions {
	/** Particle count. Fewer for small containers such as the settings previews. */
	count?: number;
	/** Multiplies particle length, so a preview tile is not full of full-size drops. */
	scale?: number;
	/** Multiplies duration and delay. A short fall needs a short time to fall it. */
	speed?: number;
}

export function initRainyDay(container: HTMLElement, options: WeatherOptions = {}) {
	const { count: numberOfDrops = 100, scale = 1, speed: speedScale = 1 } = options;
	const raindrops: Raindrop[] = [];

	// Create raindrops
	for (let i = 0; i < numberOfDrops; i++) {
		const drop = document.createElement('div');
		drop.className = 'raindrop';
		
		// Random horizontal position
		const x = Math.random() * 100;
		
		// Random speed for variation
		const speed = (1.5 + Math.random() * 2.5) * speedScale; // 1.5-4 seconds, faster
		
		// Random delay for staggered start
		const delay = Math.random() * 5 * speedScale;
		
		// Random opacity for depth - more visible
		const opacity = 0.3 + Math.random() * 0.5;
		
		// Random length variation
		const length = (15 + Math.random() * 25) * scale;
		
		drop.style.left = `${x}%`;
		drop.style.animationDuration = `${speed}s`;
		drop.style.animationDelay = `${delay}s`;
		drop.style.opacity = `${opacity}`;
		drop.style.height = `${length}px`;
		
		container.appendChild(drop);
		
		raindrops.push({
			element: drop,
			x,
			speed,
			delay,
		});
	}
	
	return () => {
		// Cleanup function
		raindrops.forEach(drop => drop.element.remove());
	};
}
