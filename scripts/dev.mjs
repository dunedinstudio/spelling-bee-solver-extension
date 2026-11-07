import { run, at } from './common.mjs';
import { serve } from './server.mjs';
await run([at('scripts/build.mjs')]);
const server = await serve();
console.log(`Local popup preview: ${server.origin}. Rebuild after edits. Load dist/chromium as an unpacked extension for browser integration testing.`);
process.on('SIGINT', async () => { await server.close(); process.exit(0); });
