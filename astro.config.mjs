// @ts-check
import { execSync } from 'node:child_process';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
const SITE_URL = process.env.SITE_URL || 'https://crapshack.net';

// Railway builds have no .git directory, so git info comes from its env there
const gitSha = (
	process.env.RAILWAY_GIT_COMMIT_SHA ?? execSync('git rev-parse HEAD').toString().trim()
).slice(0, 7);
const gitBranch =
	process.env.RAILWAY_GIT_BRANCH ?? execSync('git rev-parse --abbrev-ref HEAD').toString().trim();

export default defineConfig({
	site: SITE_URL,
	server: {
		host: true,
	},
	vite: {
		plugins: [tailwindcss()],
		define: {
			__GIT_SHA__: JSON.stringify(gitSha),
			__GIT_BRANCH__: JSON.stringify(gitBranch),
			__BUILD_TIME__: JSON.stringify(new Date().toISOString()),
		},
	},
});
