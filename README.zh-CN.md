# GeoReel

**用一份 JSON 场景，生成电影感的三维地图飞行视频。**

[English](./README.md) · 简体中文

GeoReel 把一份简短的场景描述，变成"三维地图看世界"风格的飞行视频：相机掠过真实卫星地形，发光路线沿地面逐段画出，城市/地标标签弹入且永不重叠，还能配上旁白。不需要 After Effects，不需要 Google Earth Studio，不需要手 K 关键帧——你只描述"要展示什么"，相机数学交给 GeoReel。

它以 **Agent Skill** 形式发布：把这个文件夹交给编码智能体（Claude Code 等），说一句"给华山做个飞行视频，标出各峰和登山线路"，智能体就会自动写场景、预览、渲染出 MP4。

<p align="center">
  <img src="docs/huashan.jpg" width="49%" alt="华山飞行"/>
  <img src="docs/hexi-travel.jpg" width="49%" alt="河西走廊平移镜头"/>
  <br/>
  <img src="docs/shanghai.jpg" width="49%" alt="上海陆家嘴 Google 3D Tiles"/>
</p>

## 能力一览

| 能力 | 说明 |
| --- | --- |
| **镜头语言** | 只描述意图（`flyin` 推近 / `orbit` 环绕 / `travel` 平移），编译器自动解算相机位置、朝向、距离，无需手写关键帧 |
| **真实三维地形** | 通过（免费的）Cesium ion token 加载 World Terrain + World Imagery，真实山体起伏 |
| **平移镜头** | 针对超长线状路线（千公里走廊、山脉）：相机沿路径匀速滑行，用时间换空间，不必退到太空才能看全 |
| **POI 打点** | 绿点+标签，弹入动画 + 屏幕空间防碰撞（永不重叠）+ 引线，且贴合地形高度 |
| **路线描画** | 发光折线随相机推进逐段画出 |
| **区域高亮** | 发光边框逐段描画，可选地形贴合填充 |
| **转场** | 白闪/黑场，或真正的交叉溶解（xfade） |
| **立体建筑** | Google 实景三维（`buildings3d`），城市题材摩天楼立体化 |
| **锚定标题** | 贴合地形的大标题 |
| **音频** | 可选 TTS 旁白（edge-tts → macOS `say`）与循环 BGM；不配则为无声视频 |
| **预览模式** | ~1 分钟出 3 张校对帧，确认构图后再全渲 |
| **并行 + 容错** | `--workers N` 并行分段渲染；断点续传、崩溃自愈 |
| **1080p / 4K 预设** | UI 元素等比缩放，构图一致、更清晰 |

## 环境要求

- **Node.js** ≥ 18
- **Google Chrome**（无头渲染用）
- **ffmpeg**（在 `PATH` 中）
- **Cesium ion token** —— 在 <https://ion.cesium.com> 免费注册后于 *Access Tokens* 获取。不填则回退到 Esri 平面卫星影像（无立体地形）。

## 安装

```bash
git clone https://github.com/Vibetool/GeoReel.git
cd GeoReel/render
npm install
export CESIUM_ION_TOKEN="你的-ion-token"
```

## 快速上手

```bash
cd render

# 1. 预览：3 帧校对（约 1 分钟），确认坐标与构图
node render.mjs ../scenes/huashan.json /tmp/out --preview

# 2. 全渲（输出 /tmp/out/huashan.mp4，若场景含 audio 则另出 huashan-audio.mp4）
node render.mjs ../scenes/huashan.json /tmp/out --workers=2
```

**务必先 `--preview`**——它比全渲快 6 倍地发现坐标写错或机位不佳。

## 内置示例场景

| 场景 | 演示 |
| --- | --- |
| `huashan.json` | 推近+环绕、立体峰、路线描画、标签防碰撞 |
| `taishan-crossfade.json` | 多镜头 + 交叉溶解、区域描画、TTS 旁白 |
| `hexi-travel.json` | 沿千公里河西走廊的 **travel 平移镜头** |
| `shanghai-3dtiles.json` | Google 实景三维城市建筑 |
| `putuoshan-demo.json` | 最初的最小示例 |

完整字段说明与所有镜头类型见 [`SKILL.md`](./SKILL.md)。开发路线见 [`ROADMAP.md`](./ROADMAP.md)。

## 说明与署名

- Cesium ion 影像/地形与 Google 实景三维要求**保留可见署名**——渲染器会在画面保留 Cesium 版权标识，发布时请勿裁掉。
- Cesium ion **免费额度**与 Google 3D Tiles 面向非商业/评估用途；商业发布请核对 Cesium ion 与 Google Maps Platform 条款。
- 卫星影像版权归各数据提供方。

## 许可

MIT —— 见 [LICENSE](./LICENSE)。
