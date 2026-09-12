/**
 * ============================================================
 *  Step 1 · 纯对话基线（当前状态）
 * ============================================================
 *  这是整个批发 Agent 的起点：只有一个"会聊天的批发顾问"，
 *  没有工具、没有知识库、没有数据。
 *
 *  刻意保持最小——这样后面每加一块（工具 / RAG / 汇合），
 *  你都能清楚对比出 Agent 能力发生了什么变化。
 *
 *  本步认知点：
 *  1. streamText：流式调用 LLM 的标准姿势
 *  2. system prompt：给 Agent 设定人设和能力边界
 *  3. 基线的"无能"：问它查欠款/退货政策，它只能编或道歉
 *     ——这份"无能"就是 Step 2 和 Step 4 要逐个消灭的
 */
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getCustomerDebt, getStock, getOrders } from '@/lib/tool';
import { ensureIngested, retrieve, buildContext } from '@/lib/knowledge';
import { setApiBase } from '@/lib/api';

// DeepSeek 走 OpenAI 兼容协议
const deepseek = createOpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  // 部署适配：把当前请求的域名注入统一请求层（mock 接口与站点同域）
  setApiBase(new URL(req.url).origin + '/api/mock');

  // 知识库入库（首次自动执行）+ 检索最后一条用户消息
    await ensureIngested();
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
    const hits = lastUserMsg ? await retrieve(lastUserMsg.content, { topK: 3 }) : [];
    const context = buildContext(hits);
  //END

  const result = await streamText({
    model: deepseek('deepseek-chat'),
    system: `你是"批发通"，一个批发业务顾问助手。

    你的能力边界（如实告知用户）：
    - 你【已接入】客户欠款查询工具（getCustomerDebt）：查欠款金额、账龄、最后跟进时间、客户等级
    - 你【已接入】商品库存查询工具（getStock）：查当前库存、安全库存、所在仓库
    - 你【已接入】订单查询工具（getOrders）：查订单号、商品、金额、日期、发货状态；可按客户查，也可查全部
    - 你【已接入】公司内部制度文档：退货政策、账期与催款规则、客户等级制度（基于知识库检索回答）
    - 你【能聊】批发/进销存的通用知识和行业常识（账期、库存周转、客户管理的方法论等）

    被问到做不到的事时，明确说"我目前还没有接入XX能力"，不要编造具体数字或制度。
    回答制度类问题时，以知识库检索内容为准，并标注出处。

    回复风格：简洁、务实、说人话，像一位有经验的老业务员。${context}`,
    messages,
    tools:{
      getCustomerDebt,getStock, getOrders
    },
    maxSteps: 5,
  });

  return result.toAIStreamResponse();
}
