# 贴图来源

以下贴图均来自 [Poly Haven](https://polyhaven.com)，CC0 授权（可免费商用，无需署名）。

| 文件前缀 | 用途 | 页面 |
|---|---|---|
| lichen_rock | 围池石块、水底石子、石灯笼 | https://polyhaven.com/a/lichen_rock |
| mossy_rock | 石块上的苔藓 | https://polyhaven.com/a/mossy_rock |
| ganges_river_pebbles | 池底卵石 | https://polyhaven.com/a/ganges_river_pebbles |
| forest_ground_04 | （已不再使用，岸上地面换成了下面自己生成的贴图） | https://polyhaven.com/a/forest_ground_04 |

## 自己生成的地面贴图

以下贴图为本项目自行生成（原图 2K 在 `textures-src/*_2k.webp`，运行 `scripts/pack_ground_textures.py` 生成这里的 1K 版本）。

| 文件前缀 | 用途 |
|---|---|
| lawn_grass | 草坪 |
| wet_soil | 草地间露出的湿泥土 |
| wet_sand | 水边一圈湿沙 |
| moss_ground | 石头周围的苔藓地面 |
| leaf_litter | 泥土上成片的落叶 |

## 为参考图新增的素材（AI 图像生成 + 脚本处理）

均为本项目自行生成（2026-11-10，使用 OpenAI 图像生成工具，再由 `scripts/prepare_*_assets.ps1` 做无缝化 / PBR 派生）。原图在 `textures-src/`，运行 `python scripts/pack_new_assets.py` 压缩成这里的 WebP。授权说明见 `textures-src/ASSET_CREDITS.md`。

| 文件前缀 | 用途 |
|---|---|
| canopy_mask | 树荫光斑遮罩（R 粗 / G 细两张叶影）和水底焦散（B），合成一张 |
| groundplants_atlas | 地面植物图集：三叶草 / 蕨 / 蜂斗菜 / 白花 |
| leaves_atlas | 落叶、花瓣图集 |
| rock_mossy_a / rock_mossy_b / rock_lichen | 围池石块的三种花岗岩 |
| ground_mossgrass | 岸上苔藓草地 |
| riverbed_pebbles | 水下河床卵石 |
| fox_stone | 石狐的浅米色风化花岗岩 |
| water_ripple_nor_gl | 水面细小波纹法线 |
| shore_mud | 水边一圈湿泥（原来的 wet_sand 不再用） |
