# 云图集素材记录

生成日期：2026-11-17

## 文件

- `cloud_cumulus_atlas.png`：4×4 厚积云图集，必需。
- `cloud_stratocumulus_atlas.png`：4×4 层状碎云图集，必需。
- `cloud_wispy_atlas_optional.png`：4×4 风卷云图集，可选。

三张均为 2048×2048 PNG RGBA。每格云体四周至少保留 16 px 完全透明边距，格与格之间无连接像素。

## 工具与后处理

- 生成：Codex 内置 `image_gen`。
- 后处理：按每格提取蓝灰云体的最大连通区域，清除生成器留下的青蓝/白色背景污染；轻微羽化 alpha；逐格重新居中到 2048×2048 标准 4×4 图集。
- 可选卷云图集额外压低高光，统一为冷深蓝灰色。

## 核心提示词

1. 厚积云：`4×4 atlas, sixteen independent thick volumetric cumulus cloud clusters, cool deep blue-gray, rounded billowing tops, irregular bottoms fading softly to true alpha transparency, at least 16 px transparent padding per cell, no sky/sun/moon/stars/mountains, no purple/pink/red, no hard fringe.`
2. 层状碎云：`4×4 atlas, sixteen independent broken stratocumulus cloud banks, layered overlapping lobes, thick and volumetric, cool deep blue-gray, irregular dissolving bottoms, true alpha transparency, at least 16 px transparent padding per cell, no background or hard edge.`
3. 风卷云：`4×4 atlas, sixteen independent wind-swept curled cloud tufts, delicate but dimensional, cool deep blue-gray, feathered ends fading to true alpha transparency, at least 16 px transparent padding per cell, no sky or celestial/landscape elements.`

## 验证

- 尺寸：2048×2048。
- 通道：RGBA（4 通道）。
- 逐格 16 px 边界可见像素违规：0。
