// Construit public/ (site Netlify) et dist/demo.html (démonstration autonome).
import fs from 'node:fs';
import { build } from 'esbuild';

const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];
const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,650;12..96,700;12..96,800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap';

const res = await build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', minify: true, write: false, target: ['es2020'], legalComments: 'none', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
const js = res.outputFiles[0].text;
const css = fs.readFileSync('src/styles.css', 'utf8');

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/app.js', js);
fs.writeFileSync('public/styles.css', css);
fs.writeFileSync('public/index.html', `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ORIBA ERP — Gestion commerciale</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#c98a1b"/><text x="16" y="21" font-family="Arial" font-weight="800" font-size="13" text-anchor="middle" fill="#1b1404">OF</text></svg>')}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div id="app"></div>
${CDN.map((u) => `<script src="${u}" defer></script>`).join('\n')}
<script src="/app.js" defer></script>
</body>
</html>
`);

// Version GitHub Pages (API sur Supabase)
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/app.js', js);
fs.writeFileSync('docs/styles.css', css);
fs.writeFileSync('docs/.nojekyll', '');
fs.writeFileSync('docs/index.html', fs.readFileSync('public/index.html', 'utf8')
  .replace('href="/styles.css"', 'href="styles.css"')
  .replace('<script src="/app.js" defer></script>', '<script>window.ERP_API_URL = "https://zzycbxyefporwjztybix.supabase.co/functions/v1/erp-api";</script>\n<script src="app.js" defer></script>'));

// Démonstration autonome (artefact) : fragment sans doctype, tout en ligne
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/demo.html', `<title>ORIBA ERP Démo</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${FONTS}">
<style>${css}</style>
<div id="app"></div>
${CDN.map((u) => `<script src="${u}"></script>`).join('\n')}
<script>window.ERP_DEMO = true;</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
`);
console.log(`Construit : app.js ${(js.length / 1024).toFixed(0)} Ko`);
