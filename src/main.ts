import './style.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface Part {
  readonly id: string;
  readonly src: string;
  readonly label: string;
}

/** Offset from the part's feature center, stored in "480px reference" units. */
interface Offset {
  ox: number;
  oy: number;
}

/** Normalized (0–1) center of visible pixels within the source image. */
interface FeatureCenter {
  cx: number;
  cy: number;
}

type GameState = 'initial' | 'playing' | 'revealed';

// ── Constants ──────────────────────────────────────────────────────────────

const PARTS: readonly Part[] = [
  { id: 'eye_left',      src: '/images/eye_left_combined.png',  label: '左目'   },
  { id: 'eye_right',     src: '/images/eye_right_combined.png', label: '右目'   },
  { id: 'gosan_combined', src: '/images/gosan_combined.png',     label: '五三の桐' },
  { id: 'mouth',         src: '/images/mouth.png',              label: '口'     },
];

/** Reference size used when storing offsets. Actual render size may differ. */
const REF_SIZE = 480;

// ── DOM refs ───────────────────────────────────────────────────────────────

const faceEl     = document.getElementById('face-container') as HTMLDivElement;
const blindEl    = document.getElementById('blindfold')      as HTMLDivElement;
const trayEl     = document.getElementById('tray')           as HTMLDivElement;
const progEl     = document.getElementById('progress')       as HTMLDivElement;
const scoreEl    = document.getElementById('score')          as HTMLDivElement;
const ghostEl    = document.getElementById('ghost')          as HTMLDivElement;
const ghostThumb = document.getElementById('ghost-thumb')    as HTMLDivElement;
const btnStart   = document.getElementById('btn-start')      as HTMLButtonElement;
const btnOpen    = document.getElementById('btn-open')       as HTMLButtonElement;
const btnShare   = document.getElementById('btn-share')      as HTMLButtonElement;
const btnRetry   = document.getElementById('btn-retry')      as HTMLButtonElement;

// ── Game state ─────────────────────────────────────────────────────────────

let gameState: GameState = 'initial';
let placed: Map<string, Offset> = new Map();
let dragging: Part | null = null;

/** Feature center for each part, computed from pixel data on startup. */
const centers: Map<string, FeatureCenter> = new Map();

// ── Feature center detection ───────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Scan non-transparent pixels to find the bounding-box center. */
async function detectCenter(src: string): Promise<FeatureCenter> {
  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return {
    cx: (minX + maxX) / 2 / w,
    cy: (minY + maxY) / 2 / h,
  };
}

async function detectAllCenters(): Promise<void> {
  await Promise.all(
    PARTS.map(async (p) => {
      centers.set(p.id, await detectCenter(p.src));
    }),
  );
}

// ── UI builders ────────────────────────────────────────────────────────────

const THUMB_SIZE = 90;
const THUMB_BG   = 180;
const GHOST_SIZE = 100;
const GHOST_BG   = 200;

/** Compute background-position that centers the feature in a thumbnail. */
function centeredBgPos(partId: string, containerSize: number, bgSize: number): string {
  const c = centers.get(partId);
  if (!c) return 'center';
  const bx = containerSize / 2 - c.cx * bgSize;
  const by = containerSize / 2 - c.cy * bgSize;
  return `${bx}px ${by}px`;
}

function buildTray(): void {
  trayEl.innerHTML = '';
  for (const part of PARTS) {
    const card = document.createElement('div');
    card.className = 'part-card' + (placed.has(part.id) ? ' placed' : '');
    card.dataset['id'] = part.id;

    const thumb = document.createElement('div');
    thumb.className = 'part-thumb';
    thumb.style.backgroundImage = `url(${part.src})`;
    thumb.style.backgroundPosition = centeredBgPos(part.id, THUMB_SIZE, THUMB_BG);

    const name = document.createElement('div');
    name.className = 'part-name';
    name.textContent = part.label;

    card.append(thumb, name);

    if (!placed.has(part.id)) {
      card.addEventListener('mousedown',  onMouseDown);
      card.addEventListener('touchstart', onTouchStart, { passive: false });
    }
    trayEl.appendChild(card);
  }
}

function renderPlaced(): void {
  document.querySelectorAll<HTMLImageElement>('.part-layer').forEach(el => el.remove());

  const sz = faceEl.offsetWidth;
  const scale = sz / REF_SIZE;

  for (const [id, { ox, oy }] of placed) {
    const part = PARTS.find(p => p.id === id)!;
    const img = document.createElement('img');
    img.className = 'part-layer';
    img.src = part.src;
    img.alt = part.label;
    img.draggable = false;
    img.style.transform = `translate(${ox * scale}px, ${oy * scale}px)`;
    faceEl.insertBefore(img, blindEl);
  }
}

function updateProgress(): void {
  if (gameState !== 'playing') {
    progEl.textContent = '';
    return;
  }
  progEl.textContent = `${placed.size}/${PARTS.length}`;
}

/**
 * 減点方式スコア計算。
 * 100点満点から各パーツのズレに応じて減点する。
 *
 * - 理想位置: ox=0, oy=0 (各 PNG をそのまま重ねた状態)
 * - 各パーツの満点: 100 / PARTS.length 点
 * - ズレが tolerance (maxDist × 0.3) 以内なら比例減点、超えたら満点減点
 */
function computeScore(): number {
  const sz    = faceEl.offsetWidth;
  const scale = sz / REF_SIZE;
  const maxDeductionPerPart = 100 / PARTS.length;

  let totalDeduction = 0;
  for (const [id, { ox, oy }] of placed) {
    const c         = centers.get(id) ?? { cx: 0.5, cy: 0.5 };
    const dist      = Math.hypot(ox * scale, oy * scale);
    const maxDist   = Math.hypot(
      Math.max(c.cx, 1 - c.cx) * sz,
      Math.max(c.cy, 1 - c.cy) * sz,
    );
    // maxDist の 15% を許容範囲とし、それを超えると満点減点
    // ratio を二乗することで、ズレが小さいほどスコアが指数関数的に伸びる
    const tolerance = maxDist * 0.15;
    const ratio     = Math.min(1, dist / tolerance) ** 2;
    totalDeduction += maxDeductionPerPart * ratio;
  }
  return Math.max(0, Math.round(100 - totalDeduction));
}

/** 1200×630 の OGP 用画像を生成する。顔を中央に配置し、スコアを下部に描画する。 */
async function captureOgpImage(): Promise<Blob> {
  const OGP_W = 1200, OGP_H = 630;
  const FACE_SIZE = REF_SIZE; // 480px — オフセットが REF_SIZE 基準なのでスケール 1

  const canvas = document.createElement('canvas');
  canvas.width  = OGP_W;
  canvas.height = OGP_H;
  const ctx = canvas.getContext('2d')!;

  // ページ背景色
  ctx.fillStyle = '#fdf0d5';
  ctx.fillRect(0, 0, OGP_W, OGP_H);

  // 顔エリアを中央に配置
  const faceX = (OGP_W - FACE_SIZE) / 2;
  const faceY = (OGP_H - FACE_SIZE) / 2 - 20; // 少し上寄せしてスコア用の余白を確保

  ctx.fillStyle = '#f0e0c8';
  ctx.fillRect(faceX, faceY, FACE_SIZE, FACE_SIZE);

  // ベースの顔
  const faceBase = document.getElementById('face-base') as HTMLImageElement;
  ctx.drawImage(faceBase, faceX, faceY, FACE_SIZE, FACE_SIZE);

  // 配置済みパーツ (ox/oy は REF_SIZE 単位、FACE_SIZE=REF_SIZE なのでスケール 1)
  for (const [id, { ox, oy }] of placed) {
    const part = PARTS.find(p => p.id === id)!;
    const img  = await loadImage(part.src);
    ctx.drawImage(img, faceX + ox, faceY + oy, FACE_SIZE, FACE_SIZE);
  }

  // スコアテキスト
  const score = computeScore();
  ctx.font      = 'bold 38px "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#c0392b';
  ctx.textAlign = 'center';
  ctx.fillText(`一致度: ${score}%`, OGP_W / 2, faceY + FACE_SIZE + 52);

  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'),
  );
}

function setButtons(show: ('start' | 'open' | 'share' | 'retry')[], openEnabled = false): void {
  btnStart.style.display = show.includes('start') ? 'inline-block' : 'none';
  btnOpen.style.display  = show.includes('open')  ? 'inline-block' : 'none';
  btnShare.style.display = show.includes('share') ? 'inline-block' : 'none';
  btnRetry.style.display = show.includes('retry') ? 'inline-block' : 'none';
  btnOpen.disabled = !openEnabled;
}

// ── Drop logic ─────────────────────────────────────────────────────────────

function dropAt(cx: number, cy: number): void {
  if (!dragging) return;

  ghostEl.style.display = 'none';
  faceEl.classList.remove('drag-over');

  const rect = faceEl.getBoundingClientRect();
  const lx = cx - rect.left;
  const ly = cy - rect.top;

  if (lx >= 0 && lx <= rect.width && ly >= 0 && ly <= rect.height) {
    const scale = rect.width / REF_SIZE;
    // Use the feature's visual center as anchor instead of the image center
    const c = centers.get(dragging.id) ?? { cx: 0.5, cy: 0.5 };
    const anchorX = c.cx * rect.width;
    const anchorY = c.cy * rect.height;

    placed.set(dragging.id, {
      ox: (lx - anchorX) / scale,
      oy: (ly - anchorY) / scale,
    });
    renderPlaced();
    buildTray();
    updateProgress();

    if (placed.size === PARTS.length) {
      btnOpen.disabled = false;
    }
  }

  dragging = null;
}

// ── Drag — mouse ───────────────────────────────────────────────────────────

function onMouseDown(e: MouseEvent): void {
  if (gameState !== 'playing') return;
  const card = e.currentTarget as HTMLElement;
  const id = card.dataset['id']!;
  if (placed.has(id)) return;

  dragging = PARTS.find(p => p.id === id)!;
  startGhost(dragging, e.clientX, e.clientY);
  e.preventDefault();
}

document.addEventListener('mousemove', (e: MouseEvent) => {
  if (!dragging) return;
  moveGhost(e.clientX, e.clientY);
  updateDragOver(e.clientX, e.clientY);
});

document.addEventListener('mouseup', (e: MouseEvent) => {
  if (!dragging) return;
  dropAt(e.clientX, e.clientY);
});

// ── Drag — touch ───────────────────────────────────────────────────────────

function onTouchStart(e: TouchEvent): void {
  if (gameState !== 'playing') return;
  const card = e.currentTarget as HTMLElement;
  const id = card.dataset['id']!;
  if (placed.has(id)) return;

  dragging = PARTS.find(p => p.id === id)!;
  const t = e.touches[0];
  startGhost(dragging, t.clientX, t.clientY);
  e.preventDefault();
}

document.addEventListener('touchmove', (e: TouchEvent) => {
  if (!dragging) return;
  const t = e.touches[0];
  moveGhost(t.clientX, t.clientY);
  updateDragOver(t.clientX, t.clientY);
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchend', (e: TouchEvent) => {
  if (!dragging) return;
  const t = e.changedTouches[0];
  dropAt(t.clientX, t.clientY);
});

document.addEventListener('touchcancel', () => {
  if (!dragging) return;
  ghostEl.style.display = 'none';
  faceEl.classList.remove('drag-over');
  dragging = null;
});

// ── Ghost helpers ──────────────────────────────────────────────────────────

function startGhost(part: Part, cx: number, cy: number): void {
  ghostThumb.style.backgroundImage = `url(${part.src})`;
  ghostThumb.style.backgroundPosition = centeredBgPos(part.id, GHOST_SIZE, GHOST_BG);
  ghostEl.style.display = 'block';
  moveGhost(cx, cy);
}

function moveGhost(cx: number, cy: number): void {
  ghostEl.style.left = `${cx}px`;
  ghostEl.style.top  = `${cy}px`;
}

function updateDragOver(cx: number, cy: number): void {
  const r = faceEl.getBoundingClientRect();
  const inside = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  faceEl.classList.toggle('drag-over', inside);
}

// ── Buttons ────────────────────────────────────────────────────────────────

btnStart.addEventListener('click', () => {
  gameState = 'playing';
  placed = new Map();

  document.querySelectorAll('.part-layer').forEach(el => el.remove());
  buildTray();
  updateProgress();
  blindEl.classList.add('show');
  setButtons(['open'], false);
});

btnOpen.addEventListener('click', () => {
  if (btnOpen.disabled) return;

  blindEl.classList.remove('show');
  faceEl.classList.remove('flash');
  void faceEl.offsetWidth; // reflow to restart animation
  faceEl.classList.add('flash');

  gameState = 'revealed';
  setButtons(['share', 'retry']);
  progEl.textContent = '';
  scoreEl.textContent = `一致度: ${computeScore()}%`;
});

function isInAppBrowser(): boolean {
  return /Twitter|Instagram|FBAN|FBAV|Line\/|KAKAOTALK/i.test(navigator.userAgent);
}

btnShare.addEventListener('click', async () => {
  btnShare.disabled = true;
  const origText = btnShare.textContent;
  btnShare.textContent = '生成中…';

  let twitterUrl = '';
  let shareUrl   = '';

  try {
    const score = computeScore();
    const blob  = await captureOgpImage();

    const res = await fetch('/api/share', {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': 'image/png' },
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const { id } = await res.json() as { id: string };

    shareUrl   = `${location.origin}/s/${id}`;
    const text = `そぽ笑いの一致度は${score}%でした！\n#そぽ笑い`;
    const params = new URLSearchParams({ text: `${text}\n${shareUrl}` });
    twitterUrl = `https://twitter.com/intent/tweet?${params}`;
  } catch (err) {
    console.error(err);
    alert('シェアに失敗しました');
    btnShare.disabled    = false;
    btnShare.textContent = origText;
    return;
  }

  // ページ遷移が起きる前にボタンを復元する
  btnShare.disabled    = false;
  btnShare.textContent = origText;

  if (isInAppBrowser()) {
    // アプリ内ブラウザでは window.open が効かないため直接遷移する
    location.href = twitterUrl;
  } else {
    window.open(twitterUrl, '_blank', 'noopener');
  }
});

btnRetry.addEventListener('click', () => {
  gameState = 'initial';
  placed = new Map();

  document.querySelectorAll('.part-layer').forEach(el => el.remove());
  buildTray();
  progEl.textContent = '';
  scoreEl.textContent = '';
  setButtons(['start']);
  blindEl.classList.remove('show');
});

// ── Init ───────────────────────────────────────────────────────────────────

(document.getElementById('year') as HTMLSpanElement).textContent =
  String(new Date().getFullYear());

(async () => {
  await detectAllCenters();
  setButtons(['start']);
  buildTray();
})();
