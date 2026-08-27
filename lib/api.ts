// lib/api.ts —— 统一 API 请求层
// 改域名 / 加鉴权 / 加超时 / 统一错误处理 —— 只改这一个文件

// 默认本地开发；生产环境由 chat 路由注入实际域名（见 setApiBase）
let BASE_URL = (process.env.DATA_API_BASE || 'http://localhost:3000/api/mock').replace(/\/+$/, '');
const TOKEN = process.env.DATA_API_TOKEN;
const TIMEOUT_MS = 10_000;

/**
 * 部署适配：mock 数据接口与站点同域时，注入当前请求的域名。
 * 若 .env 配了 DATA_API_BASE（未来接真实企业 API），则以环境变量优先，注入不生效。
 */
export function setApiBase(url: string) {
  if (process.env.DATA_API_BASE) return;
  BASE_URL = url.replace(/\/+$/, '');
}

// 统一错误对象：LLM 直接读中文信息就知道发生了什么
export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

// 内部唯一请求入口
async function request<T>(path: string, options: { query?: Record<string, string | number> } = {}): Promise<T> {
  // ① 拼 URL：query 用 URLSearchParams 自动编码，中文/特殊字符不用手管
  const url = new URL(BASE_URL + path);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, String(value));
    }
  }

  // ② 超时控制
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
      signal: controller.signal,
    });

    // ③ HTTP 状态错误：把接口返回的 error 透传（如 401 未授权）
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body.error || body.message || '';
      } catch { /* 响应不是 JSON 就跳过 */ }
      throw new ApiError(`数据接口 ${res.status}${detail ? '：' + detail : ''}`, res.status);
    }

    return (await res.json()) as T;
  } catch (err) {
    // ④ 错误分类：超时 / 网络断连 / 其他 —— 全部转成 LLM 能看懂的中文
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(`数据接口请求超时（${TIMEOUT_MS / 1000} 秒无响应）`);
    }
    throw new ApiError(`数据接口网络错误：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

// 对外暴露的方法（工具层只用这个）
export function apiGet<T>(path: string, query?: Record<string, string | number>): Promise<T> {
  return request<T>(path, { query });
}
