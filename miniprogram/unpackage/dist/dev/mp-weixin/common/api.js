"use strict";
const common_vendor = require("./vendor.js");
const BASE_URL = "http://localhost:3000";
const TOKEN_KEY = "site_token";
function authHeader() {
  const token = common_vendor.index.getStorageSync(TOKEN_KEY) || "";
  return token ? { "x-site-token": token } : {};
}
function goLogin() {
  common_vendor.index.removeStorageSync(TOKEN_KEY);
  common_vendor.index.reLaunch({ url: "/pages/login/login" });
}
function login(password) {
  return new Promise((resolve, reject) => {
    common_vendor.index.request({
      url: `${BASE_URL}/api/login`,
      method: "POST",
      header: { "Content-Type": "application/json" },
      data: { password },
      success: (res) => {
        if (res.statusCode === 200) {
          common_vendor.index.setStorageSync(TOKEN_KEY, password);
          resolve(res.data);
        } else {
          reject(new Error(res.data && res.data.error || "登录失败"));
        }
      },
      fail: (err) => reject(new Error(err.errMsg || "网络错误，请确认后端已启动"))
    });
  });
}
function checkLogin() {
  return new Promise((resolve) => {
    common_vendor.index.request({
      url: `${BASE_URL}/api/me`,
      header: authHeader(),
      success: (res) => resolve(!!(res.data && res.data.loggedIn)),
      fail: () => resolve(false)
    });
  });
}
function createUtf8Decoder() {
  let leftover = new Uint8Array(0);
  function utf8Decode(bytes) {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      if (b < 128) {
        out += String.fromCharCode(b);
        i += 1;
      } else if ((b & 224) === 192) {
        out += String.fromCharCode((b & 31) << 6 | bytes[i + 1] & 63);
        i += 2;
      } else if ((b & 240) === 224) {
        out += String.fromCharCode((b & 15) << 12 | (bytes[i + 1] & 63) << 6 | bytes[i + 2] & 63);
        i += 3;
      } else {
        out += String.fromCodePoint(
          (b & 7) << 18 | (bytes[i + 1] & 63) << 12 | (bytes[i + 2] & 63) << 6 | bytes[i + 3] & 63
        );
        i += 4;
      }
    }
    return out;
  }
  return {
    decode(buffer) {
      const incoming = new Uint8Array(buffer);
      const all = new Uint8Array(leftover.length + incoming.length);
      all.set(leftover, 0);
      all.set(incoming, leftover.length);
      let cut = all.length;
      for (let i = all.length - 1, n = 0; i >= 0 && n < 4; i--, n++) {
        const b = all[i];
        if (b < 128)
          break;
        if ((b & 192) !== 128) {
          const need = b >= 240 ? 4 : b >= 224 ? 3 : 2;
          cut = all.length - i >= need ? all.length : i;
          break;
        }
        if (n === 3)
          cut = i;
      }
      leftover = all.slice(cut);
      return utf8Decode(all.subarray(0, cut));
    }
  };
}
function chatStream(messages, { onText, onDone, onError }) {
  const decoder = createUtf8Decoder();
  let sseBuffer = "";
  const task = common_vendor.index.request({
    url: `${BASE_URL}/api/chat`,
    method: "POST",
    header: { "Content-Type": "application/json", ...authHeader() },
    data: { messages },
    enableChunked: true,
    success: (res) => {
      if (res.statusCode === 401) {
        onError && onError(new Error("登录态失效，请重新登录"));
        goLogin();
        return;
      }
      onDone && onDone();
    },
    fail: (err) => onError && onError(new Error(err.errMsg || "网络错误"))
  });
  task.onChunkReceived((res) => {
    sseBuffer += decoder.decode(res.data);
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("0:"))
        continue;
      const payload = line.slice(2).trim();
      if (!payload)
        continue;
      try {
        const text = JSON.parse(payload);
        if (typeof text === "string")
          onText && onText(text);
      } catch (e) {
      }
    }
  });
  return task;
}
exports.TOKEN_KEY = TOKEN_KEY;
exports.chatStream = chatStream;
exports.checkLogin = checkLogin;
exports.login = login;
//# sourceMappingURL=../../.sourcemap/mp-weixin/common/api.js.map
