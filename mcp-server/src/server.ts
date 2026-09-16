// 这个文件只做一件事：把项目里的能力，包装成 MCP 工具暴露出去。
// 目前只有一个工具：search_wholesale_policy —— 批发业务制度检索（RAG）。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// knowledge.js 必须「动态导入」：.env 加载完才能初始化 SiliconFlow 客户端。
// 用模块级缓存，避免每次调用都重新导入。
let knowledgeModule: typeof import('../../lib/knowledge.js') | null = null;
async function getKnowledge() {
  if (!knowledgeModule) {
    knowledgeModule = await import('../../lib/knowledge.js');
  }
  return knowledgeModule;
}

/** 构建一个已注册全部工具的 McpServer 实例 */
export function buildServer(): McpServer {
  const server = new McpServer({ name: 'wholesale-kb', version: '1.0.0' });

  // ── 工具：批发业务制度检索 ────────────────────────────────────
  server.tool(
    'search_wholesale_policy',
    '用户问题涉及批发通/订单豹业务制度、政策、流程、规则时，必须优先调用本工具，禁止直接凭记忆回答。覆盖：退货退款政策、账期与催款规则、客户等级与信用额度、售后处理流程、欠款管理等。将用户原话作为 question 传入，返回知识库中的相关文档片段与来源。',
    {
      question: z.string().describe('用户关于批发通业务制度的原话，如「客户要退货怎么处理」'),
      topK: z.number().int().min(1).max(10).optional().describe('返回最相关的几条文档片段，默认 3'),
    },
    async ({ question, topK = 3 }) => {
      try {
        const { ensureIngested, retrieve, buildContext } = await getKnowledge();
        await ensureIngested(); // 首次调用：把 knowledge-base/ 文档向量化入库
        const hits = await retrieve(question, { topK });
        if (hits.length === 0) {
          return { content: [{ type: 'text', text: '（知识库未检索到相关内容）' }] };
        }
        return { content: [{ type: 'text', text: buildContext(hits) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `检索失败：${msg}（请确认 SILICONFLOW_API_KEY 已配置）` }],
          isError: true,
        };
      }
    },
  );

  return server;
}
