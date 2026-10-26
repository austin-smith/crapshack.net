import { dev } from 'astro';

// Keep the test server in the foreground so Playwright owns its lifetime,
// including when Astro's CLI would otherwise auto-background for an agent.
const server = await dev({ server: { port: 4392, host: '127.0.0.1' }, vite: { server: { strictPort: true } } });
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, async () => { await server.stop(); process.exit(0); });
}
