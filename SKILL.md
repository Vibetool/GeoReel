---
name: geo-flyover
description: Generate 3D satellite-map flyover videos ("三维地图看世界" style) — cinematic camera flight over real terrain with POI markers, glowing route/region overlays, and geo-anchored titles. Use when the user wants a 3D map animation / flyover video of a place, a travel-route showcase video, or asks to reproduce the 三维地图 genre. Input is a scene JSON (target, camera keyframes, POIs, routes); output is an MP4.
---

# geo-flyover — 三维地图飞行动效生成器

Renders a Cesium (CesiumJS) 3D globe scene frame-by-frame in headless Chrome, then assembles an MP4 with ffmpeg. No After Effects / Earth Studio needed.

## Requirements

- Node ≥ 18, Google Chrome installed, ffmpeg on PATH (all verified on this machine).
- `CESIUM_ION_TOKEN` env var (free account at https://ion.cesium.com → Access Tokens). With a token you get Cesium World Imagery + World Terrain (3D mountains). Without it, the renderer falls back to Esri World Imagery satellite tiles on a FLAT ellipsoid — watchable, but no 3D relief.
- First run: `cd render && npm install` (installs puppeteer-core only, tiny).

## Workflow

1. **Author a scene JSON** (see `scenes/putuoshan-demo.json` and schema below). Get coordinates via web search or your knowledge; verify POI lng/lat roughly on the imagery.
2. **Render**: `cd <skill-dir>/render && node render.mjs ../scenes/<scene>.json /path/to/outdir`
   - Writes `frames/f_0001.png...` then assembles `<outdir>/<name>.mp4` automatically.
   - ~1–3 fps render speed; a 10 s / 300-frame video takes a few minutes. Run in background and poll.
3. **Verify**: Read 2–3 sample frames as images (start/mid/end). Check: terrain loaded (not blank), labels legible, route reveal progressing.
4. Deliver the MP4 path to the user. For final videos suggest 1920x1080.

## Recommended: shots-based camera (auto-computed, use this instead of hand-writing cameraPath)

```jsonc
"preset": "1080p",   // 720p | 1080p | 4k — fonts/points/line widths auto-scale with resolution
"shots": [
  { "type": "flyin", "duration": 5, "pitch": -33, "viewFrom": 178 },  // viewFrom: compass bearing target→camera (178 = camera almost due south)
  { "type": "orbit", "duration": 6, "sweep": -14 },                    // arc the camera by sweep°, target stays centered
  { "type": "flyin", "duration": 4, "cut": true, "transition": "white", // hard cut masked by dip-to-white
    "target": "玉皇顶·山顶", "radius": 1200, "targetHeight": 1530,        // closeup on a named POI; targetHeight = its terrain elevation (m) — REQUIRED for mountain closeups or the peak leaves frame
    "pitch": -30, "viewFrom": 165, "distanceFactor": 4.5 },
  { "type": "orbit", "duration": 5, "sweep": 20 }                      // orbits the cut target
]
```
### travel shot — for long linear features (corridors, ranges, road trips)

```jsonc
{ "type": "travel",          // duration OMITTED → auto-paced by path length (recommended)
  "path": [[lng,lat],...],   // or omit to follow routes[0].path
  "offsetBearing": 32,       // compass bearing from each path point → camera (32 = camera to the NE)
  "offsetDist": 52000,       // lateral offset from the path, metres
  "alt": 16000,              // camera altitude, metres (LOW for relief — see below)
  "targetHeight": 3400,      // elevation the camera looks at
  "groundSpeed": 15000,      // metres of ground per second; duration = pathLength / groundSpeed
  "lookAhead": 0.05 }        // bias look-at forward along path (0..0.15 = travel feel)
  // duration: <n>           // optional hard override; samples auto ≈ duration/1.5 if omitted
```

**Auto-pacing (do NOT hard-code duration for travel):** omit `duration` and the shot times itself from the path length ÷ `groundSpeed` (default 15000 m/s, calibrated so ~1000 km plays in ~65 s). A 300 km leg and a 1500 km loop then both read at a comfortable, consistent speed. Slow it globally by lowering `groundSpeed` (e.g. 12000); speed up with a higher value. Keyframe count auto-scales too.
The camera holds a constant lateral offset + altitude and glides from one end of the path to the other, always looking at the moving path point (linear interpolation = constant-speed pan, no easing pump). This is the RIGHT tool for a ~1000 km corridor: a static shot must go to space to see it all, but a travel shot stays low and reveals it over time.

**Pacing & relief for travel shots** (learned tuning the Hexi Corridor):
- **Speed** = path length ÷ duration. A 1000 km corridor in 16 s is a blur; give it ~30 s+ so cities are readable. Ground speed over ~30 km/s reads as "too fast".
- **Relief (feeling the mountain-vs-plain height drop)** needs three things together: a LOW camera (`alt` ~12–18 km, not 40 km — high altitude flattens everything), a SHALLOW look angle (large `offsetDist` relative to `alt` → pitch ~-12..-16°, so peaks rise against the horizon instead of being looked down on), and scene-level `"verticalExaggeration": 2.0–2.5` (see below). Top-down + far = flat; low + shallow + exaggerated = dramatic.

## verticalExaggeration (scene-level) — make terrain relief pop

```jsonc
"verticalExaggeration": 2.3   // multiply all terrain heights; 1 = real, 2–2.5 = the 三维地图看世界 look
```
The single biggest lever for conveying elevation. Mountain ranges stand up as walls; canyon/gully relief becomes legible from a distance. POI/label/route anchors are height-adjusted to match, so nothing floats or sinks. Use it for any terrain-relief story (corridors, ranges, canyons); leave it at 1 for city (`buildings3d`) shots. Set each POI's `appear` to roughly when the camera passes it; POIs behind the camera naturally leave frame. Draw the route with `tStart`/`tEnd` spanning the shot so the line unspools as you fly.

The compiler centers flyin/orbit on the bounding box of all POIs/routes/regions (or the shot's `target`), computes slant range from spread (`distanceFactor`, default 3.8), derives heading from bearing math automatically, and warns if any in-segment POI drifts >28° off-axis (travel shots skip this check — they pan past POIs by design). Total duration = sum of shot durations. `cut: true` jumps the camera at the shot boundary under a dip-to-white/black transition (`transition`, `transitionDuration` default 0.8s). Hand-written `cameraPath` still works for full control.

## Night mode (夜爬 / night routes)

```jsonc
"nightMode": true,
"nightBrightness": 0.42   // 0.3–0.5; lower = darker map. Default 0.4
```
Dims the satellite imagery to dusk and darkens the sky, but leaves entities (glowing routes, POI dots, labels) at full brightness — so a route reads like a string of headlamps climbing a dark mountain. Pair with a warm route color (`#ffcf3f`) and `verticalExaggeration` for a night-climb hero shot. Imagery is daytime data tinted dark (not real night lighting), which keeps terrain shape readable.

## Label sizing

```jsonc
"labelScale": 3   // multiply POI (city/mountain) label + dot size; default 1. Big travel/overview shots want 2–3.
```
Scales the label font, outline, dot, and — crucially — the anti-collision stacking gaps and edge-alignment, so 3× labels still never overlap or clip off-screen. The title has its own fixed size (unaffected).

## Built-in behaviors (no config needed)

- **Label anti-collision**: every frame, labels are projected to screen space and de-overlapped — POI labels stack upward (gaps scale with font size), the big title moves out of the way (sticky offsets, no jitter). Labels near a frame edge auto-align inward (left/right origin) so big labels never clip off-screen. POI/title anchors are terrain-height-sampled so projection is accurate on mountains. When a label is pushed up, a white leader line connects it to its dot.
- **POI pop-in**: dots scale in with a back-ease bounce; labels fade/trail in over 0.6 s after their `appear` time.
- **Region draw-on**: regions animate like routes (`tStart`/`tEnd` outline draw; `appear` still works as tStart). Optional `"fill": true, "fillOpacity": 0.10` fades a terrain-draped tint after the outline completes.

## Transitions: dip vs crossfade

- `"transition": "white" | "black"` — dip-to-color overlay, single render pass (cheap, default).
- `"transition": "fade"` (+ optional `transitionDuration`, default 0.8 s) — TRUE crossfade: the timeline splits into segments rendered separately (the outgoing segment holds a frozen tail), then ffmpeg `xfade` chains them. Costs extra frames ≈ fps × transitionDuration per cut.

## Google Photorealistic 3D Tiles (cities)

```jsonc
"buildings3d": true,            // ion asset 2275207; requires CESIUM_ION_TOKEN; globe is hidden
"buildings3dQuality": 16        // maximumScreenSpaceError; lower = sharper = slower
```
For city hero shots go LOW and CLOSE: `pitch` -18..-25, `minSlant` 1200–2000 (overrides the 3000 m slant floor), `targetHeight` ≈ mid-tower (150–250 m). Note: Google tiles render slower per frame and consume ion quota; `--workers` defaults to 1 when buildings3d is on.

## Parallel rendering

`node render.mjs scene.json outdir --workers=2` — N Chrome instances render contiguous frame chunks concurrently (resume + self-heal per worker). Default 2 (1 with buildings3d). 3–4 workers only on beefy machines.

## Optional audio (TTS narration / BGM)

```jsonc
"audio": {                                       // omit entirely for a silent video
  "tts": { "text": "泰山，五岳之首……",              // narration
           "voice": "zh-CN-YunxiNeural",          // edge-tts voice (if edge-tts installed)
           "sayVoice": "Tingting" },              // macOS `say` fallback voice
  "bgm": { "file": "/path/to/music.mp3", "volume": 0.22 }   // looped + trimmed to video length
}
```
Engine picks edge-tts if installed, else macOS `say` (Tingting), else skips with a warning. Output is written alongside as `<name>-audio.mp4`; the silent `<name>.mp4` is always kept. Audio failures never fail the render.

## Always preview before a full render

```
node render.mjs <scene>.json <outdir> --preview
```
~1 min: renders 3 frames (t=0.35/0.65/0.95) with ALL POIs/routes force-shown. Check POI placement, framing, label collisions — then run the full render. This catches coordinate mistakes 6× faster than a full render.

## Scene JSON schema

```jsonc
{
  "name": "putuoshan",           // output file stem
  "width": 1280, "height": 720, "fps": 30, "duration": 10,  // seconds
  "cameraPath": [                 // keyframes, t in [0,1] of duration, eased cubic in between
    { "t": 0.0, "lng": 122.387, "lat": 29.85, "alt": 60000, "heading": 0, "pitch": -90 },
    { "t": 0.4, "lng": 122.387, "lat": 29.95, "alt": 6000,  "heading": 10, "pitch": -35 },
    { "t": 1.0, "lng": 122.40,  "lat": 29.96, "alt": 4500,  "heading": 80, "pitch": -30 }
  ],
  "pois": [                       // green dot + white label, appear with fade at t=appear
    { "name": "普济禅寺", "lng": 122.3875, "lat": 29.9887, "appear": 0.45 }
  ],
  "title": { "text": "普陀山", "lng": 122.387, "lat": 30.001, "appear": 0.35 },
  "routes": [                     // glowing polyline, draw-on animation between tStart..tEnd
    { "color": "#ffe94a", "width": 8, "tStart": 0.55, "tEnd": 0.95,
      "path": [[122.3963,29.9770],[122.3960,29.9805],[122.3875,29.9887]] }
  ],
  "regions": [                    // optional glowing polygon outline (region highlight)
    { "color": "#ffe94a", "width": 6, "appear": 0.5, "polygon": [[lng,lat],...] }
  ]
}
```

## Files

- `render/flyover.html` — Cesium scene; exposes `window.__setup(cfg)` / `window.__frame(t)` for deterministic stepping.
- `render/render.mjs` — puppeteer-core driver: steps frames, waits for tile loads, screenshots, runs ffmpeg.
- `scenes/putuoshan-demo.json` — working example.
- `TODO.md` — iteration backlog (multi-shot, region draw-on, TTS, 1080p presets…).

## Tips

- Camera fly-ins read best: top-down high shot → tilt to ~-30..-40° pitch at 3–8 km alt.
- **Composition check (do the math!)**: at every keyframe, heading must point from camera position toward the target — bearing ≈ atan2(Δlng·cos(lat), Δlat) in degrees from north. Keep the camera on one side (e.g. south of target, heading ≈ 0±25°) and arc gently; a heading that drifts away leaves the subject (and your route animation) off-frame. Always verify start/mid/end frames visually before delivering.
- Keep per-shot heading change < 120° or motion looks swimmy.
- POI `appear` slightly after the camera settles; title after the fly-in.
- If frames show blank/black ocean tiles, increase `TILE_TIMEOUT_MS` env or slow the camera.
- **No "map refreshing" flicker**: every frame waits until tiles are loaded AND have *stayed* loaded for `SETTLE_MS` (default 500 ms) before capture — so you never grab a still-streaming frame that resolves sharper on the next one. For heavy scenes (low-altitude travel, high `verticalExaggeration`, 4K) render with `TILE_TIMEOUT_MS=60000 SETTLE_MS=500` so tiles have room to fully settle. Raising `SETTLE_MS` (e.g. 800) trades render time for rock-steady frames.
- **Pace for readability**: ground speed = path length ÷ duration. If cities/terrain blur past, double the `duration`. A 1000 km corridor wants ~60 s to actually read the places.
- Attribution: Cesium ion imagery requires visible attribution — the renderer keeps the Cesium credit container visible; do not crop it out for published videos.
