/**
 * ============================================================
 *  Agent 主入口 · 当前形态（三层能力已合体）
 * ============================================================
 *  这个接口从"只会聊天的批发顾问"一路长到现在，身上挂了三层：
 *
 *    ① 知识库检索（RAG）   —— 退货政策 / 账期规则 / 客户等级制度
 *                             每次请求先 retrieve 再拼进 system prompt
 *    ② 查询工具 ×3         —— getCustomerDebt / getStock / getOrders
 *                             只读，AI 自主决定调哪个
 *    ③ 催收流程工具 ×1     —— collectionWorkflow
 *                             肚子里是一整张状态图（loadDebt → classify
 *                             → draftMessage → humanApprove），
 *                             只产草稿、绝不发送
 *
 *  改这个文件时要连带想的两件事：
 *    · tools 里加/删工具 → system prompt 的"能力边界"必须同步改。
 *      漏改就会变成"prompt 授权 AI 说它拿不到的数据"（幻觉的源头）
 *    · system prompt 是 AI 唯一的能力说明书，它看不到任何一行工具代码。
 *      字段、限制、红线，不写在这里就等于不存在
 */
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getCustomerDebt, getStock, getOrders } from '@/lib/tool';
import { ensureIngested, retrieve, buildContext } from '@/lib/knowledge';
import { setApiBase } from '@/lib/api';
import {collectionWorkflow} from '@/lib/collection-workflow';

// DeepSeek 走 OpenAI 兼容协议
const deepseek = createOpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  // 部署适配：把当前请求的域名注入统一请求层（mock 接口与站点同域）
  setApiBase(new URL(req.url).origin + '/api/mock');

  // ① 知识库入库（首次自动执行，之后直接返回）
  await ensureIngested();

  // ② 检索最后一条用户消息 → 拼成上下文，末尾追加进 system prompt
  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
  const hits = lastUserMsg ? await retrieve(lastUserMsg.content, { topK: 3 }) : [];
  const context = buildContext(hits);

  const result = await streamText({
    model: deepseek('deepseek-chat'),
    system: `你是"批发通"，一个批发业务顾问助手。

    你的能力边界（如实告知用户）：
    - 你【已接入】客户欠款查询工具（getCustomerDebt）：查欠款金额、账户余额、客户等级、所属业务员、联系电话
      ⚠️ 该工具【不返回账龄】。若用户问"欠了多久 / 账龄多少天"，如实说明该信息要在催收流程里算，
         并主动询问是否需要走一遍催收流程（collectionWorkflow），不要自己估算天数
    - 你【已接入】商品库存查询工具（getStock）：查当前库存、规格、单位、所在仓库、成本价
      ⚠️ 该工具【没有】安全库存字段，被问到时如实说"没有接入安全库存"，不要估一个数
    - 你【已接入】订单查询工具（getOrders）：查订单号、下单时间、订单金额、已收/未收金额、发货状态、收款状态、商品明细（买了什么、数量、金额）；可按客户查，不填客户则查全部（用于比较统计）
    - 你【已接入】催收流程工具（collectionWorkflow）：对指定客户走完整催收流程 —— 查欠款 → 判风险 → 起草催款消息
      · 它【只产草稿、绝不发送】。你必须把草稿**原文**转述给用户，并说明"确认后我再帮你发"
      · 低风险客户它不产草稿，会返回"本期不催收"的记录 —— 这是【正常结果】，不是失败，别说成"出错了"
      · 若工具返回没有草稿 / found:false → 如实告知用户（本期不催收 / 没找到这个客户），不要自行编写或补全草稿
      · 用户只是想了解"欠多少钱"时用 getCustomerDebt，只有要催款时才用本工具
      · 【红线】你没有任何发送消息的能力。用户说"发吧 / 就按这个发"时，必须如实说明
         "发送要你本人操作，我这边只能出草稿"，绝不能声称已发送、也不能说"我稍后帮你发"
    - 你【已接入】公司内部制度文档：退货政策、账期与催款规则、客户等级制度（基于知识库检索回答）
    - 你【能聊】批发/进销存的通用知识和行业常识（账期、库存周转、客户管理的方法论等）

    被问到做不到的事时，明确说"我目前还没有接入XX能力"，不要编造具体数字或制度。
    回答制度类问题时，以知识库检索内容为准，并标注出处。

    回复风格：简洁、务实、说人话，像一位有经验的老业务员。
    全程只用中文。调用工具前不要输出任何前置说明文字（不要出现"我来查一下""I'll run"这类话），
    拿到工具结果后直接给用户完整回答。${context}`,
    messages,
    tools:{
      getCustomerDebt, getStock, getOrders, collectionWorkflow
    },
    // 一次工具调用占 1 步，拿到结果后再组织回答占 1 步。
    // 5 步够上面这些工具跑 2 轮往返；调大只会让 AI 有机会空转烧钱。
    maxSteps: 5,
  });

  return result.toAIStreamResponse();
}
