# GeoReel

**Cinematic 3D map flyover videos, generated from a JSON scene.**

[简体中文](./README.zh-CN.md) · English

Describe a place, a route, and a few camera moves in JSON. GeoReel flies a camera over real satellite terrain, draws glowing routes along the ground, pops in labels that never overlap, and renders an MP4 — the camera math, tile loading and label layout are handled for you. No After Effects, no Earth Studio, no manual keyframing.

It ships as an **agent skill**: hand the folder to a coding agent (Claude Code, etc.) and say *"make a flyover of Mount Hua marking the peaks and the climbing route"* — it authors the scene, previews it, and renders the video.

<p align="center">
  <img src="docs/huashan.jpg" width="49%" alt="Mount Hua flyover"/>
  <img src="docs/hexi-travel.jpg" width="49%" alt="Hexi Corridor travel shot"/>
  <br/>
  <img src="docs/taishan-night.jpg" width="49%" alt="Mount Tai night climb"/>
  <img src="docs/shanghai.jpg" width="49%" alt="Shanghai Lujiazui with Google 3D Tiles"/>
</p>

## What it does

| | |
| --- | --- |
| **Shot language** | State intent — `flyin`, `orbit`, `travel` — and the compiler solves camera position, heading and range. Travel shots glide along long routes (a 1000 km corridor, a mountain range) instead of retreating to space. |
| **Real 3D terrain** | Cesium World Terrain + Imagery via a free ion token; optional Google Photorealistic 3D Tiles for city buildings. |
| **Self-drawing overlays** | Routes and region outlines that unspool segment by segment; POI markers that pop in and never overlap (screen-space anti-collision + leader lines); geo-anchored titles. |
| **Night mode** | Dusk-dimmed map for night-route and sunrise-climb shots — the glowing route reads like a string of headlamps up a dark ridge. |
| **Transitions & audio** | Dip-to-white/black or true crossfade between shots; optional TTS narration and/or looped BGM. |
| **Built for iteration** | `--preview` renders 3 frames in ~1 min to check framing; `--workers N` renders in parallel, resumes on disk, self-heals on crash; 1080p / 4K presets. |

## Requirements

- **Node.js** ≥ 18 · **Google Chrome** (headless rendering) · **ffmpeg** on `PATH`
- **Cesium ion token** — free at <https://ion.cesium.com> → *Access Tokens*. Without one, GeoReel falls back to flat Esri imagery (no 3D relief).

## Install

Hand the repo URL to your coding agent (Claude Code, etc.):

> **Install the GeoReel skill from https://github.com/Vibetool/GeoReel**

It clones the repo into your skills directory (Claude Code: `~/.claude/skills/geo-flyover/`), runs `npm install` in `render/`, and reads [`SKILL.md`](./SKILL.md) for the workflow and schema. Then just describe the flyover you want — it authors the scene, previews it, and renders the MP4. Make sure the [requirements](#requirements) above are in place and set a free `CESIUM_ION_TOKEN`; roadmap in [`ROADMAP.md`](./ROADMAP.md).

## Quick start

Under the hood a render is two commands — the agent runs them for you, or run them yourself:

```bash
cd render

# Preview 3 frames (~1 min) — check coordinates & framing first
node render.mjs ../scenes/huashan.json /tmp/out --preview

# Full render → /tmp/out/huashan.mp4 (+ huashan-audio.mp4 if the scene has audio)
node render.mjs ../scenes/huashan.json /tmp/out --workers=2
```

Always `--preview` first — it catches a wrong coordinate or bad angle 6× faster than a full render.

## A scene in 20 lines

```jsonc
{
  "name": "huashan",
  "preset": "1080p", "fps": 30,
  "shots": [
    { "type": "flyin", "duration": 5, "pitch": -26, "viewFrom": 6, "targetHeight": 1700 },
    { "type": "orbit", "duration": 6, "sweep": 26 }
  ],
  "title": { "text": "华山", "lng": 110.086, "lat": 34.506, "appear": 0.34 },
  "pois": [
    { "name": "北峰", "lng": 110.0842, "lat": 34.4894, "appear": 0.44 },
    { "name": "南峰·落雁峰(最高)", "lng": 110.0876, "lat": 34.4772, "appear": 0.52 }
  ],
  "routes": [
    { "color": "#ffe94a", "width": 9, "tStart": 0.60, "tEnd": 0.95,
      "path": [[110.0836,34.5122],[110.0842,34.4894],[110.0876,34.4772]] }
  ]
}
```

Full field reference and every shot type live in [`SKILL.md`](./SKILL.md).

## Example scenes

| Scene | Shows off |
| --- | --- |
| `huashan.json` | flyin + orbit, 3D peaks, route draw-on, label anti-collision |
| `taishan-night.json` | night mode + narrated climb to the summit |
| `jinshanling-sunrise.json` | travel glide along the Great Wall at dawn + narration |
| `hexi-travel.json` | **travel** shot along the 1000 km Hexi Corridor |
| `shanghai-3dtiles.json` | Google Photorealistic 3D Tiles city buildings |

## Notes & attribution

- Cesium ion and Google 3D Tiles require **visible attribution** — the renderer keeps the Cesium credit on screen; don't crop it from published videos.
- The free Cesium ion tier and Google 3D Tiles are for non-commercial / evaluation use. Check the respective terms before commercial distribution.
- Satellite imagery copyright belongs to the data providers.

## License

MIT — see [LICENSE](./LICENSE).
