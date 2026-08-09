interface AppDefinition {
	name: string;
	sidebarLabel: string;
	href: string;
	icon: string;
	description: string;
	repoUrl: string;
	appcastUrl?: string;
	dockerUrl?: string;
	appStoreUrl?: string;
	appUrl?: string;
	docsUrl?: string;
	npmUrl?: string;
}

export const bitdream = {
	name: 'BitDream',
	sidebarLabel: 'bitdream',
	href: '/bitdream',
	icon: '/images/bitdream/bitdream.png',
	description: 'A native, feature-rich remote control client for Transmission web server.',
	repoUrl: 'https://github.com/austin-smith/BitDream',
	appcastUrl: 'https://austin-smith.github.io/BitDream/appcast.xml',
};

export const computerSolitaire = {
	name: 'Computer Solitaire',
	sidebarLabel: 'solitaire',
	href: '/computer-solitaire',
	icon: '/images/computer-solitaire/computer-solitaire-icon.png',
	description: 'A fully native Solitaire app for iOS, iPadOS, and macOS.',
	repoUrl: 'https://github.com/austin-smith/ComputerSolitaire',
	appcastUrl: 'https://austin-smith.github.io/ComputerSolitaire/appcast.xml',
};

export const crapdash = {
	name: 'crapdash',
	sidebarLabel: 'crapdash',
	href: '/crapdash',
	icon: '/images/crapdash/compy.png',
	description: 'Low-frills, customizable homepage to organize your links and services.',
	repoUrl: 'https://github.com/austin-smith/crapdash',
	dockerUrl: 'https://github.com/austin-smith/crapdash/pkgs/container/crapdash',
};

export const plexbar = {
	name: 'PlexBar',
	sidebarLabel: 'plexbar',
	href: '/plexbar',
	icon: '/images/plexbar/plexbar.png',
	description: 'A lightweight macOS menu bar app for Plex server telemetry.',
	repoUrl: 'https://github.com/austin-smith/PlexBar',
	appcastUrl: 'https://austin-smith.github.io/PlexBar/appcast.xml',
};

export const spotuify = {
	name: 'spotuify',
	sidebarLabel: 'spotuify',
	href: '/spotuify',
	icon: '/images/spotuify/spotuify.png',
	description: 'Spotify in ur terminal. Interactive TUI and scriptable CLI.',
	repoUrl: 'https://github.com/austin-smith/spotuify',
	npmUrl: 'https://www.npmjs.com/package/spotuify',
};

export const stuckers = {
	name: 'Stuckers',
	sidebarLabel: 'stuckers',
	href: '/stuckers',
	icon: '/images/stuckers/stuckers-icon.png',
	description: 'Hand-drawn animated sticker pack for iMessage. (i.e., stickers for phone.)',
	repoUrl: 'https://github.com/austin-smith/Stuckers',
	appStoreUrl: 'https://apps.apple.com/us/app/stuckers/id1173389437',
};

export const webhooks = {
	name: 'webhooks.lol',
	sidebarLabel: 'webhooks',
	href: '/webhooks-lol',
	icon: '/images/webhooks-lol/webhooks-lol.png',
	description: 'A small webhook endpoint for receiving and inspecting HTTP requests.',
	repoUrl: 'https://github.com/austin-smith/webhooks.lol',
	appUrl: 'https://webhooks.lol',
	docsUrl: 'https://docs.webhooks.lol',
	npmUrl: 'https://www.npmjs.com/package/whlol',
};

export const apps: AppDefinition[] = [bitdream, computerSolitaire, crapdash, plexbar, spotuify, stuckers, webhooks];
