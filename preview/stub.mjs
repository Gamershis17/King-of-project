import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp3':'audio/mpeg' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/status') { res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({maintenance:false})); return; }
  if (url.pathname === '/api/me' || url.pathname === '/api/auth/me') { res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({user:{username:'preview', role:'player', title:null}})); return; }
  if (url.pathname === '/api/state' && req.method === 'GET') {
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({ state: { race:'human', level:12, stage:15, uiStyle: process.env.UISTYLE || 'modern' }, lastSeenAt: null }));
    return;
  }
  if (url.pathname === '/api/state' && req.method === 'POST') { req.resume(); res.writeHead(200,{'content-type':'application/json'}); res.end('{"ok":true}'); return; }
  if (url.pathname === '/api/broadcasts/latest') { res.writeHead(200,{'content-type':'application/json'}); res.end('{"broadcast":null}'); return; }
  if (url.pathname.startsWith('/api/')) { res.writeHead(404,{'content-type':'application/json'}); res.end('{}'); return; }
  let p = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, {'content-type': MIME[path.extname(p)] || 'application/octet-stream'});
    res.end(d);
  });
});
server.listen(3101, () => console.log('stub on 3101'));
