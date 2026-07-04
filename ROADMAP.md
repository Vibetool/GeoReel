# geo-flyover 迭代 Backlog

MVP（已做）：单场景 JSON → 三维飞行 + POI 打点 + 发光路线描画 + 锚定标题 → MP4。

## P1 — 画质与真实感
- [x] Cesium ion World Terrain 立体地形 — 已验证（泰山/普陀山成片）
- [x] 1920x1080 / 4K 预设 — 已实现 preset 字段，UI 元素随分辨率等比缩放
- [x] Google Photorealistic 3D Tiles — 已实现 buildings3d 选项（ion asset 2275207，隐藏 globe，等待 tileset 加载）；城市近景要点：minSlant 1200–2000 + pitch -18~-25 + targetHeight 半楼高
- [x] 地形垂直夸张 verticalExaggeration — 已实现：场景级参数(2~2.5倍)，山体拔地而起、落差感强；POI/标签/路线锚点同步抬升不悬浮。配合低机位+浅俯角是"落差感"三件套
- [ ] 大气/光照调优：太阳角度按拍摄时间设定，海面高光

## P0 — 实战暴露的问题（普陀山/泰山两次成片得出）
- [x] **标签防碰撞** — 已实现：每帧屏幕空间投影 + 贪心去重叠（POI 向上错开、标题让位、sticky 偏移防抖动）；POI/标题锚点做了地形高度采样保证投影精度
- [x] **相机路径自动生成** — 已实现 `shots` 镜头语言（flyin/orbit），自动解算 heading/slant range，泰山场景验证与手调构图一致
- [x] **POI 坐标校验** — 已实现 `--preview` 模式：1 分钟出 3 张全要素校对帧
- [x] **构图自动断言** — shots 编译时检查每个 POI 相对镜头轴偏角，>28° 输出警告（拒渲版留待后续：屏幕投影精确判定）

## P2 — 动效能力补齐（对标原片）
- [x] 发光**区域**描画动画 — 已实现：region 与 route 同款逐段描画（tStart/tEnd，appear 向后兼容），可选地形贴合填充淡入（fill/fillOpacity）
- [x] 多镜头 timeline + 转场 — 已实现 cut + dip-to-white/black；shot 可指定 target POI 做近景（targetHeight 修正山体海拔，山顶特写必填）
- [x] POI 出现动画 — 已实现：back-ease 弹入 + 标签渐显；防碰撞上推时自动补白色引线
- [x] 交叉溶解转场 — 已实现 transition:"fade"：时间线分段渲染（出段冻结尾帧）+ ffmpeg xfade 链
- [ ] 标题字体样式预设（描边白字/金色大字），支持竖排
- [x] travel 平移/跟拍镜头 — 已实现：沿路径(走廊/山脉)定高定侧偏滑行，望向移动路径点；线性插值匀速不抽动；专治超长线状要素(河西走廊这类千公里跨度)，太空一屏看不出走势的问题
- [ ] 相机路径缓动曲线可配（flyin/orbit 现固定 easeInOutCubic；travel 已用线性）
- [ ] travel 增强：POI 过境后自动淡出（现为过境后留在画外不清理）；look-along 模式(镜头朝行进方向而非侧向)
- [ ] xfade 出段尾帧目前是冻结帧（渐隐时旧镜头静止）；可改为延续 orbit 速度外推

## P3 — 成片流水线
- [ ] 底部字幕轨道（SRT 输入 → ffmpeg drawtext/ass 烧录）— 用户明确说暂不需要
- [x] TTS 配音 — 已实现 scene.audio.tts（edge-tts 优先，macOS say Tingting 回退），可选项
- [x] BGM 混音 — 已实现 scene.audio.bgm（循环+音量+对齐视频长度），可选项；TTS+BGM 可同时混
- [ ] 实拍素材穿插：scene JSON 支持 insert 片段（图片/视频 + 转场），ffmpeg concat
- [ ] TTS 音画对齐（分句时间轴，按镜头节点触发旁白）

## P4 — 工程化
- [x] 帧渲染并行化 — 已实现 --workers=N（多 Chrome 实例分段渲，连续 chunk 保瓦片缓存局部性；断点续传/自愈按 worker 独立）；buildings3d 时默认 1
- [x] 渲染断点续传（跳过已存在帧）— 已实现
- [x] 崩溃自愈：ion 3D 地形负载重，无头 Chrome 标签页会 OOM（Target closed）；已加 `--disable-dev-shm-usage` + 每帧最多重启浏览器 3 次续渲
- [ ] 进一步降内存：定期（每 N 帧）重启浏览器主动释放；或降 maximumScreenSpaceError 于超高负载场景
- [ ] scene JSON schema 校验 + 友好报错
- [ ] POI 坐标自动化：地名 → 经纬度（Nominatim/高德 API）
- [ ] 预览模式：低分辨率 5fps 快渲，确认构图后再全速渲

## 已知限制
- Earth Studio 的谷歌卫星影像清晰度 > Cesium 免费影像；商用要核对影像源条款
- 无 token 时仅 OSM 平面底图（烟测用）
- 逐帧等待瓦片加载，渲染速度 ~1-3 fps（10s 视频约 3-6 分钟）
