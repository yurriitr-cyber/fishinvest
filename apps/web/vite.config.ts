import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function inviteOgPlugin(): Plugin {
  return {
    name: 'invite-og',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathOnly = (req.url || '/').split('?')[0];
        const match = pathOnly.match(/^\/invite\/([A-Za-z0-9_-]+)\/?$/);
        if (!match) {
          next();
          return;
        }
        const code = match[1];
        const bot = (
          process.env.TELEGRAM_BOT_USERNAME || 'rarefishinvestment_bot'
        ).replace(/^@/, '');
        const host = req.headers.host || 'localhost:5180';
        const origin = `http://${host}`;
        const tgUrl = `https://t.me/${bot}?start=${encodeURIComponent(`ref_${code}`)}`;
        const imageUrl = `${origin}/og/invite.jpg?v=2`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html><head>
<meta property="og:title" content="Rare Fish — коллекционируй редких рыб со мной" />
<meta property="og:description" content="Получай 50 CR по моей ссылке!" />
<meta property="og:image" content="${imageUrl}" />
<meta http-equiv="refresh" content="0;url=${tgUrl}" />
</head><body><a href="${tgUrl}">Открыть в Telegram</a>
<script>location.replace(${JSON.stringify(tgUrl)})</script></body></html>`);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), inviteOgPlugin()],
  server: {
    port: 5180,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
