# www

Vite + React + TypeScript landing for Desks. Unused. Intended host when
published: `omadesk.mdtrr.com`.

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
npm test
```

## Cloudflare Pages

Nothing publishes this folder. Settings if it is wired later:

| Setting | Value |
| --- | --- |
| Root directory | `www` |
| Build command | `npm ci && npm run build` |
| Build output | `dist` |
| Production branch | `main` |
| Custom domain | `omadesk.mdtrr.com` |

SPA deep links use `public/404.html` (bounce to `/?/path`) and the restore script in `index.html`. `public/_redirects` rewrites unknown paths to `/index.html` with HTTP 200.
