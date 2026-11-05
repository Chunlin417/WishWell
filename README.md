# WishWell

一个网页上的 3D 许愿池，用 [Three.js](https://threejs.org) 实时渲染。

池子的光线和天气跟着访问者所在地的真实时间、真实天气变化：清晨、正午、黄昏、夜晚连续过渡，下雨、下雪、起雾时池边也会下雨、积雪、起雾。

## 特点

- **跟随真实时间**：按访问者的位置计算太阳和月亮的高度、方向和月相，光线和影子连续变化。
- **跟随实时天气**：天气来自 [Open-Meteo](https://open-meteo.com)，支持晴、多云、阴、雾、雨、雪、雷雨，每 15 分钟刷新一次。
- **水面**：折射、倒影、水底焦散光纹，点击水面会泛起涟漪，雨滴也会激起涟漪；夜里池水深处会泛起微弱的光。
- **池边**：天然石块围成的石潭，两侧各有一尊守愿石狐（横屏时显示），植物和落叶随季节变化。
- **手机友好**：竖屏、横屏分别构图，手机上会自动降低部分细节。

## 运行

需要 [Node.js](https://nodejs.org)（18 以上）。

```bash
npm install
npm run dev
```

然后打开 <http://127.0.0.1:5173>。

- 网址后面加 `?debug` 会出现右上角的调试面板，可以拖动时间、加速时间流速、切换天气、选择城市。
- 用手机在局域网里访问时，浏览器要求 HTTPS 才能使用精确定位，请用 `npm run dev:phone`，再打开终端里显示的 `https://…:5174` 地址（自签名证书，提示不安全时选择继续访问）。

打包成静态网站：

```bash
npm run build
```

输出在 `dist/`，可以放到任何静态网站托管服务上（需要 HTTPS，否则无法定位）。

## 目录

| 路径 | 内容 |
|---|---|
| `src/main.js` | 入口：渲染器、镜头、光照、天气、每帧更新 |
| `src/pool.js` | 池底地形、石块、植物、落叶 |
| `src/water.js` | 水面、涟漪模拟 |
| `src/sky.js` | 天空（出现在水面倒影里，也提供环境光） |
| `src/fox.js` | 守愿石狐 |
| `src/fx.js` | 雨、雪、萤火虫 |
| `src/patch.js` | 材质扩展：贴图、积雪、雨湿、焦散等 |
| `src/astro.js` / `src/weather.js` | 天文计算、定位与天气 |
| `public/` | 压缩后的贴图（WebP）和石狐模型 |
| `textures-src/` | 贴图原图，用于重新压缩 |
| `scripts/` | 贴图压缩、模型精简等工具脚本 |

常用脚本：

```bash
# 重新压缩贴图（需要 Python 和 Pillow）
python scripts/compress_textures.py

# 精简一个高面数的 GLB 模型（例如 AI 生成的模型）
node scripts/optimize-glb.mjs 输入.glb public/models/输出.glb 60000 1024
```

## 素材来源

- 石头、苔藓、卵石、地面贴图：[Poly Haven](https://polyhaven.com)，CC0 授权，详见 `public/textures/CREDITS.md`。
- 守愿石狐模型：使用 [Tripo](https://www.tripo3d.ai) 生成，仅供非商业用途。
- 天气数据：[Open-Meteo](https://open-meteo.com)；IP 定位：ipapi.co；地名：BigDataCloud。

本项目为个人非商业项目。
