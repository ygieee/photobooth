const $ = id => document.getElementById(id);
const video = $('camera'), stage = $('stage'), countdownEl = $('countdown'), flashEl = $('flash'), statusEl = $('status');
const startBtn = $('startCamera'), takeBtn = $('takePhoto'), switchBtn = $('switchCamera');
const retakeBtn = $('retakeAll'), downloadBtn = $('download'), shareBtn = $('share');
const strip = $('photoStrip'), sctx = strip.getContext('2d');
const filterSel = $('filter'), countSel = $('photoCount'), timerSel = $('timer'), layoutSel = $('layout');
const stripColor = $('stripColor'), bgColor = $('bgColor'), caption = $('caption'), showDate = $('showDate');

const PW = 480, PH = 360, PAD = 24;          // photo size and spacing on the strip
let stream = null, facing = 'user', busy = false, shots = [], slots = [], audio = null;

// Filters: css is used for the live preview and capture; px is a fallback for
// browsers (like Safari) whose canvas does not support ctx.filter.
const lum = (r, g, b) => .299 * r + .587 * g + .114 * b;
const FILTERS = {
  none:   { css: 'none' },
  bw:     { css: 'grayscale(1) contrast(1.1)', px: (r, g, b) => { const y = lum(r, g, b) * 1.05; return [y, y, y]; } },
  sepia:  { css: 'sepia(1)', px: (r, g, b) => [r * .393 + g * .769 + b * .189, r * .349 + g * .686 + b * .168, r * .272 + g * .534 + b * .131] },
  warm:   { css: 'sepia(.35) saturate(1.3) brightness(1.05)', px: (r, g, b) => [r * 1.1 + 10, g * 1.02, b * .88] },
  vivid:  { css: 'saturate(1.7) contrast(1.1)', px: (r, g, b) => { const y = lum(r, g, b); return [0, 1, 2].map(i => (y + ([r, g, b][i] - y) * 1.7 - 128) * 1.1 + 128); } },
  bright: { css: 'brightness(1.3)', px: (r, g, b) => [r * 1.3, g * 1.3, b * 1.3] }
};
const hasCtxFilter = 'filter' in document.createElement('canvas').getContext('2d');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const setStatus = t => { statusEl.textContent = t; };

function isDark(hex) {
  const n = parseInt(hex.slice(1), 16);
  return lum(n >> 16, (n >> 8) & 255, n & 255) < 140;
}

function beep(freq = 660, dur = .12, vol = .15) {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + dur);
  } catch {}
}

/* ---------- Camera ---------- */
async function startCamera() {
  if (!navigator.mediaDevices) { setStatus('The camera needs a secure (https) page to work.'); return; }
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    video.srcObject = stream;
    video.classList.toggle('mirror', facing === 'user');
    stage.classList.add('live');
    startBtn.hidden = true;
    takeBtn.disabled = switchBtn.disabled = false;
    setStatus('Ready. Press Take photos, or hit the space bar.');
  } catch (err) {
    console.error(err);
    setStatus('Camera blocked. Allow camera access in your browser settings, then try again.');
  }
}

startBtn.addEventListener('click', startCamera);
switchBtn.addEventListener('click', () => { facing = facing === 'user' ? 'environment' : 'user'; startCamera(); });

/* ---------- Capture ---------- */
function snap() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 480;
  const ctx = c.getContext('2d');
  const vw = video.videoWidth, vh = video.videoHeight;
  const sw = Math.min(vw, vh * 4 / 3), sh = sw * 3 / 4;   // center-crop to 4:3
  const f = FILTERS[filterSel.value];

  if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  if (hasCtxFilter) ctx.filter = f.css;
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, c.width, c.height);

  if (!hasCtxFilter && f.px) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = f.px(d[i], d[i + 1], d[i + 2]);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;      // Uint8ClampedArray clamps for us
    }
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

function showCount(n) {
  countdownEl.textContent = n;
  countdownEl.classList.remove('pop');
  void countdownEl.offsetWidth;
  countdownEl.classList.add('pop');
}

function flash() {
  flashEl.classList.remove('go');
  void flashEl.offsetWidth;
  flashEl.classList.add('go');
}

function setBusy(b) {
  busy = b;
  takeBtn.disabled = b || !stream;
  switchBtn.disabled = b || !stream;
  retakeBtn.disabled = b;
}

async function run(indices) {
  if (busy || !stream) return;
  setBusy(true);
  for (const [k, i] of indices.entries()) {
    setStatus(indices.length > 1 ? `Photo ${k + 1} of ${indices.length}. Get ready!` : `Retaking photo ${i + 1}. Get ready!`);
    for (let n = +timerSel.value; n > 0; n--) { showCount(n); beep(660, .1); await sleep(1000); }
    countdownEl.textContent = '';
    flash(); beep(1100, .2, .25);
    shots[i] = snap();
    render();
    await sleep(900);
  }
  setBusy(false);
  setStatus('Nice! Download your strip, or tap a photo to retake it.');
}

const allSlots = () => [...Array(+countSel.value).keys()];

takeBtn.addEventListener('click', () => { shots = []; render(); run(allSlots()); });
retakeBtn.addEventListener('click', () => {
  if (!stream) { setStatus('Start the camera first.'); return; }
  shots = []; render(); run(allSlots());
});

strip.addEventListener('click', e => {
  if (busy) return;
  const r = strip.getBoundingClientRect();
  const x = (e.clientX - r.left) * strip.width / r.width;
  const y = (e.clientY - r.top) * strip.height / r.height;
  const i = slots.findIndex(s => x >= s.x && x <= s.x + PW && y >= s.y && y <= s.y + PH);
  if (i < 0) return;
  if (!stream) { setStatus('Start the camera, then tap a photo to retake it.'); return; }
  run([i]);
});

document.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); takeBtn.click(); }
});

/* ---------- Strip ---------- */
function render() {
  const n = +countSel.value, grid = layoutSel.value === 'grid';
  const cols = grid ? 2 : 1, rows = Math.ceil(n / cols);
  const text = caption.value.trim(), date = showDate.checked;
  const footTop = PAD + rows * (PH + PAD);
  const foot = (text ? 56 : 0) + (date ? 40 : 0);

  strip.width = PAD * (cols + 1) + PW * cols;
  strip.height = footTop + foot;
  strip.classList.toggle('wide', grid);

  const bg = stripColor.value, dark = isDark(bg);
  sctx.fillStyle = bg;
  sctx.fillRect(0, 0, strip.width, strip.height);
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';

  slots = [];
  for (let i = 0; i < n; i++) {
    const x = PAD + (i % cols) * (PW + PAD), y = PAD + Math.floor(i / cols) * (PH + PAD);
    slots.push({ x, y });
    if (shots[i]) { sctx.drawImage(shots[i], x, y, PW, PH); continue; }
    sctx.fillStyle = dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)';
    sctx.fillRect(x, y, PW, PH);
    sctx.fillStyle = dark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.4)';
    sctx.font = '64px "DM Mono", "Courier New", monospace';
    sctx.fillText(i + 1, x + PW / 2, y + PH / 2);
  }

  sctx.fillStyle = dark ? '#fff' : '#2a1810';
  if (text) {
    sctx.font = '36px Shrikhand, Georgia, serif';
    sctx.fillText(text, strip.width / 2, footTop + 18);
  }
  if (date) {
    sctx.font = '22px "DM Mono", "Courier New", monospace';
    const d = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    sctx.fillText(d, strip.width / 2, footTop + (text ? 56 : 0) + 14);
  }
}

countSel.addEventListener('change', () => { shots = shots.slice(0, +countSel.value); render(); });
[layoutSel, stripColor, caption, showDate].forEach(el => el.addEventListener('input', render));
filterSel.addEventListener('change', () => { video.style.filter = FILTERS[filterSel.value].css; });

/* ---------- Export ---------- */
const toBlob = () => new Promise(res => strip.toBlob(res, 'image/png'));
const hasPhotos = () => shots.some(Boolean);

downloadBtn.addEventListener('click', async () => {
  if (!hasPhotos()) { setStatus('Take some photos first.'); return; }
  const url = URL.createObjectURL(await toBlob());
  const a = document.createElement('a');
  a.href = url; a.download = `photobooth-${Date.now()}.png`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

shareBtn.addEventListener('click', async () => {
  if (!hasPhotos()) { setStatus('Take some photos first.'); return; }
  const file = new File([await toBlob()], 'photobooth.png', { type: 'image/png' });
  try { await navigator.share({ files: [file], title: "Luigi's Photobooth" }); } catch {}
});

try {
  const test = new File([''], 'a.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [test] })) shareBtn.hidden = false;
} catch {}

/* ---------- Page color ---------- */
function applyPageColor() {
  const root = document.documentElement.style;
  root.setProperty('--bg', bgColor.value);
  root.setProperty('--fg', isDark(bgColor.value) ? '#fff7e6' : '#2a1810');
}
bgColor.addEventListener('input', applyPageColor);

applyPageColor();
render();
