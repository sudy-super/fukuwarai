/**
 * OGP 画像生成スクリプト
 * 実行: npm run gen-ogp
 * 出力: public/ogp.png (1200x630)
 *
 * ページを実際にレンダリングし、face-container に combined.png を注入して
 * スクリーンショットを撮影する。
 */

import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// ── MIME タイプ ─────────────────────────────────────────────
const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript',
  '.css':   'text/css',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.json':  'application/json',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

// ── 1. ビルド ────────────────────────────────────────────────
console.log('📦 ビルド中...');
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

// ── 2. dist/ を提供する静的サーバーを起動 ────────────────────
const server = createServer(async (req, res) => {
  let urlPath = new URL(req.url, 'http://localhost').pathname;
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = join(DIST, urlPath);
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA フォールバック: 存在しないパスは index.html を返す
    try {
      const data = await readFile(join(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
});

const port = await new Promise(resolve =>
  server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
);
console.log(`🌐 サーバー起動: http://127.0.0.1:${port}`);

// ── 3. Puppeteer でスクリーンショット ────────────────────────
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();

  // OGP 幅は 1200 に固定。高さは余裕を持たせてから後で 630 に crop する
  await page.setViewport({ width: 1200, height: 720, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });

  // combined.png を base64 で読み込む
  const combinedBytes = await readFile(join(ROOT, 'images', 'combined.png'));
  const combinedSrc = `data:image/png;base64,${combinedBytes.toString('base64')}`;

  // ページに注入: face を縮小してボタンが収まるようにし、完成顔を重ねる
  await page.evaluate((src) => {
    // --face を OGP 用に縮小 (ボタン + shadow が 630px 内に収まるサイズ)
    document.documentElement.style.setProperty('--face', '455px');

    // 目隠しを非表示
    const blindfold = document.getElementById('blindfold');
    if (blindfold) blindfold.style.display = 'none';

    // 完成顔を face-container に絶対配置で重ねる
    const container = document.getElementById('face-container');
    if (!container) return;
    const img = document.createElement('img');
    img.src = src;
    img.draggable = false;
    img.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:30;pointer-events:none;user-select:none;';
    container.appendChild(img);
  }, combinedSrc);

  // 注入した画像の読み込みを待つ
  await page.waitForFunction(() =>
    [...document.querySelectorAll('img')].every(img => img.complete),
  );

  const output = join(ROOT, 'public', 'ogp.png');

  // 720px 高さでスクリーンショットを取り、上から 630px に crop して OGP 標準サイズに
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  await sharp(buf)
    .extract({ left: 0, top: 0, width: 1200, height: 630 })
    .toFile(output);

  console.log(`✅ OGP 画像を生成しました: public/ogp.png`);
} finally {
  await browser.close();
  server.close();
}
