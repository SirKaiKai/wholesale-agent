// 职责：加载 wholesale-agent/.env 到 process.env。
// ⚠️ 必须在任何会读取环境变量的模块之前 import（所以它是 index.ts 的第一行）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/ → mcp-server/ → wholesale-agent/
export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

// 固定工作目录，让 knowledge-base/ 这类相对路径始终基于项目根解析
process.chdir(projectRoot);

const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    // 已存在的环境变量优先，允许外部覆盖 .env
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
