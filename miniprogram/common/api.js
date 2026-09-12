// wholesale-agent 后端地址
// 本地开发：next dev 默认 http://localhost:3000（开发者工具需勾选「不校验合法域名」）
// 真机调试：改成电脑的局域网 IP，如 http://192.168.1.100:3000
const BASE_URL = 'http://localhost:3000'

export const TOKEN_KEY = 'site_token'

// 不依赖小程序对 Set-Cookie 的自动管理（模拟器热重载后、真机上都会丢），
// 登录成功后显式存 token，每个请求手动携带 x-site-token 头
function authHeader() {
  const token = uni.getStorageSync(TOKEN_KEY) || ''
  return token ? { 'x-site-token': token } : {}
}

function goLogin() { 
  uni.removeStorageSync(TOKEN_KEY)
  uni.reLaunch({ url: '/pages/login/login' })
} 

export function login(password) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${BASE_URL}/api/login`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { password },
      success: (res) => {
        if (res.statusCode === 200) {
          uni.setStorageSync(TOKEN_KEY, password)
          resolve(res.data)
        } else {
          reject(new Error((res.data && res.data.error) || '登录失败'))
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '网络错误，请确认后端已启动')),
    })
  })
}

export function checkLogin() {
  return new Promise((resolve) => {
    uni.request({
      url: `${BASE_URL}/api/me`,
      header: authHeader(),
      success: (res) => resolve(!!(res.data && res.data.loggedIn)),
      fail: () => resolve(false),
    })
  })
}

// 小程序没有 TextDecoder，手动解码 UTF-8；
// 并处理中文多字节字符被切在 chunk 边界的情况（不完整字节留到下一个 chunk）
function createUtf8Decoder() {
  let leftover = new Uint8Array(0)

  function utf8Decode(bytes) {
    let out = ''
    let i = 0
    while (i < bytes.length) {
      const b = bytes[i]
      if (b < 0x80) {
        out += String.fromCharCode(b)
        i += 1
      } else if ((b & 0xe0) === 0xc0) {
        out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
        i += 2
      } else if ((b & 0xf0) === 0xe0) {
        out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
        i += 3
      } else {
        out += String.fromCodePoint(
          ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
        )
        i += 4
      }
    }
    return out
  }

  return {
    decode(buffer) {
      const incoming = new Uint8Array(buffer)
      const all = new Uint8Array(leftover.length + incoming.length)
      all.set(leftover, 0)
      all.set(incoming, leftover.length)

      // 从尾部回看最多 4 字节，找出最后一个完整 UTF-8 序列的边界
      let cut = all.length
      for (let i = all.length - 1, n = 0; i >= 0 && n < 4; i--, n++) {
        const b = all[i]
        if (b < 0x80) break
        if ((b & 0xc0) !== 0x80) {
          const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2
          cut = all.length - i >= need ? all.length : i
          break
        }
        if (n === 3) cut = i
      }
      leftover = all.slice(cut)
      return utf8Decode(all.subarray(0, cut))
    },
  }
}

// 后端 /api/chat 返回 Vercel AI SDK v3 的流（toAIStreamResponse 协议，实测格式）。
// 注意：不是 SSE，没有 data: 前缀！每行是「类型码:JSON」：
//   0:"增量文本"      → 文本 chunk（负载是 JSON 字符串，换行/引号是转义过的）
//   e:{...} d:{...}   → 错误/完成事件
//   工具调用走其他类型码，Agent 多步执行时正文会分多段以 0: 行继续推送
// 行可能被拆在两个 chunk 里，按 \n 拆行并把末行留缓冲
export function chatStream(messages, { onText, onDone, onError }) {
  const decoder = createUtf8Decoder()
  let sseBuffer = ''

  const task = uni.request({
    url: `${BASE_URL}/api/chat`,
    method: 'POST',
    header: { 'Content-Type': 'application/json', ...authHeader() },
    data: { messages },
    enableChunked: true,
    success: (res) => {
      if (res.statusCode === 401) {
        onError && onError(new Error('登录态失效，请重新登录'))
        goLogin()
        return
      }
      onDone && onDone()
    },
    fail: (err) => onError && onError(new Error(err.errMsg || '网络错误')),
  })

  task.onChunkReceived((res) => {
    sseBuffer += decoder.decode(res.data)
    const lines = sseBuffer.split('\n')
    sseBuffer = lines.pop() || ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('0:')) continue
      const payload = line.slice(2).trim()
      if (!payload) continue
      try {
        // 0:"我" → JSON.parse('"我"') → "我"，转义的 \n、\" 一并还原
        const text = JSON.parse(payload)
        if (typeof text === 'string') onText && onText(text)
      } catch (e) {
        // 跳过无法解析的行
      }
    }
  })

  return task
}
