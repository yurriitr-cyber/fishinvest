#!/usr/bin/env node
/**
 * Production static server for the Mini App.
 * Proxies /api/* to API_PROXY_TARGET (Railway private/public API URL).
 */
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distDir = join(__dirname, 'dist');
const port = Number(process.env.PORT || 5180);
const apiTarget = (process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function sendFile(res, filePath) {
  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const candidate = normalize(join(distDir, rel));
  if (!candidate.startsWith(distDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    sendFile(res, candidate);
    return;
  }
  // SPA fallback
  const index = join(distDir, 'index.html');
  if (existsSync(index)) {
    sendFile(res, index);
    return;
  }
  res.writeHead(404).end('Not found');
}

function proxyApi(req, res) {
  let target;
  try {
    // apiTarget is origin (e.g. http://api.railway.internal:3000); keep /api path from client
    target = new URL(req.url || '/api', `${apiTarget}/`);
  } catch {
    res.writeHead(502).end(`Bad API_PROXY_TARGET: ${apiTarget}`);
    return;
  }

  const lib = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host };
  delete headers['content-length'];

  const proxyReq = lib.request(
    target,
    {
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    console.error('[web-proxy]', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end(`API proxy error: ${err.message}`);
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api')) {
    proxyApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Mini App listening on :${port}`);
  console.log(`API_PROXY_TARGET=${apiTarget}`);
});
