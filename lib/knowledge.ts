import { createOpenAI } from '@ai-sdk/openai';
import { embed, embedMany } from 'ai';
import fs from 'fs';
import path from 'path';

/**
 * ============================================================
 *  RAG 知识库模块
 * ============================================================
 *  让你的 Agent 能回答"私有知识"问题。
 *  流程：文档切分 → Embedding 向量化 → 入库 → 检索 → 注入 Prompt
 *
 *  本文件用"内存向量库"做演示，配 SILICONFLOW_API_KEY 即可跑通。
 *  生产环境可升级为 Chroma / Pinecone（见 RAG-GUIDE.md）。
 *
 *  Embedding 使用硅基流动（SiliconFlow）的 BAAI/bge-m3 模型：
 *  - 国内可直接访问，无需翻墙
 *  - 兼容 OpenAI 接口格式，代码改动最小
 *  - bge-m3 模型免费，注册即送额度
 *  - 注册地址：https://siliconflow.cn
 *
 *  当前状态：
 *    - ingestDocument（入库）、retrieve（检索）均已完整实现，可直接跑通
 *    - 混合检索已实现：向量召回 + 关键词召回(AND语义) + RRF 融合（见第 5 节）
 *    - 重排序已实现：融合 top-20 → bge-reranker-v2-m3 精排 → topK（见 retrieve 内）
 *    - 生产可升级：Chroma 向量库持久化 + 管理后台热更新（见 RAG-GUIDE.md）
 * ============================================================
 */

// 硅基流动客户端（国内可直连，兼容 OpenAI 接口，BAAI/bge-m3 免费）
// DeepSeek 没有 embedding API，这里用硅基流动的 bge-m3 做向量化
const siliconflow = createOpenAI({
  baseURL: 'https://api.siliconflow.cn/v1',
  apiKey: process.env.SILICONFLOW_API_KEY,
});
const embeddingModel = siliconflow.embedding('BAAI/bge-m3');

// ===== 内存向量库（学习用，重启会丢失；生产环境换 Chroma）=====
interface ChunkMeta {
  category?: string; // 文档大类：售后政策 / 财务政策 / 客户管理 …
  tags?: string[];    // 业务标签：退货 / 账期 / 客户等级 …（用于元数据过滤）
}

interface Chunk {
  id: string;
  text: string;
  embedding: number[];
  source: string;
  chunkIndex: number;
  metadata: ChunkMeta; // 元数据：检索前可先按 category / tags 预筛
}

// ===== 元数据：解析 md 文档顶部的 frontmatter（可选）=====
//  格式：
//    ---
//    category: 售后政策
//    tags: [退货, 退款, 运费]
//    ---
//  没有 frontmatter 时，从文件名兜底推导 category（如 return-policy.md → "return-policy"）
function parseFrontmatter(text: string): { meta: ChunkMeta; body: string } {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { meta: {}, body: text };

  const meta: ChunkMeta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const val = kv[2].trim();
    if (key === 'category') meta.category = val;
    if (key === 'tags') {
      // 支持 [a, b, c] 或 a, b, c 两种写法
      meta.tags = val
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

const vectorStore: Chunk[] = [];
let isIngested = false;

// ============================================================
//  1. 文档切分（完整实现，直接用）
// ============================================================
//  把长文档切成小片段，每片约 chunkSize 字符，相邻片之间有 overlap
//  防止把一个完整意思切到两个片里。
export function splitText(text: string, chunkSize = 300, overlap = 50): string[] {
  const cleanText = text.replace(/\r\n/g, '\n').trim();
  if (cleanText.length <= chunkSize) return [cleanText];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleanText.length) {
    const end = Math.min(start + chunkSize, cleanText.length);
    const chunk = cleanText.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= cleanText.length) break;
    start += chunkSize - overlap; // 带 overlap 滑动窗口
  }
  return chunks;
}

// ============================================================
//  2. 生成 Embedding（完整实现，直接用）
// ============================================================
//  把文本转成 1024 维向量，语义相近的文本向量也相近
//  这是 RAG 能"按意思检索"的基础（bge-m3 输出 1024 维）
export async function createEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel,
    value: text,
  });
  return embedding;
}

// 批量生成（入库时用，减少 API 调用次数）
export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: texts,
  });
  return embeddings;
}

// ============================================================
//  3. 余弦相似度（完整实现，直接用）
// ============================================================
//  衡量两个向量的"方向"有多接近，值越接近 1 越相似
//  RAG 检索就是用这个找最相关的文档片段
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ============================================================
//  4. 文档入库（TODO · 你来实现）
// ============================================================
//  把一篇文档切分、向量化、存进 vectorStore
//
//  步骤：
//    1. 用 splitText(text) 把文档切成 chunks
//    2. 用 createEmbeddings(chunks) 批量生成向量
//    3. 遍历 chunks，每个造一个 Chunk 对象 push 进 vectorStore
//       - id 用 `${source}-${chunkIndex}`
//       - text 是切片内容
//       - embedding 是对应向量
//       - source 和 chunkIndex 填进去
//    4. 返回入库的 chunk 数量
//
//  提示：
//    - chunks 和 embeddings 数组长度一样，按下标对应
//    - 可以 console.log 看进度
export async function ingestDocument(text: string, source: string): Promise<number> {
  // 1. 解析 frontmatter（有则取 category/tags，无则 body 原样）
  const { meta, body } = parseFrontmatter(text);
  // 文件名兜底：没有 category 时，拿文件名（去 .md）当 category
  const fallbackCategory = source.replace(/\.md$/i, '');
  const finalMeta: ChunkMeta = {
    category: meta.category ?? fallbackCategory,
    tags: meta.tags ?? [],
  };

  // 2. 切分文档
  const chunks = splitText(body);
  if (chunks.length === 0) return 0;

  // 3. 批量向量化（一次 API 调用搞定所有片段，省时省钱）
  const embeddings = await createEmbeddings(chunks);

  // 4. 存入内存向量库（chunks[i] 对应 embeddings[i]）
  for (let i = 0; i < chunks.length; i++) {
    vectorStore.push({
      id: `${source}-${i}`,
      text: chunks[i],
      embedding: embeddings[i],
      source,
      chunkIndex: i,
      metadata: finalMeta,
    });
  }

  return chunks.length;
}

// ============================================================
//  5. 混合检索（RAG 深化 · 已实战实现，见 lexicalScore / rrfFuse）
// ============================================================
//  纯向量对「张三」「单号A123」这类精确词常翻车 —— 向量是"模糊语义"，把专名稀释了。
//  加一路"关键词召回"，用 RRF（倒数排名融合）把两路合并 → 精确词 + 语义词都顾上。
//
//  已实现：
//    - lexicalScore(query, chunkText): 中文近似 BM25 的关键词命中率，返回 0~1（AND 语义版）
//    - rrfFuse(vectorResults, lexicalResults): 用"排名"而非"分数"融合两路，k=60

// ① 关键词召回（中文近似 BM25）
//   思路：query 里出现的字，在 chunkText 里占比越高，分越接近 1。
//   坑：单字「张」可能误命中不相关文档 → 缓解二选一：
//        a) 要求 query【所有字都命中】才算（AND 语义）
//        b) 改用 2-gram（"张三"拆成"张"+"三"相邻组合）更稳
//   返回 0~1
export function lexicalScore(query: string, chunkText: string): number {
  // AND 版（优化版）：query 的每个【实义字】都必须在 chunk 里出现，才算命中 → 返回 1；
  //        只要有一个实义字没出现，整句判不相关 → 返回 0。
  //   为什么比 v1 好：v1 字符命中率会让单字"张"在不相关文档误命中拉高分；
  //        AND 强制"全中才相关"，专名（张三/单号A123）检索更准、不稀释。
  //   停用词：去掉"的/了/吗"等无实义字，避免它们没在文档出现而整句误判为不相关。

  // 1. 取 query 实义字（去标点 + 去停用词）
  const STOP = new Set(['的', '了', '吗', '呢', '怎', '么', '如', '何', '是', '在', '和', '与', '或']);
  const qChars = query
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
    .split('')
    .filter((ch) => !STOP.has(ch));
  if (qChars.length === 0) return 0;

  // 2. AND 判断：任一字未命中 → 整句不相关
  for (const ch of qChars) {
    if (!chunkText.includes(ch)) return 0;
  }
  return 1;
}

// ② RRF 融合（倒数排名融合 Reciprocal Rank Fusion）
//   两路各自带 rank（第 1 名 rank=0，第 2 名 rank=1 …），融合分 = Σ 1/(k+rank)，k=60
//   为什么用"排名"不用"原始分数"：
//     向量分是 0~1 余弦、关键词分是 0~1 命中率，尺度不同，直接相加会被数值大的那路主导；
//     换成排名，两路都变成"第几名"，天然公平。
//   去重：同一 chunk 在两路都出现时，融合分累加。
//   返回：按融合分降序的 Chunk[]
export function rrfFuse(vectorResults: Chunk[], lexicalResults: Chunk[], k = 60): Chunk[] {
  const map = new Map<string, { chunk: Chunk; score: number }>();
  const add = (list: Chunk[]) => {
    list.forEach((chunk, rank) => {
      const addScore = 1 / (k + rank);
      const cur = map.get(chunk.id);
      if (cur) cur.score += addScore;
      else map.set(chunk.id, { chunk, score: addScore });
    });
  };
  add(vectorResults);
  add(lexicalResults);
  return Array.from(map.values())
    .sort((a, b) => b.score - a.score)
    .map((v) => v.chunk);
}

// ============================================================
//  5.5 重排序（RAG 深化 · 生产标配）
// ============================================================
//  为什么要重排序？向量召回是"双塔"模型，只看 query 和文档的语义距离，粗但快，
//  容易把"字面不像但答案就在其中"的块排到后面、把"语义像但答非所问"的块排前面。
//  reranker 是"交叉编码器"：把 query + 文档拼在一起过模型，理解深度远超双塔，能精准重排。
//  策略：只对融合后的 top-20 候选跑（不碰全库），又快又准。
//  模型：BAAI/bge-reranker-v2-m3（硅基流动，国内直连，与 bge-m3 同家，免费）
//  安全：未配 key 或接口异常时自动回退融合结果，知识库永不整挂。
export async function rerankChunks(query: string, candidates: Chunk[]): Promise<Chunk[]> {
  // 候选 ≤1 无需排序
  if (candidates.length <= 1) return candidates;

  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    console.warn('[RAG] 未配置 SILICONFLOW_API_KEY，跳过重排序（回退融合结果）');
    return candidates;
  }

  try {
    const resp = await fetch('https://api.siliconflow.cn/v1/rerank', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'BAAI/bge-reranker-v2-m3',
        query,
        documents: candidates.map((c) => c.text),
      }),
    });
    if (!resp.ok) {
      console.warn(`[RAG] 重排序接口异常 ${resp.status}，回退融合结果`);
      return candidates;
    }
    const data = (await resp.json()) as {
      results?: { index: number; relevance_score: number }[];
    };
    if (!data.results || data.results.length === 0) return candidates;
    // results 按相关性降序；用 index 映射回候选 chunk
    return data.results
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map((r) => candidates[r.index])
      .filter((c): c is Chunk => Boolean(c));
  } catch (e) {
    console.warn('[RAG] 重排序失败，回退融合结果：', (e as Error).message);
    return candidates;
  }
}

// 元数据过滤条件：检索前先按 category / tags 预筛 vectorStore
export interface RetrieveFilter {
  category?: string;        // 精确匹配大类，如 "售后政策"
  tags?: string[];          // 命中任意一个 tag 即保留（OR 语义）
}

export interface RetrieveOptions {
  topK?: number;            // 返回片段数，默认 3
  filter?: RetrieveFilter;  // 元数据预筛（先过滤再打分，缩小候选、提准）
  dedupeBySource?: boolean; // 同文档去重：每个 source 只保留最相关 1 片，默认 true
}

// 按 filter 预筛候选库（无 filter 返回全库）
function applyFilter(filter?: RetrieveFilter): Chunk[] {
  if (!filter) return vectorStore;
  const { category, tags } = filter;
  return vectorStore.filter((c) => {
    if (category && c.metadata.category !== category) return false;
    if (tags && tags.length > 0) {
      const set = new Set(c.metadata.tags ?? []);
      // OR 语义：命中任意一个 tag 即可
      if (!tags.some((t) => set.has(t))) return false;
    }
    return true;
  });
}

// 同文档去重：rerank 后每个 source 只保留最相关的第一片，避免长文档多片挤占 top-K
function dedupeBySource(chunks: Chunk[], topK: number): Chunk[] {
  const seen = new Set<string>();
  const out: Chunk[] = [];
  for (const c of chunks) {
    if (!seen.has(c.source)) {
      seen.add(c.source);
      out.push(c);
    }
    if (out.length >= topK) return out;
  }
  // 去重后不足 topK，用剩余不同 source 补齐（理论上不会进这里，保险用）
  return out;
}

export async function retrieve(
  query: string,
  options: RetrieveOptions = {},
): Promise<Chunk[]> {
  const { topK = 3, filter, dedupeBySource: doDedupe = true } = options;

  // ① 元数据预筛：先把候选库缩小到相关范围（如只看"售后政策"）
  const candidatePool = applyFilter(filter);
  if (candidatePool.length === 0) return [];

  const queryVec = await createEmbedding(query);

  // —— 纯向量基线（改之前的逻辑，保留供对比）——
  // const scored = candidatePool
  //   .map((c) => ({ chunk: c, score: cosineSimilarity(queryVec, c.embedding) }))
  //   .sort((a, b) => b.score - a.score)
  //   .slice(0, topK)
  //   .map((s) => s.chunk);

  // 路一：向量召回 top-20（在筛选后的候选池里）
  const vectorScored = candidatePool
    .map((c) => ({ chunk: c, score: cosineSimilarity(queryVec, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((s) => s.chunk);

  // 路二：关键词召回 top-20（在筛选后的候选池里）
  const lexicalScored = candidatePool
    .map((c) => ({ chunk: c, score: lexicalScore(query, c.text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((s) => s.chunk);

  // 两路融合 → 候选 top-20
  const fused = rrfFuse(vectorScored, lexicalScored).slice(0, 20);

  // —— 对照日志（重排序前）：融合后 top-5 的 source ——
  console.log('[RAG] 融合后 top-5:', fused.slice(0, 5).map((c) => c.source).join(' | '));

  // 重排序：交叉编码器精排 → topK
  const reranked = await rerankChunks(query, fused);

  // 同文档去重：每个 source 只留最相关 1 片
  const final = doDedupe ? dedupeBySource(reranked, topK) : reranked.slice(0, topK);

  // —— 对照日志（重排序后 / 去重后）：topK 的 source ——
  console.log(`[RAG] 重排序+去重后 top-${topK}:`, final.map((c) => c.source).join(' | '));

  return final;
}

// ============================================================
//  6. 组装上下文（完整实现，直接用）
// ============================================================
//  把检索到的 chunks 拼成一段文字，后续会塞进 system prompt
export function buildContext(results: Chunk[]): string {
  if (results.length === 0) return '';
  const context = results
    .map((r, i) => `[${i + 1}] 来源：${r.source}\n${r.text}`)
    .join('\n\n---\n\n');
  return `\n\n【知识库参考】\n以下是检索到的相关资料，请优先基于这些内容回答：\n\n${context}\n\n回答时请标注资料来源。`;
}

// ============================================================
//  7. 初始化：从 knowledge-base/ 加载所有文档（完整实现）
// ============================================================
//  应用首次调用时触发，把 knowledge-base/*.md 全部入库
//  用 isIngested 标记保证只执行一次
export async function ensureIngested(): Promise<void> {
  if (isIngested) return;

  const kbDir = path.join(process.cwd(), 'knowledge-base');
  if (!fs.existsSync(kbDir)) {
    console.warn('[RAG] knowledge-base/ 目录不存在，跳过知识库加载');
    isIngested = true;
    return;
  }

  const files = fs.readdirSync(kbDir).filter((f) => f.endsWith('.md'));
  if (files.length === 0) {
    console.warn('[RAG] knowledge-base/ 没有 .md 文件');
    isIngested = true;
    return;
  }

  console.log(`[RAG] 发现 ${files.length} 个文档，开始入库...`);
  for (const file of files) {
    const filePath = path.join(kbDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const count = await ingestDocument(content, file);
    console.log(`[RAG] ${file} → ${count} 个片段`);
  }

  isIngested = true;
  console.log(`[RAG] 知识库就绪，共 ${vectorStore.length} 个片段`);
}

// 暴露 Chunk 类型给 route.ts 用
export type { Chunk };
