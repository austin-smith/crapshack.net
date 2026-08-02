// @ts-check
import { execSync } from 'node:child_process';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
const SITE_URL = process.env.SITE_URL || 'https://crapshack.net';

/** @param {string} command */
function git(command) {
	try {
		return execSync(command).toString().trim();
	} catch {
		return undefined;
	}
}

// Railway builds have no .git directory, so git info comes from its env there;
// contexts with neither (e.g. a source archive) build with "unknown" rather than failing
const gitSha = (process.env.RAILWAY_GIT_COMMIT_SHA ?? git('git rev-parse HEAD') ?? 'unknown').slice(0, 7);
const gitBranch = process.env.RAILWAY_GIT_BRANCH ?? git('git rev-parse --abbrev-ref HEAD') ?? 'unknown';
const gitCommitMessage = (
	process.env.RAILWAY_GIT_COMMIT_MESSAGE ?? git('git log -1 --format=%s') ?? 'unknown'
).split('\n')[0];
// only meaningful for local builds; deploys always build a committed snapshot
const gitDirty = !process.env.RAILWAY_GIT_COMMIT_SHA && Boolean(git('git status --porcelain'));

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
			__GIT_COMMIT_MESSAGE__: JSON.stringify(gitCommitMessage),
			__GIT_DIRTY__: JSON.stringify(gitDirty),
			__BUILD_TIME__: JSON.stringify(new Date().toISOString()),
		},
	},
});
