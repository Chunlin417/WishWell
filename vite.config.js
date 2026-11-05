import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'node:fs';
import path from 'node:path';

// 仅开发时使用：POST /__shot?name=xxx 把画布截图保存到 .shots/ 目录，方便调试画面
const shotPlugin = {
  name: 'dev-shot',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const dir = path.resolve('.shots');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${name}.jpg`), Buffer.concat(chunks));
        res.end('ok');
      });
    });
  },
};

// npm run dev:phone 用 HTTPS（自签名证书），手机浏览器才允许 GPS 定位
export default defineConfig(({ mode }) => ({
  plugins: [shotPlugin, ...(mode === 'phone' ? [basicSsl()] : [])],
}));
