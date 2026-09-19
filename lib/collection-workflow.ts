import { generateText, generateObject, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { apiGet } from './api';
// 数据契约只定义一份，放在 lib/tool.ts —— 字段改名时只改那一处，不会两边打架
import type { CustomerDebtResult, OrderResult } from './tool';

const deepseek = createOpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});
// ════════════════════════════════════════════════════════════
//  文件结构（按运行顺序）
//    ① 工具函数 daysBetween   —— 算账龄用的纯计算，跟业务无关
//    ② 入口节点 loadDebt      —— 两跳取数 + 翻译成图要的字段
//    ③ 判断节点 classify      —— AI 判风险，失败降级规则
//    ④ 生成节点 draftMessage  —— AI 写话术，失败降级模板
//    ⑤ 人审节点 humanApprove  —— 只贴"待审"标签，不等人
//    ⑥ 组装图 nodes / edges
//    ⑦ 执行引擎 runGraph      —— 跟 step6/step7 一模一样
//    ⑧ 封装成 tool            —— 对外出口
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
//  ① 翻译层 · 工具函数：算"日历天差"
//
//  为什么需要它：ERP 里**没有"账龄"这个字段**，只能算。
//  而算的时候有个坑 —— create_time 是 '2026-06-18 10:24:33'，带时分秒。
//  直接两个时间戳相减得到 91.6 天，Math.floor 后是 91，**少一天**。
//
//  正确做法：两边都先归零到当天 00:00 再相减。
//    · then：只取前 10 位（丢掉时分秒）+ 显式补 'T00:00:00'
//      —— 补 T 是因为 'YYYY-MM-DD' 会被当成 UTC，而 'YYYY-MM-DDTHH:mm:ss'
//         按规范是本地时间。两者能差好几个小时，跨月就会差一天。
//    · today：用 new Date(年, 月, 日) 构造，天然就是本地 00:00
//
//  这是纯计算、跟业务无关，所以抽成独立函数 —— 好测、好复用。
// ════════════════════════════════════════════════════════════
function daysBetween(dateStr: string): number {
  const then = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today.getTime() - then.getTime()) / 86400000); // 86400000 = 一天的毫秒数
}

// ════════════════════════════════════════════════════════════
//  ② 入口节点：loadDebt —— ★ 两跳
//
//  step8 里它是写死的一段假数据。真实世界里"欠款"不在客户表上，
//  要从订单里算，所以必须走两跳：
//
//    第一跳  姓名        → 客户主档（拿到 member_id 这个可靠身份）
//    第二跳  member_id   → 该客户的所有订单
//    然后    订单        → 算出 amount 和 days（数据源里不存在的东西）
//
//  为什么第二跳不用姓名：同名客户会串号。member_id 是主键，精确。
//
//  ⚠️ 这里**没有 try/catch，是故意的**。查不到客户、没有订单、
//     一笔未结清都没有 —— 这三种情况都意味着"这张图根本不成立"，
//     异常必须穿出去，由最外层（tool 的 execute）拦成结构化结果。
//     在这里 catch 住 = 把异常降级成数据 = 幻觉的原料。
// ════════════════════════════════════════════════════════════
async function loadDebt(state: any) {
  // ── 第一跳：姓名 → 客户主档 ──────────────────────────────
  const memberRes = await apiGet<CustomerDebtResult>('/customers', { name: state.name });
  const members = memberRes.customer ?? [];
  if (!memberRes.found || members.length === 0) {
    throw new Error(memberRes.message || `未找到客户「${state.name}」`);
  }
  const member = members[0];

  // ── 第二跳：member_id → 该客户的订单 ─────────────────────
  const orderRes = await apiGet<OrderResult>('/orders', { memberId: String(member.member_id) });
  const orders = orderRes.orders ?? [];
  if (!orderRes.found || orders.length === 0) {
    throw new Error(orderRes.message || `客户「${member.nickname}」名下没有订单`);
  }

  // ── 翻译层：把订单算成图要的四个字段 ─────────────────────
  // 只算未结清的（diff_money = 未收金额 > 0）
  const unpaid = orders.filter((o) => o.diff_money > 0);
  if (unpaid.length === 0) {
    // 没欠款 → 没账龄 → 没风险等级 → 哪来的催款信？整张图不成立
    throw new Error(`客户「${member.nickname}」目前没有未结清的欠款`);
  }

  // 金额：先转成"分"再累加，避免浮点误差（0.1 + 0.2 !== 0.3）
  const amount = unpaid.reduce((sum, o) => sum + Math.round(o.diff_money * 100), 0) / 100;

  // 账龄：取**最早那笔**未结清订单的下单时间，算到今天
  const earliestCreateTime = unpaid.map((o) => o.create_time).sort()[0];
  const days = daysBetween(earliestCreateTime);

  console.log(`   [loadDebt] 第一跳命中 ${member.nickname}(#${member.member_id})，第二跳 ${orders.length} 单，其中未结清 ${unpaid.length} 单`);
  console.log(`   [loadDebt] 最早欠款单 ${earliestCreateTime} → 账龄 ${days} 天，欠款合计 ${amount} 元`);

  return {
    customer: member.nickname,
    amount,
    days,
    // ERP 暂无「已催收次数」这个字段（催收记录要另建跟进表），先占位。
    // 写 0 而不是省略，是为了让 classify 的 prompt 拿得到一个确定的值。
    contacted: 0,
  };
}

// ════════════════════════════════════════════════════════════
//  ③ 判断节点：classify —— 跟 step7 一模一样，没动过
//
//  两个函数是一对：classify 走 AI，出错时 classifyByRule 顶上。
//  ⚠️ 这类节点的白名单写在 schema 里（z.enum），是"事前声明"，
//     不是等 AI 返回怪值之后手动兜回来。
// ════════════════════════════════════════════════════════════
function classifyByRule(state: any) {
  const risk = state.days > 90 ? 'high' : 'normal';
  return { risk, reason: `账龄 ${state.days} 天（规则判断）`, judgedBy: 'rule' };
}

async function classify(state: any) {
  const prompt = `请判断这单欠款的催收风险等级。

客户：${state.customer}
欠款金额：${state.amount} 元
账龄：${state.days} 天
已催收次数：${state.contacted} 次

参考标准：
- 账龄越长、金额越大、催过仍未回款，风险越高
- high = 风险高，需要人工决定是否发送催款消息
- normal = 常规，系统直接走流程

只输出 JSON，格式：{"risk":"high 或 normal","reason":"20字以内的理由"}`;

  try {
    // 判断类：要稳定、要 JSON
    const { object } = await generateObject({
      model: deepseek('deepseek-chat'),
      prompt: prompt,
      temperature: 0,
      system: '你是批发行业的风控助手。只输出 JSON，不要任何解释文字。',
      schema: z.object({ risk: z.enum(['high', 'normal']), reason: z.string() })
    })

    const risk = object.risk === 'high' ? 'high' : 'normal';
    const reason = typeof object.reason === 'string' ? object.reason : '（AI 未给理由）';

    return { risk, reason, judgedBy: 'ai' };
  } catch (e: any) {
    console.log(`     ⚠ AI 判断失败（${e.message.slice(0, 60)}），降级为规则判断`);
    return classifyByRule(state);
  }
}

// ════════════════════════════════════════════════════════════
//  ④ 生成节点：draftMessage —— 生成催款话术
//
//  跟 classify 摆在一起看，能看出三个明显不同：
//
//  1. **它没有白名单。** classify 要防 AI 返回 'HIGH' 这种怪值，
//     而"一段文案"没有合法值可言 —— 只要不是空的就能用。
//     所以这里只校验"非空"，不校验"范围"。
//
//  2. **它的 temperature 是 0.8。** 写文案要有点发挥空间，
//     否则每次生成的一模一样，人还得自己改。
//
//  3. **它要的输入更多。** 写一封像样的话，得知道客户是谁、
//     欠多少、多久了、催过几次 —— 材料不齐，话就写不实。
//
//  但有一点跟 classify 完全一样：**它也有兜底。**
//  因为"AI 写不出来"和"AI 判断不出来"是同一类风险。
// ════════════════════════════════════════════════════════════

// 兜底版：AI 挂了就用这个模板。难看，但一定能用。
function draftByTemplate(state: any) {
  return {
    message:
      `${state.customer}您好，财务核对到咱们这边还有 ${state.amount} 元的货款，` +
      `账期已经 ${state.days} 天了。麻烦帮忙安排一下回款时间，` +
      `如果近期有困难也可以先跟我说，咱们商量个方案。`,
    draftedBy: 'template',
  };
}

async function draftMessage(state: any) {
  const prompt = `给下面这位客户写一条催款消息，要求微信/短信里能直接发出去。

客户：${state.customer}
欠款金额：${state.amount} 元
账期：已 ${state.days} 天
我们此前已经沟通过 ${state.contacted} 次

内部参考（不要把这些话直接写进文案）：风险等级 ${state.risk}，判据是「${state.reason}」

写作要求：
- 150 字以内，一段话，不要分点、不要标题
- 语气礼貌但把话说清楚，给对方留面子，同时把回款时间问出来
- 不要用"贵司""兹""敬请"这类官腔，就像老朋友谈生意那样说人话
- 不要出现"法律""起诉""诉讼"这类施压词
- 不要编造我们并没有的优惠、折扣或政策
- 直接输出文案本身，不要加任何前后缀说明`;

  try {
    // 生成类：temperature 调高，不要 JSON 约束
    const { text } = await generateText({
      temperature: 0.8,
      model: deepseek('deepseek-chat'),
      prompt: prompt,
      system: '你是批发行业的资深业务员，擅长写不伤和气又能要到钱的消息。',
    })
    const message = text.trim();

    // ★ 生成类的"闸门"很简单：只判断空不空。
    //   判断节点要防"值不在集合里"，生成节点只需要防"没生成出来"。
    if (!message) throw new Error('AI 返回了空文案');

    return { message, draftedBy: 'ai' };
  } catch (e: any) {
    console.log(`     ⚠ AI 生成失败（${e.message.slice(0, 60)}），降级为模板`);
    return draftByTemplate(state);
  }
}

// ════════════════════════════════════════════════════════════
//  ⑤ 人审节点：humanApprove —— ★ 它已经"不等人"了
//
//  它的职责从「执行人审」退化成「贴一张待审标签」：
//  往 state 里写一个 needsApproval: true，然后照边走。
//
//  为什么不等人了：网站上的 HTTP 请求不可能挂着等一个人
//  —— 用户可能想 3 秒，也可能想 3 天。等待这件事没消失，
//  它搬到了图外面：由调用方（对话层）拿着草稿去问用户。
//
//  ⚠️ 但"需要人审"这个事实必须留在 state 里（needsApproval），
//     否则上面那层就不知道"这是草稿、还没发"。
// ════════════════════════════════════════════════════════════

async function humanApprove(state: any) {
  return { needsApproval: true };
}

function recordRejection(_state: any) {
  console.log('     （已记录：本次暂不催收，转业务员跟进）');
  return {};
}



// ════════════════════════════════════════════════════════════
//  ⑥ 组装图：nodes / edges
//
//  这一段从 step4 起形状就没变过 —— 图只是两张表：
//  "名字 → 函数" 和 "名字 → 下一个名字"。
//  上面 ①②③④⑤ 随便换实现，这里一个字都不用改。
// ════════════════════════════════════════════════════════════

const nodes = new Map<string, any>();
nodes.set('loadDebt', loadDebt);
nodes.set('classify', classify);
nodes.set('draftMessage', draftMessage); // ← 新增注册
nodes.set('humanApprove', humanApprove);
nodes.set('recordRejection', recordRejection);

const END = '__end__';

const edges = new Map<string, any>();
edges.set('loadDebt', 'classify');
// ↓ 改动 1：高风险原来直接找人工，现在先去写话术
edges.set('classify', (state: any) => (state.risk === 'high' ? 'draftMessage' : END));
// ↓ 改动 2：新节点写完之后，才把人叫来看（顺序不能反）
edges.set('draftMessage', 'humanApprove');
// ↓ 以下两条跟 step7 完全一致
edges.set('humanApprove', END);
edges.set('recordRejection', END);

// ════════════════════════════════════════════════════════════
//  ⑦ 执行引擎：runGraph
//
//  从 step3 那个 for 循环、step4 改成 while 到现在，**一个字没改**。
//  它不知道 loadDebt 里调了几个接口、classify 用的是 AI 还是规则
//  —— 这就是"图与实现解耦"最直白的证据。
// ════════════════════════════════════════════════════════════
export async function runGraph(state: {}) {
  let current = 'loadDebt';

  console.log('开始跑，入口节点：', current);
  console.log('');

  while (current !== END) {
    const fn = nodes.get(current);
    if (!fn) throw new Error('找不到节点：' + current);

    const patch = await fn(state);
    Object.assign(state, patch ?? {});

    console.log(`── 节点「${current}」跑完了`);
    console.log('   当前状态：', state);

    const edge = edges.get(current);
    if (!edge) throw new Error('节点「' + current + '」没有配下一条边');

    const next = typeof edge === 'function' ? edge(state) : edge;
    console.log('   下一步 →', next);
    console.log('');

    current = next;
  }

  console.log('跑完了。最终状态：');
  console.log(JSON.stringify(state, null, 2));
  return state;
}

// ════════════════════════════════════════════════════════════
//  ⑧ 封装成 tool —— 对外出口
//
//  AI 只看得见 description 和 parameters 两样东西，看不到上面
//  任何一行代码。所以"什么时候该用这个工具"必须写进 description。
//
//  execute 里做两件收尾：
//    · 把图跑出来的结果**瘦身**后交给 AI（state 里的中间字段别全丢进去）
//    · 最外层 catch —— 图抛错（客户不存在、没欠款）时，
//      把原因转成结构化数据交出去，而不是让异常穿到 SDK 那层
//
//  ⚠️ 红线：这里**只产草稿**。发送是不可逆动作，永远不进图、不进工具。
// ════════════════════════════════════════════════════════════
export const collectionWorkflow = tool({
  description: `干什么 —— 催收流程工具：对指定客户走完整流程，查欠款 → 判风险 → 起草一条能直接发的催款消息。
    什么时候用 —— 当用户说"帮我催一下XX""给XX发条催款消息""走一下催收流程"时调用。
    红线 —— 本工具只产草稿、绝不发送，草稿必须交给用户确认。
    划清界限 —— 如果用户只是想了解某客户欠了多少钱，请用 getCustomerDebt，不要用本工具。`,
  parameters: z.object({
    customerName: z.string().describe('客户姓名，如：张三'),
  }),
  execute: async ({ customerName }) => {
    try {
      const state: any = await runGraph({ name: customerName });
      const { customer, amount, days, risk, reason, message, draftedBy, needsApproval } = state;
      let data: any = { customer, amount, days, risk, reason, message, draftedBy, needsApproval };
      if (!message) {
        data.outcome = 'skipped';
        data.note = '该客户风险等级为常规，按规则本期不催收，未生成草稿。请如实告知用户本期不催收，不要自行编写草稿。'
      }
      return data;
    } catch (err: any) {
      return { found: false, message: err.message }
    }
  },
})

// ════════════════════════════════════════════════════════════
//  ⑨ 怎么验 —— 在对话里跑，不是在脚本里
//
//  开发服务器里问一句「帮我催一下李四的款」，两边都要看：
//    页面上   AI 把草稿**原文**转述给你 + "确认后我再帮你发"
//    控制台   loadDebt → classify → draftMessage → humanApprove
//             两次「AI 用量」+ loadDebt 自己打的两跳日志
//
//  四个观察点：
//    ① 流里出现 toolName: collectionWorkflow，**不是** getCustomerDebt
//       —— 说明 description 里那句"划清界限"真的生效了
//    ② [loadDebt] 打出两跳日志：第一跳命中谁 → 第二跳几单未结清
//       → 账龄几天。这个账龄是**算出来的**，ERP 里没有这个字段
//    ③ 高风险才走到 draftMessage；低风险直接 END，不产草稿
//    ④ 客户不存在时，日志只跑到 loadDebt 就停 ——
//       classify / draftMessage 那两笔 AI 的钱根本没花
//
//  值得做的实验：
//    实验 A：问「帮我催一下王五的款」（12 天 / 低风险）——
//      条件边把 draftMessage 挡住了，一次都不出现。
//      工具返回带 outcome:'skipped' + note，AI 应如实说"本期不催收"。
//    实验 B：问「帮我催一下赵六的款」（不存在）——
//      loadDebt 第一跳就 throw，最外层 catch 把它转成
//      { found:false, message:'未找到客户「赵六」的欠款记录' }，
//      AI 应回"没找到"，**绝不能出现任何草稿**。
//    实验 C：把 .env 的 DEEPSEEK_API_KEY 改错一个字符重跑 ——
//      会看到"AI 判断失败→规则兜底"和"AI 生成失败→模板兜底"
//      两次降级，流程照样跑完。这就是为什么**判断和生成都必须有兜底**。
// ════════════════════════════════════════════════════════════
