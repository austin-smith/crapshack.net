import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	timeout: 120_000,
	expect: { timeout: 15_000 },
	workers: 1,
	use: {
		baseURL: 'http://127.0.0.1:4392',
		channel: 'chrome',
		viewport: { width: 1440, height: 1000 },
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
	},
	webServer: {
		command: 'node tests/serve-shack.mjs',
		url: 'http://127.0.0.1:4392/shack',
		reuseExistingServer: true,
	},
});
