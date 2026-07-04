# GeoReel

**Cinematic 3D map flyover videos, generated from a JSON scene.**

[简体中文](./README.zh-CN.md) · English

GeoReel turns a small scene description into a "三维地图看世界"-style flyover video: a camera flies over real satellite terrain, glowing routes draw themselves along the ground, city/landmark labels pop in and never overlap, and an optional narration track plays over the top. No After Effects, no Google Earth Studio, no manual keyframing — you describe *what* to show and GeoReel works out the camera math.

It ships as an **agent skill**: hand the folder to a coding agent (Claude Code, etc.) and say *"make a flyover of Mount Hua marking the peaks and the climbing route"* — the agent authors the scene, previews it, and renders the MP4.

<p align="center">
  <img src="docs/huashan.jpg" width="49%" alt="Mount Hua flyover"/>
  <img src="docs/hexi-travel.jpg" width="49%" alt="Hexi Corridor travel shot"/>
  <br/>
  <img src="docs/shanghai.jpg" width="49%" alt="Shanghai Lujiazui with Google 3D Tiles"/>
</p>

## What it can do

| Capability | Description |
| --- | --- |
| **Shot language** | Describe intent (`flyin`, `orbit`, `travel`) — the compiler solves camera position, heading and slant range from the geometry. No hand-written keyframes. |
| **Real 3D terrain** | Cesium World Terrain + World Imagery via a (free) Cesium ion token — actual mountain relief. |
| **Travel shots** | For long linear routes (a 1000 km corridor, a mountain range): the camera glides along the path at constant speed, revealing it over time instead of retreating to space. |
| **POIs** | Green markers + labels that **pop in** with a bounce and **never overlap** (screen-space anti-collision + leader lines), terrain-height-aware. |
| **Routes** | Glowing polylines that **draw themselves** segment by segment as the camera moves. |
| **Regions** | Glowing area outlines that draw on, with an optional terrain-draped fill. |
| **Transitions** | Dip-to-white/black, or true crossfade (`xfade`) between shots. |
| **Google 3D Tiles** | Photorealistic city buildings (`buildings3d`) for urban hero shots. |
| **Titles** | Big geo-anchored titles that ride the terrain. |
| **Audio** | Optional TTS narration (edge-tts → macOS `say`) and/or looped BGM. Omit for a silent video. |
| **Preview mode** | Render 3 verification frames in ~1 min to check framing before committing to a full render. |
| **Parallel + resilient** | `--workers N` renders frame chunks concurrently; resumes on disk, self-heals on browser crash. |
| **1080p / 4K presets** | UI elements scale proportionally so composition is identical, just sharper. |

## Requirements

- **Node.js** ≥ 18
- **Google Chrome** (used headless for rendering)
- **ffmpeg** on your `PATH`
- **Cesium ion access token** — free at <https://ion.cesium.com> → *Access Tokens*. Without one, GeoReel falls back to flat Esri satellite imagery (no 3D relief).

## Install

```bash
git clone https://github.com/Vibetool/GeoReel.git
cd GeoReel/render
npm install
export CESIUM_ION_TOKEN="your-ion-token"
```

## Quick start

```bash
cd render

# 1. Preview: 3 frames (~1 min) to check coordinates & framing
node render.mjs ../scenes/huashan.json /tmp/out --preview

# 2. Full render (writes /tmp/out/huashan.mp4, + huashan-audio.mp4 if the scene has audio)
node render.mjs ../scenes/huashan.json /tmp/out --workers=2
```

Always `--preview` first — it catches a wrong coordinate or a bad camera angle 6× faster than a full render.

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

Full field reference and all shot types are documented in [`SKILL.md`](./SKILL.md).

## Included example scenes

| Scene | Shows off |
| --- | --- |
| `huashan.json` | flyin + orbit, 3D peaks, route draw-on, label anti-collision |
| `taishan-crossfade.json` | multi-shot with a true crossfade, region draw-on, TTS |
| `hexi-travel.json` | **travel** shot along the 1000 km Hexi Corridor |
| `shanghai-3dtiles.json` | Google Photorealistic 3D Tiles city buildings |
| `putuoshan-demo.json` | the original minimal demo |

## Using it as an agent skill

Drop the folder into your agent's skills directory (for Claude Code: `~/.claude/skills/geo-flyover/` or a project `.claude/skills/`). The agent reads [`SKILL.md`](./SKILL.md) for the workflow and schema, then authors + previews + renders scenes on request. See [`ROADMAP.md`](./ROADMAP.md) for what's built and what's next.

## Notes & attribution

- Cesium ion imagery/terrain and Google Photorealistic 3D Tiles require **visible attribution** — the renderer keeps the Cesium credit on screen. Do not crop it out of published videos.
- The **free** Cesium ion tier and Google 3D Tiles are for non-commercial / evaluation use. For commercial distribution, check the Cesium ion and Google Maps Platform terms.
- Satellite imagery copyright belongs to the data providers.

## License

MIT — see [LICENSE](./LICENSE).
