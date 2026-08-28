#!/usr/bin/env node
/**
 * Production static server for the Mini App + Admin console.
 * Proxies /api/* to API_PROXY_TARGET (Railway private/public API URL).
 */
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distDir = normalize(join(__dirname, 'dist'));
const adminIndex = join(distDir, 'admin', 'index.html');
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
  const rel = filePath.split(`${sep}dist${sep}`).pop() || filePath;
  // Banners/OG/art get updated in place — don't pin them immutable for a year
  // (iOS WebView otherwise keeps the old image forever).
  const softCache =
    /(^|[/\\])(banners|og|fish|cases)([/\\]|$)/i.test(rel) ||
    /[/\\](banner-|invite\.)/i.test(rel);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control':
      ext === '.html'
        ? 'no-cache'
        : softCache
          ? 'public, max-age=300, must-revalidate'
          : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
}

function resolveUnderDist(urlPath) {
  // Strip query already done; strip leading slashes so join never resets to root
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) {
    rel = `${rel}index.html`;
  }
  const candidate = normalize(join(distDir, rel));
  const root = distDir.endsWith(sep) ? distDir : distDir + sep;
  if (candidate !== distDir && !candidate.startsWith(root)) {
    return null;
  }
  return candidate;
}

function serveStatic(req, res) {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/admin' || urlPath.startsWith('/admin?')) {
    res.writeHead(302, { Location: '/admin/' });
    res.end();
    return;
  }

  const candidate = resolveUnderDist(urlPath);
  if (!candidate) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    sendFile(res, candidate);
    return;
  }

  // Admin SPA fallback
  if (urlPath === '/admin/' || urlPath.startsWith('/admin/')) {
    if (existsSync(adminIndex)) {
      sendFile(res, adminIndex);
      return;
    }
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Admin UI not built into this image. Redeploy web service.');
    return;
  }

  // Mini App SPA fallback
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
  const url = req.url || '/';
  if (url.startsWith('/api')) {
    proxyApi(req, res);
    return;
  }
  if (serveInviteLanding(req, res)) {
    return;
  }
  serveStatic(req, res);
});

/**
 * Share landing for referral links. Telegram (and others) crawl this HTML for
 * Open Graph preview — so the invite banner shows next to the link.
 */
function serveInviteLanding(req, res) {
  const pathOnly = (req.url || '/').split('?')[0];
  const match = pathOnly.match(/^\/invite\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) return false;

  const code = match[1];
  const bot = (
    process.env.TELEGRAM_BOT_USERNAME || 'rarefishinvestment_bot'
  ).replace(/^@/, '');
  const host =
    String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim() || 'localhost';
  const proto = String(
    req.headers['x-forwarded-proto'] ||
      (host.includes('localhost') ? 'http' : 'https'),
  )
    .split(',')[0]
    .trim();
  const origin = `${proto}://${host}`;
  const tgUrl = `https://t.me/${bot}?start=${encodeURIComponent(`ref_${code}`)}`;
  const imageUrl = `${origin}/og/invite.jpg?v=2`;
  const title = 'Rare Fish — коллекционируй редких рыб со мной';
  const description = 'Получай 50 CR по моей ссылке!';

  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Rare Fish" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${origin}/invite/${code}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:image:secure_url" content="${imageUrl}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1024" />
  <meta property="og:image:height" content="481" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${imageUrl}" />
  <meta http-equiv="refresh" content="0;url=${tgUrl}" />
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
      font-family:system-ui,sans-serif;background:#04121f;color:#e9f5fb;padding:24px;text-align:center}
    a{color:#46d6e6;font-weight:700;font-size:1.1rem}
    img{max-width:min(100%,520px);border-radius:16px;margin:16px 0}
  </style>
</head>
<body>
  <div>
    <img src="${imageUrl}" alt="Rare Fish invite" width="1024" height="481" />
    <p>Открываем Rare Fish…</p>
    <p><a href="${tgUrl}">Открыть в Telegram</a></p>
  </div>
  <script>location.replace(${JSON.stringify(tgUrl)});</script>
</body>
</html>`;

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
  });
  res.end(html);
  return true;
}

server.listen(port, '0.0.0.0', () => {
  console.log(`Mini App listening on :${port}`);
  console.log(`API_PROXY_TARGET=${apiTarget}`);
  console.log(
    `Admin UI: ${existsSync(adminIndex) ? 'ready at /admin/ (broadcast)' : 'MISSING (check Docker build)'}`,
  );
});
