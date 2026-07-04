#!/usr/bin/env node
// geo-flyover renderer: headless-Chrome frame stepping + ffmpeg assembly.
// Usage: node render.mjs <scene.json> <outdir> [--preview] [--workers=N]
// Env: CESIUM_ION_TOKEN (recommended), CHROME_PATH, TILE_TIMEOUT_MS
import { readFileSync, mkdirSync, existsSync, createReadStream, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { cpus } from 'node:os';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const PREVIEW = args.includes('--preview');
const workersArg = args.find(a => a.startsWith('--workers'));
const [scenePath, outdirArg] = args.filter(a => !a.startsWith('--'));
if (!scenePath || !outdirArg) {
  console.error('usage: node render.mjs <scene.json> <outdir> [--preview] [--workers=N]'); process.exit(1);
}
const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
const outdir = resolve(outdirArg);
mkdirSync(outdir, { recursive: true });

// resolution presets: proportional UI scaling happens page-side (height/720)
const PRESETS = { '720p': [1280, 720], '1080p': [1920, 1080], '4k': [3840, 2160] };
if (scene.preset) {
  const p = PRESETS[scene.preset];
  if (!p) { console.error(`unknown preset "${scene.preset}" (720p|1080p|4k)`); process.exit(1); }
  scene.width = p[0]; scene.height = p[1];
}

// ---------- shots → cameraPath compiler (auto heading/bearing math) ----------
const R_EARTH_M_PER_DEG = 111320;
const toRad = d => d * Math.PI / 180;
function bearingDeg(from, to) {
  const dLng = (to[0] - from[0]) * Math.cos(toRad((from[1] + to[1]) / 2));
  const dLat = to[1] - from[1];
  return (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
}
function offsetPt(pt, bearing, meters) {
  const dLat = meters * Math.cos(toRad(bearing)) / R_EARTH_M_PER_DEG;
  const dLng = meters * Math.sin(toRad(bearing)) / (R_EARTH_M_PER_DEG * Math.cos(toRad(pt[1])));
  return [pt[0] + dLng, pt[1] + dLat];
}
function distM(a, b) {
  const dx = (a[0] - b[0]) * R_EARTH_M_PER_DEG * Math.cos(toRad((a[1] + b[1]) / 2));
  const dy = (a[1] - b[1]) * R_EARTH_M_PER_DEG;
  return Math.hypot(dx, dy);
}

// segments: contiguous camera timelines; a `transition:"fade"` cut closes one and opens the next.
// Each segment renders separately (incl. a frozen tail overlapping the next segment's head),
// then ffmpeg xfade chains them. Dip-to-color cuts stay inside one segment (overlay handles them).
let SEGMENTS = null;   // [{ kfs, startSec, endSec, tailSec }]

function compileShots(scene) {
  if (!scene.shots?.length) return;
  const allPts = [
    ...(scene.pois || []).map(p => [p.lng, p.lat]),
    ...(scene.routes || []).flatMap(r => r.path),
    ...(scene.regions || []).flatMap(g => g.polygon),
  ];
  if (scene.target) allPts.push([scene.target.lng, scene.target.lat]);
  if (!allPts.length) { console.error('shots need pois/routes/regions or target'); process.exit(1); }
  const allCentroid = [allPts.reduce((s,p)=>s+p[0],0)/allPts.length,
                       allPts.reduce((s,p)=>s+p[1],0)/allPts.length];
  const allR = Math.max(1500, ...allPts.map(p => distM(allCentroid, p)));

  function resolveTarget(tgt) {
    if (Array.isArray(tgt)) return tgt;
    const poi = (scene.pois || []).find(p => p.name === tgt || p.name.includes(tgt));
    if (!poi) { console.error(`shot target "${tgt}" not found among pois`); process.exit(1); }
    return [poi.lng, poi.lat];
  }

  const total = scene.shots.reduce((s, sh) => s + (sh.duration ?? 5), 0);
  const kfs = [];               // flat list for classic/dip path + composition checks
  const transitions = [];       // dip overlays
  const segs = [{ kfs: [], startSec: 0, tailSec: 0 }];
  let tSec = 0;
  let cen = allCentroid, R = allR, V = null, S = null, pitch = null, Hgt = 0;
  const pushKf = k => { kfs.push(k); segs[segs.length-1].kfs.push(k); };

  for (const sh of scene.shots) {
    const dur = sh.duration ?? 5;
    if (sh.type === 'flyin') {
      pitch = sh.pitch ?? -33;
      V = sh.viewFrom ?? (V ?? 180);
      if (sh.target) { cen = resolveTarget(sh.target); R = sh.radius ?? 1500; }
      else if (tSec === 0) { cen = allCentroid; R = allR; }
      Hgt = sh.targetHeight ?? Hgt;
      S = Math.max(sh.minSlant ?? 3000, (sh.distanceFactor ?? 3.8) * R);
      const D = S * Math.cos(toRad(-pitch)), A = S * Math.sin(toRad(-pitch)) + Hgt;
      const ground = offsetPt(cen, V, D);
      if (sh.cut && tSec > 0) {
        const trDur = sh.transitionDuration ?? 0.8;
        const g0 = offsetPt(cen, V, D * 1.12);
        const startKf = { t: tSec / total, lng: g0[0], lat: g0[1],
          alt: (A - Hgt) * 1.12 + Hgt, heading: (V + 180) % 360, pitch, seg: sh };
        if (sh.transition === 'fade') {
          // crossfade: close current segment (tail = trDur), open a new one
          segs[segs.length-1].endSec = tSec;
          segs[segs.length-1].tailSec = trDur;
          segs.push({ kfs: [], startSec: tSec, tailSec: 0 });
        } else {
          transitions.push({ t: tSec / total, dur: trDur / total,
            color: sh.transition === 'black' ? '#000000' : '#ffffff' });
        }
        pushKf(startKf);
      } else if (tSec === 0) {
        const mid = [(cen[0]+ground[0])/2, (cen[1]+ground[1])/2];
        pushKf({ t: 0, lng: mid[0], lat: mid[1],
          alt: Math.min(70000, S * 6), heading: (V + 180) % 360, pitch: -89, seg: sh });
      }
      pushKf({ t: (tSec + dur) / total, lng: ground[0], lat: ground[1],
        alt: A, heading: (V + 180) % 360, pitch, seg: sh });
    } else if (sh.type === 'orbit') {
      if (V === null) { console.error('orbit must follow a flyin'); process.exit(1); }
      pitch = sh.pitch ?? pitch;
      const sweep = sh.sweep ?? 25;
      const endS = S * (sh.approach ?? 0.92);
      const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 20));
      for (let j = 1; j <= steps; j++) {
        const Vj = V + sweep * j / steps;
        const Sj = S + (endS - S) * j / steps;
        const D = Sj * Math.cos(toRad(-pitch)), A = Sj * Math.sin(toRad(-pitch)) + Hgt;
        const ground = offsetPt(cen, Vj, D);
        pushKf({ t: (tSec + dur * j / steps) / total, lng: ground[0], lat: ground[1],
          alt: A, heading: (Vj + 180) % 360, pitch, seg: sh });
      }
      V = V + sweep; S = endS;
    } else if (sh.type === 'travel') {
      // dolly along a path (the corridor): camera holds a constant lateral offset + altitude
      // and glides from one end to the other, always looking at the moving path point.
      // Ideal for long linear features (routes, mountain ranges) — trades time for coverage.
      const path = sh.path || scene.routes?.[0]?.path;
      if (!path || path.length < 2) { console.error('travel needs a path (or a route to follow)'); process.exit(1); }
      const offB = sh.offsetBearing ?? 0;        // compass bearing from path point → camera
      const offD = sh.offsetDist ?? 60000;       // lateral offset, m
      const alt  = sh.alt ?? 30000;              // camera altitude, m
      Hgt = sh.targetHeight ?? Hgt;
      const nS = sh.samples ?? 12;
      const ahead = sh.lookAhead ?? 0;           // bias look-at forward along path (0..0.15 feels like travel)
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i-1] + distM(path[i-1], path[i]));
      const totalLen = cum[cum.length-1] || 1;
      const sampleAt = frac => {
        const tgt = totalLen * Math.max(0, Math.min(1, frac));
        for (let i = 1; i < path.length; i++) if (cum[i] >= tgt) {
          const u = (tgt - cum[i-1]) / ((cum[i]-cum[i-1]) || 1);
          return [ path[i-1][0] + (path[i][0]-path[i-1][0])*u,
                   path[i-1][1] + (path[i][1]-path[i-1][1])*u ];
        }
        return path[path.length-1];
      };
      for (let j = 0; j <= nS; j++) {
        const fr = sh.reverse ? 1 - j/nS : j/nS;
        const P = sampleAt(fr);
        const look = ahead ? sampleAt(fr + (sh.reverse ? -ahead : ahead)) : P;
        const cam = offsetPt(P, offB, offD);
        const horiz = distM(cam, look);
        const kfPitch = -Math.atan2(alt - Hgt, horiz) * 180 / Math.PI;
        pushKf({ t: (tSec + dur * j / nS) / total, lng: cam[0], lat: cam[1],
          alt, heading: bearingDeg(cam, look), pitch: kfPitch, lin: true, seg: sh });
      }
      cen = sampleAt(sh.reverse ? 0 : 1); R = allR;
      V = offB; S = Math.hypot(offD, alt - Hgt);
      pitch = -Math.atan2(alt - Hgt, offD) * 180 / Math.PI;
    } else { console.error(`unknown shot type: ${sh.type}`); process.exit(1); }
    sh._cen = cen; sh._R = R;
    tSec += dur;
  }
  segs[segs.length-1].endSec = tSec;
  scene.duration = total;
  scene.cameraPath = kfs.map(({seg, ...k}) => k);
  scene.transitions = transitions;
  if (segs.length > 1) SEGMENTS = segs.map(s => ({ ...s, kfs: s.kfs.map(({seg, ...k}) => k) }));
  console.log(`shots compiled: ${scene.shots.length} shots -> ${kfs.length} keyframes, ${total}s, ` +
    `${transitions.length} dip(s), ${segs.length > 1 ? segs.length + ' xfade segments' : 'single segment'}`);
  for (const k of kfs) console.log(`  t=${k.t.toFixed(2)} cam=(${k.lng.toFixed(4)},${k.lat.toFixed(4)}) alt=${Math.round(k.alt)} hdg=${Math.round(k.heading)} pitch=${k.pitch}`);
  for (const k of kfs) {
    if (k.pitch <= -80 || k.seg.type === 'travel') continue;   // travel pans past POIs by design
    const cenK = k.seg._cen, rK = k.seg._R;
    for (const p of (scene.pois || [])) {
      if (distM(cenK, [p.lng, p.lat]) > rK * 2.5) continue;
      let diff = Math.abs(((bearingDeg([k.lng,k.lat],[p.lng,p.lat]) - k.heading) + 540) % 360 - 180);
      if (diff > 28) console.warn(`⚠ composition: POI "${p.name}" ${Math.round(diff)}° off-axis at t=${k.t.toFixed(2)} — may be out of frame`);
    }
  }
}
compileShots(scene);
// ------------------------------------------------------------------------------

const W = scene.width ?? 1280, H = scene.height ?? 720;
const FPS = scene.fps ?? 30, DUR = scene.duration ?? 10;
const token = process.env.CESIUM_ION_TOKEN || '';
const tileTimeout = process.env.TILE_TIMEOUT_MS || '12000';
const WORKERS = workersArg ? Math.max(1, parseInt(workersArg.split('=')[1] || '2'))
  : (scene.buildings3d ? 1 : Math.min(2, Math.max(1, Math.floor(cpus().length / 4))));

const chromePath = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chromePath)) {
  console.error(`Chrome not found at ${chromePath}; set CHROME_PATH`); process.exit(1);
}

const rendererDir = dirname(fileURLToPath(import.meta.url));
const cesiumDir = join(rendererDir, 'node_modules', 'cesium', 'Build', 'Cesium');
if (!existsSync(join(cesiumDir, 'Cesium.js'))) {
  console.error(`Cesium build not found at ${cesiumDir} — run: npm install`); process.exit(1);
}
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif',
  '.wasm':'application/wasm', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.xml':'text/xml' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (path === '/' || path === '/flyover.html') file = join(rendererDir, 'flyover.html');
  else if (path.startsWith('/cesium/')) {
    file = join(cesiumDir, normalize(path.slice(8)).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(cesiumDir)) { res.writeHead(403); res.end(); return; }
  } else { res.writeHead(404); res.end(); return; }
  try {
    statSync(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const htmlUrl = new URL(`http://127.0.0.1:${port}/flyover.html`);
htmlUrl.search = `?tileTimeout=${tileTimeout}`;

console.log(`scene=${scene.name}  ${W}x${H}@${FPS}fps  ${DUR}s  workers=${WORKERS}`);
console.log(`imagery: ${token ? 'Cesium ion (World Imagery + 3D Terrain)' : 'Esri World Imagery fallback, FLAT terrain (set CESIUM_ION_TOKEN for 3D)'}${scene.buildings3d ? ' + Google Photorealistic 3D Tiles' : ''}`);

const CHROME_ARGS = ['--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage',
  `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio'];

async function launch() {
  const browser = await puppeteer.launch({
    executablePath: chromePath, headless: 'shell', args: CHROME_ARGS,
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    protocolTimeout: 180000,
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
  page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.goto(htmlUrl.href, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('typeof window.__setup === "function"', { timeout: 30000 });
  await page.evaluate((cfg, tok) => window.__setup(cfg, tok || null), scene, token);
  return { browser, page };
}

if (PREVIEW) {
  console.log('PREVIEW mode: 3 verification frames (all POIs/routes force-shown), no video');
  const { browser, page } = await launch();
  try {
    await page.evaluate(() => { window.__showAll = true; });
    for (const t of [0.35, 0.65, 0.95]) {
      await page.evaluate(tt => window.__frame(tt), t);
      const p = join(outdir, `preview_t${String(t).replace('.','')}.png`);
      await page.screenshot({ path: p });
      console.log('preview:', p);
    }
  } finally {
    try { await browser.close(); } catch {}
    server.close();
  }
  process.exit(0);
}

// ---------- work list: [{seg, segIdx, local, t, path}] ----------
// single segment (classic): frames/ dir; multi-segment (xfade): seg0/,seg1/,...
const work = [];
const segMeta = [];
if (!SEGMENTS) {
  const N = Math.round(FPS * DUR);
  const dir = join(outdir, 'frames');
  mkdirSync(dir, { recursive: true });
  segMeta.push({ dir, count: N });
  for (let i = 0; i < N; i++)
    work.push({ segIdx: 0, kfs: scene.cameraPath, local: i,
      t: N === 1 ? 0 : i / (N - 1), path: join(dir, `f_${String(i+1).padStart(4,'0')}.png`) });
} else {
  SEGMENTS.forEach((sg, si) => {
    const dir = join(outdir, `seg${si}`);
    mkdirSync(dir, { recursive: true });
    const len = (sg.endSec - sg.startSec) + sg.tailSec;
    const n = Math.round(FPS * len);
    segMeta.push({ dir, count: n, lenSec: len, tailSec: sg.tailSec, durSec: sg.endSec - sg.startSec });
    for (let i = 0; i < n; i++) {
      const tSec = sg.startSec + i / FPS;
      work.push({ segIdx: si, kfs: sg.kfs, local: i,
        t: Math.min(1, tSec / DUR), path: join(dir, `f_${String(i+1).padStart(4,'0')}.png`) });
    }
  });
}

const pending = work.filter(w => !existsSync(w.path));
if (work.length - pending.length > 0)
  console.log(`resume: ${work.length - pending.length}/${work.length} frames already on disk`);
console.log(`rendering ${pending.length} frames with ${WORKERS} worker(s)...`);

let doneCount = 0;
const t0 = Date.now();
async function runWorker(items, wid) {
  if (!items.length) return;
  let { browser, page } = await launch();
  let curSeg = -1;
  try {
    for (const it of items) {
      let attempt = 0;
      while (true) {
        try {
          if (it.segIdx !== curSeg) {
            await page.evaluate(k => window.__setCameraPath(k), it.kfs);
            curSeg = it.segIdx;
          }
          await page.evaluate(tt => window.__frame(tt), it.t);
          await page.screenshot({ path: it.path });
          break;
        } catch (e) {
          if (++attempt > 3) throw e;
          console.error(`[w${wid}] frame crashed (${String(e).split('\n')[0]}); relaunching (attempt ${attempt})`);
          try { await browser.close(); } catch {}
          ({ browser, page } = await launch());
          curSeg = -1;
        }
      }
      doneCount++;
      if (doneCount % 30 === 0 || doneCount === pending.length) {
        const rate = doneCount / ((Date.now()-t0)/1000);
        console.log(`frames ${doneCount}/${pending.length}  (${rate.toFixed(1)} fps, eta ${((pending.length-doneCount)/Math.max(rate,0.1)).toFixed(0)}s)`);
      }
    }
  } finally {
    try { await browser.close(); } catch {}
  }
}
// contiguous chunks keep tile-cache locality along the camera path
const chunkSize = Math.ceil(pending.length / WORKERS);
const chunks = [];
for (let i = 0; i < pending.length; i += chunkSize) chunks.push(pending.slice(i, i + chunkSize));
try {
  await Promise.all(chunks.map((c, i) => runWorker(c, i)));
} finally {
  server.close();
}

for (const w of work) if (!existsSync(w.path)) {
  console.error(`missing frame ${w.path} — aborting assembly`); process.exit(1);
}

// ---------- assembly ----------
const mp4 = join(outdir, `${scene.name || 'flyover'}.mp4`);
const X264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-movflags', '+faststart'];
if (!SEGMENTS) {
  console.log('assembling', mp4);
  execFileSync('ffmpeg', ['-y', '-framerate', String(FPS),
    '-i', join(segMeta[0].dir, 'f_%04d.png'), ...X264, mp4], { stdio: 'inherit' });
} else {
  console.log(`assembling ${segMeta.length} segments + xfade chain -> ${mp4}`);
  const segVids = segMeta.map((m, i) => {
    const v = join(outdir, `seg${i}.mp4`);
    execFileSync('ffmpeg', ['-y', '-framerate', String(FPS),
      '-i', join(m.dir, 'f_%04d.png'), ...X264, v], { stdio: 'pipe' });
    return v;
  });
  // chain: out_k = xfade(out_{k-1}, seg_k, duration=tail_{k-1}, offset=len(out_{k-1})-tail_{k-1})
  const inputs = segVids.flatMap(v => ['-i', v]);
  let filter = '', prevLabel = '0:v', outLen = segMeta[0].lenSec;
  for (let k = 1; k < segMeta.length; k++) {
    const d = segMeta[k-1].tailSec;
    const off = (outLen - d).toFixed(3);
    const lbl = k === segMeta.length - 1 ? 'vout' : `x${k}`;
    filter += `[${prevLabel}][${k}:v]xfade=transition=fade:duration=${d}:offset=${off}[${lbl}];`;
    outLen = outLen - d + segMeta[k].lenSec;
    prevLabel = lbl;
  }
  execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', filter.slice(0, -1),
    '-map', '[vout]', ...X264, mp4], { stdio: 'inherit' });
}
console.log('video DONE:', mp4);

// ---------- optional audio: TTS (edge-tts → macOS say fallback) + BGM mix ----------
async function addAudio() {
  const au = scene.audio;
  if (!au || (!au.tts && !au.bgm)) return;
  let ttsFile = null, bgmFile = null;
  try {
    if (au.tts?.text) {
      let engine = null;
      try { execFileSync('edge-tts', ['--version'], { stdio: 'pipe' }); engine = 'edge'; } catch {}
      if (!engine) {
        try {
          const voices = execFileSync('say', ['-v', '?'], { stdio: 'pipe' }).toString();
          if (/ting.?ting/i.test(voices)) engine = 'say';
        } catch {}
      }
      if (engine === 'edge') {
        ttsFile = join(outdir, 'tts.mp3');
        execFileSync('edge-tts', ['--voice', au.tts.voice || 'zh-CN-YunxiNeural',
          '--text', au.tts.text, '--write-media', ttsFile], { stdio: 'pipe' });
      } else if (engine === 'say') {
        const aiff = join(outdir, 'tts.aiff');
        execFileSync('say', ['-v', au.tts.sayVoice || 'Tingting', '-o', aiff, au.tts.text], { stdio: 'pipe' });
        ttsFile = join(outdir, 'tts.m4a');
        execFileSync('ffmpeg', ['-y', '-i', aiff, '-c:a', 'aac', ttsFile], { stdio: 'pipe' });
      } else console.warn('audio.tts: no TTS engine found (install edge-tts, or need macOS say w/ Tingting) — skipped');
    }
    if (au.bgm?.file) {
      if (existsSync(au.bgm.file)) bgmFile = au.bgm.file;
      else console.warn(`audio.bgm: file not found: ${au.bgm.file} — skipped`);
    }
    if (!ttsFile && !bgmFile) return;
    const out = mp4.replace(/\.mp4$/, '-audio.mp4');
    const vol = au.bgm?.volume ?? 0.22;
    let cmd;
    if (ttsFile && bgmFile) {
      cmd = ['-y', '-i', mp4, '-i', ttsFile, '-stream_loop', '-1', '-i', bgmFile,
        '-filter_complex', `[1:a]apad[t];[2:a]volume=${vol}[b];[t][b]amix=inputs=2:duration=first[a]`,
        '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out];
    } else if (ttsFile) {
      cmd = ['-y', '-i', mp4, '-i', ttsFile, '-af', 'apad',
        '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out];
    } else {
      cmd = ['-y', '-i', mp4, '-stream_loop', '-1', '-i', bgmFile,
        '-filter_complex', `[1:a]volume=${vol}[a]`,
        '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out];
    }
    execFileSync('ffmpeg', cmd, { stdio: 'pipe' });
    console.log('audio DONE:', out);
  } catch (e) {
    console.warn('audio step failed (video is fine):', String(e).split('\n')[0]);
  }
}
await addAudio();
console.log('DONE:', mp4);
