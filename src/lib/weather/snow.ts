/**
 * Creates a cozy snowfall effect on the page.
 */

interface Snowflake {
  element: HTMLDivElement;
}

export function initSnowyDay(container: HTMLElement) {
  const flakes: Snowflake[] = [];
  const numberOfFlakes = 100;

  for (let i = 0; i < numberOfFlakes; i++) {
    const flake = document.createElement('div');
    flake.className = 'snowflake';

    const x = Math.random() * 100;
    const size = 2 + Math.random() * 3; // 2-5px
    const speed = 6 + Math.random() * 6; // 6-12s
    const delay = Math.random() * 6; // 0-6s stagger
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
