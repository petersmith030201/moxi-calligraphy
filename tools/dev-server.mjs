import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, stat } from 'node:fs/promises';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await realpath(path.join(project, 'dist')).catch(() => { throw new Error('请先执行 node tools/build-static.mjs，生成 dist 后再预览。'); });
const argument = process.argv.indexOf('--port');
const port = argument >= 0 ? Number(process.argv[argument + 1]) : 4173;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1–65535 之间的整数。');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
function inside(absolute) {
  const relative = path.relative(root, absolute);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

const server = http.createServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { allow: 'GET, HEAD' }); response.end('Method not allowed'); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) { response.writeHead(400); response.end('Invalid path'); return; }
    let target = path.resolve(root, '.' + pathname);
    if (!inside(target)) { response.writeHead(403); response.end('Forbidden'); return; }
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    const canonical = await realpath(target);
    if (!inside(canonical) || !(await stat(canonical)).isFile()) { response.writeHead(403); response.end('Forbidden'); return; }
    const body = await readFile(canonical);
    response.writeHead(200, { 'content-type': types[path.extname(canonical)] || 'text/plain; charset=utf-8', 'content-length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(error instanceof URIError ? 400 : error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500);
    response.end('File unavailable');
  }
});
server.on('error', error => { console.error(`预览服务启动失败：${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`本地预览：http://127.0.0.1:${port} （仅提供 dist，Ctrl+C 停止）`));
