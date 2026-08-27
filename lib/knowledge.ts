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
 *  你需要实现 2 个 TODO：ingestDocument（入库）+ retrieve（检索）
 *  其余函数已给完整实现，照着用即可。
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
interface Chunk {
  id: string;
  text: string;
  embedding: number[];
  source: string;
  chunkIndex: number;
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
  // 1. 切分文档
  const chunks = splitText(text);
  if (chunks.length === 0) return 0;

  // 2. 批量向量化（一次 API 调用搞定所有片段，省时省钱）
  const embeddings = await createEmbeddings(chunks);

  // 3. 存入内存向量库（chunks[i] 对应 embeddings[i]）
  for (let i = 0; i < chunks.length; i++) {
    vectorStore.push({
      id: `${source}-${i}`,
      text: chunks[i],
      embedding: embeddings[i],
      source,
      chunkIndex: i,
    });
  }

  return chunks.length;
}

// ============================================================
//  5. 检索 Top-K（TODO · 你来实现）
// ============================================================
//  用户提问 → 转向量 → 跟库里的每个 chunk 比相似度 → 取最相关的 K 个
//
//  步骤：
//    1. 用 createEmbedding(query) 把问题转向量
//    2. 遍历 vectorStore，对每个 chunk 算 cosineSimilarity(queryVec, chunk.embedding)
//    3. 把 (chunk, 相似度) 配对，按相似度从高到低排序
//    4. 取前 topK 个 chunk 返回
//    5. 如果 vectorStore 为空，直接返回 []
//
//  提示：
//    - 用数组的 map + sort + slice 组合
//    - 返回的是 Chunk[]，不带相似度分数
export async function retrieve(query: string, topK = 3): Promise<Chunk[]> {
  // 库为空直接返回，避免做无用功
  if (vectorStore.length === 0) return [];

  // 1. 问题转向量
  const queryVec = await createEmbedding(query);

  // 2. 跟库里的每个 chunk 算相似度，配成对
  const scored = vectorStore.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryVec, chunk.embedding),
  }));

  // 3. 按相似度从高到低排序
  scored.sort((a, b) => b.score - a.score);

  // 4. 取前 topK 个返回（不带分数，只返回 chunk）
  return scored.slice(0, topK).map((s) => s.chunk);
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
