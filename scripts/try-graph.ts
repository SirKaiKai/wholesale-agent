import { runGraph } from "../lib/collection-workflow";
import * as readline from 'node:readline/promises';

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function main() {
  // 1跑图
  const state: any = await runGraph({ name: '李四' });
  //2需人审核
  if (state.needsApproval) {
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
  }
}
main().catch((err) => console.error('跑挂了：', err));