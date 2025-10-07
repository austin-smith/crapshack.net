/**
 * Creates a cozy rain effect on the page
 */

interface Raindrop {
	element: HTMLDivElement;
	x: number;
	speed: number;
	delay: number;
}

export function initRainyDay(container: HTMLElement) {
	const raindrops: Raindrop[] = [];
	const numberOfDrops = 100; // Increased for more visibility

	// Create raindrops
	for (let i = 0; i < numberOfDrops; i++) {
		const drop = document.createElement('div');
		drop.className = 'raindrop';
		
		// Random horizontal position
		const x = Math.random() * 100;
		
		// Random speed for variation
		const speed = 1.5 + Math.random() * 2.5; // 1.5-4 seconds, faster
		
		// Random delay for staggered start
		const delay = Math.random() * 5;
		
		// Random opacity for depth - more visible
		const opacity = 0.3 + Math.random() * 0.5;
		
		// Random length variation
		const length = 15 + Math.random() * 25;
		
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
