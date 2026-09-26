import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const requested = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
    if (!requested.startsWith(root)) throw new Error('Invalid path');
    const info = await stat(requested); const file = info.isDirectory() ? join(requested, 'index.html') : requested;
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4173'));
