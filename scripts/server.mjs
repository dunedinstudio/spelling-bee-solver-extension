import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { at, json } from './common.mjs';

/** Local-only QA preview, never a deployed service. */
export async function serve(browser = 'chromium') {
  const csp = (await json(at('dist', browser, 'manifest.json'))).content_security_policy.extension_pages;
  const directory = at('dist', browser);
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const target = path.resolve(directory, `.${pathname === '/' ? '/popup.html' : pathname}`);
      if (!target.startsWith(directory + path.sep)) throw new Error('Invalid path');
      const content = await readFile(target);
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[path.extname(target)] ?? 'text/plain';
      response.writeHead(200, { 'Content-Type': mime, 'Content-Security-Policy': csp, 'Cache-Control': 'no-store' });
      response.end(content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
