// ── 第 8 步：再加一个 AI 节点 —— 这次是「生成」，不是「判断」 ────
//
// step7 加的 classify 是**判断类**节点：从有限的几个答案里挑一个。
// 这一步加的 draftMessage 是**生成类**节点：写一段原本不存在的话。
//
// 两类节点的写法差别很大，这轮的重点就是把这个差别看清：
//
//              判断节点 classify        生成节点 draftMessage
//   任务        从有限集合里选一个        写一段自由文本
//   temperature 0（要稳定）              0.8（要自然，不能每次都一样）
//   输出格式    必须严格 JSON            自由文本，不需要 JSON
//   白名单      需要（只认 high/normal）  不需要（哪有什么"合法文案"）
//   出错的样子  判错等级                  写得不像人话 / 写太长
//   兜底方式    退回规则版                退回模板版
//
// ────────────────────────────────────────────────────────────
// ★ 本轮唯一的设计决策（比代码重要）：**话术节点放在人审之前**
//
//   正确：classify → draftMessage → humanApprove
//   错误：classify → humanApprove → draftMessage
//
//   为什么？因为"人审"审的必须是**最终要发出去的那段原文**。
//   如果先让人点"同意"、再让 AI 写，那人最后看到的是自己没审过的东西
//   —— 这个"审"就是走过场。
//
//   一句话：**审的对象，必须是最终发出去的东西。**
// ────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';

// ════════════════════════════════════════════════════════════
//  ⓪ 准备：读 .env 拿 API key（跟 step7 完全一样）
// ════════════════════════════════════════════════════════════

function loadEnv(): Record<string, string> {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('找不到 .env 文件，试过：' + candidates.join(' / '));

  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(found, 'utf-8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) throw new Error('.env 里没有 DEEPSEEK_API_KEY');

// ════════════════════════════════════════════════════════════
//  ① AI 调用口 —— ★ 这一步它变了
//
//  step7 里它是写死的：temperature 固定 0、固定要求 JSON。
//  那是为 classify 量身定做的，draftMessage 用不了：
//    - 写文案要 temperature 高一点，否则每次生成的都一模一样
//    - 写文案不能要 JSON，我们要的就是一段能直接发的话
//
//  所以改成"带选项"的版本：
//    不传 opts → 判断类默认（稳定 + JSON）
//    传 opts   → 按需覆盖
//
//  这就是"通用件"成长的过程：一开始只有一个人用，等第二个用户
//  来了，才把差异抽成参数。提前设计反而是过度设计。
// ════════════════════════════════════════════════════════════

async function callDeepSeek(
  prompt: string,
  opts: { temperature?: number; json?: boolean; system?: string } = {},
): Promise<string> {
  const {
    temperature = 0,
    json = false,
    system = '你是批发行业的资深业务员。',
  } = opts;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature,
      // json 为 true 时才带这个参数 —— 生成文案时不需要
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`DeepSeek 返回 ${res.status}：${(await res.text()).slice(0, 120)}`);
  }

  const data: any = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';

  const u = data.usage;
  if (u) console.log(`     （AI 用量：输入 ${u.prompt_tokens} + 输出 ${u.completion_tokens} tokens）`);

  return text;
}

// ════════════════════════════════════════════════════════════
//  ② 判断节点：classify —— 跟 step7 一模一样，没动过
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
    const text = await callDeepSeek(prompt, {
      temperature: 0,
      json: true,
      system: '你是批发行业的风控助手。只输出 JSON，不要任何解释文字。',
    });
    const parsed = JSON.parse(text);

    const risk = parsed.risk === 'high' ? 'high' : 'normal';
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '（AI 未给理由）';

    return { risk, reason, judgedBy: 'ai' };
  } catch (e: any) {
    console.log(`     ⚠ AI 判断失败（${e.message.slice(0, 60)}），降级为规则判断`);
    return classifyByRule(state);
  }
}

// ════════════════════════════════════════════════════════════
//  ③ ★ 新节点：draftMessage —— 生成催款话术
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
    const text = await callDeepSeek(prompt, {
      temperature: 0.8,
      json: false,
      system: '你是批发行业的资深业务员，擅长写不伤和气又能要到钱的消息。',
    });

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
//  ④ 其余节点：loadDebt / recordRejection 原样不动
//     humanApprove 有一处必须改 —— 往下看
// ════════════════════════════════════════════════════════════

function loadDebt(_state: any) {
  return { customer: '张三建材', amount: 86000, days: 92, contacted: 2 };
}

// ★ humanApprove 改了：现在要把「即将发出的原文」摆给人看
//
//  为什么这个改动是**必然**的？因为人审节点的职责是
//  "让人对着最终产物做决定"。上游多了 message，它就得展示 message。
//
//  注意：改它不是因为"图变了"，而是因为**上游的数据变了**。
//  节点之间是通过 state 传话的 —— 上游往 state 里多放一个字段，
//  下游就有机会看到。这跟"图的结构"是两码事。
async function humanApprove(state: any) {
  console.log('  ┌─ 请确认 ─────────────────────────────');
  console.log(`  │ 客户：${state.customer}`);
  console.log(`  │ 欠款：${state.amount}`);
  console.log(`  │ 理由：${state.reason}`);
  console.log(`  │ 判断来源：${state.judgedBy === 'ai' ? 'AI' : '规则兜底'}`);
  console.log('  ├─ 即将发出的原文 ────────────────────');
  // 文案里若有换行，每一行都加上左边的竖线，保持框对齐
  for (const line of String(state.message ?? '').split('\n')) {
    console.log('  │ ' + line);
  }
  console.log('  └──────────────────────────────────────');

  const answer = await ask('  同意发送？(y/n) ');
  const yes = answer.toLowerCase().startsWith('y');
  console.log(`  ── 你的回答：${answer} → ${yes ? '同意' : '拒绝'}`);
  return { approved: yes };
}

function recordRejection(_state: any) {
  console.log('     （已记录：本次暂不催收，转业务员跟进）');
  return {};
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

// ════════════════════════════════════════════════════════════
//  ⑤ 组装图 —— 看 edges，改动只有两行
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
edges.set('humanApprove', (state: any) => (state.approved ? END : 'recordRejection'));
edges.set('recordRejection', END);

// 引擎：跟 step6/step7 完全一样，一个字没改
async function main() {
  let current = 'loadDebt';
  const state: any = {};

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
}

main();

// ════════════════════════════════════════════════════════════
//  ⑥ 跑一遍看什么
//
//  敲 y（同意发送）应当看到这条链路：
//     loadDebt → classify（AI 判断）→ draftMessage（AI 写话）
//       → humanApprove（你看到原文，点头）→ END
//
//  三个观察点：
//    ① 会出现**两次**「AI 用量」—— 判断一次、生成一次。
//       每个 AI 节点都是一笔钱，节点越多越贵。
//    ② humanApprove 的框里多了「即将发出的原文」。
//       这就是"审"的正确姿势：人对着**最终产物**做决定。
//    ③ 最终状态里有 message / draftedBy 两个新字段。
//
//  值得做的实验：
//    实验 A：把 days 从 92 改成 60 重跑 ——
//      低风险直接 END，**draftMessage 一次都不出现**。
//      说明"写话术"这个节点被条件边挡住了，AI 的钱省下来了。
//
//    实验 B：把 key 改错重跑 ——
//      会看到"AI 判断失败→规则兜底"和"AI 生成失败→模板兜底"
//      两次降级，流程照样跑完，人照样能看到一段（难看的）文案。
//      这就是为什么**判断和生成都必须有兜底**。
// ════════════════════════════════════════════════════════════
