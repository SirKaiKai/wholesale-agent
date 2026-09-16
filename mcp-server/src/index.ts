// stdio 入口：Host（WorkBuddy / Claude Desktop）拉起本进程，用 stdin/stdout 收发 JSON-RPC。
import './env.js'; // ⚠️ 必须最先加载：注入 .env、固定 cwd
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';

const server = buildServer();

await server.connect(new StdioServerTransport());

// ⚠️ 日志必须走 stderr（console.error）——stdout 是通信管道，写进去会污染 JSON-RPC
console.error('[MCP] wholesale-kb 已启动（stdio）');
