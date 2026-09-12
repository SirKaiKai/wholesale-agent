/**
 * ============================================================
 *  RAG 效果评测脚本（Recall@k）
 * ============================================================
 *  作用：用一组"问题 → 期望命中文档"的用例，量化检索质量。
 *        Recall@k = 前 k 个结果里命中期望文档的用例占比。
 *        值越接近 1 越好；k 越小越严格（top-1 命中最难）。
 *
 *  跑法（项目根目录）：
 *    # 需先配好硅基流动 key（embedding + rerank 都用它）
 *    set SILICONFLOW_API_KEY=你的key        # Windows
 *    # export SILICONFLOW_API_KEY=你的key   # macOS / Linux
 *    npx tsx scripts/eval-rag.ts
 *
 *  说明：本评测走完整管线（向量召回 + 关键词 + RRF + 重排序），
 *        因此必须能访问硅基流动 API；未配 key 会友好退出。
 * ============================================================
 */
import { ensureIngested, retrieve } from '../lib/knowledge';

// 用例集：query 是用户可能问的话，expect 是"答案应该来自哪篇文档"
// 这里用 knowledge-base/ 里真实的三篇 md 文件名作为期望 source
const CASES: { query: string; expect: string }[] = [
  { query: '退货需要满足什么条件', expect: 'return-policy.md' },
  { query: '退款一般多久能到账', expect: 'return-policy.md' },
  { query: '退货的运费谁承担', expect: 'return-policy.md' },
  { query: '新客户有账期吗', expect: 'credit-policy.md' },
  { query: '客户超期不付款怎么催', expect: 'credit-policy.md' },
  { query: '账期最长能申请多少天', expect: 'credit-policy.md' },
  { query: 'A级客户有什么权益', expect: 'customer-level.md' },
  { query: '客户等级怎么升级', expect: 'customer-level.md' },
  { query: '连续两个月不达标会怎样', expect: 'customer-level.md' },
];

// 计算 Recall@k：每个用例看"期望文档"是否出现在前 k 个结果里（按 source 判）
// results 与 CASES 一一对应；Recall@k = 命中用例数 / 总用例数
function recallAtK(results: { sources: string[]; expect: string }[], k: number): number {
  const hits = results.filter((r) => r.sources.slice(0, k).includes(r.expect)).length;
  return hits / results.length;
}

async function main() {
  if (!process.env.SILICONFLOW_API_KEY) {
    console.error('✗ 未检测到 SILICONFLOW_API_KEY，无法跑完整管线评测。');
    console.error('  请先配置：set SILICONFLOW_API_KEY=你的key（Windows）');
    process.exit(1);
  }

  console.log(`[Eval] 加载知识库并入库（${CASES.length} 条用例）...`);
  await ensureIngested();

  const results: { sources: string[]; expect: string }[] = [];
  for (const c of CASES) {
    const hits = await retrieve(c.query, { topK: 5 });
    const sources = hits.map((h) => h.source);
    results.push({ sources, expect: c.expect });
    const ok = sources.includes(c.expect);
    console.log(
      `${ok ? '✓' : '✗'} "${c.query}" → [${sources.join(', ')}]` +
        (ok ? '' : `  （期望：${c.expect}）`),
    );
  }

  console.log('\n========== Recall@k ==========');
  for (const k of [1, 3, 5]) {
    const r = recallAtK(results, k);
    console.log(`Recall@${k}: ${(r * 100).toFixed(1)}%`);
  }
  console.log('==============================');
}

main().catch((e) => {
  console.error('评测出错：', e);
  process.exit(1);
});
