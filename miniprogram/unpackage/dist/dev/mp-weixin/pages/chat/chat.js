"use strict";
const common_vendor = require("../../common/vendor.js");
const common_api = require("../../common/api.js");
const EXAMPLES = [
  "张三欠了多少货款？",
  "咱们公司的退货政策是什么？",
  "张三欠款情况怎么样？按公司政策该怎么跟进？"
];
const _sfc_main = {
  data() {
    return {
      messages: [],
      draft: "",
      loading: false,
      scrollTop: 0,
      examples: EXAMPLES
    };
  },
  onLoad() {
    if (!common_vendor.index.getStorageSync(common_api.TOKEN_KEY)) {
      common_vendor.index.reLaunch({ url: "/pages/login/login" });
    }
  },
  methods: {
    sendQuick(q) {
      this.draft = q;
      this.onSend();
    },
    scrollBottom() {
      this.scrollTop += 1e3;
    },
    onSend() {
      const text = this.draft.trim();
      if (!text || this.loading)
        return;
      this.messages.push({ role: "user", content: text });
      this.messages.push({ role: "assistant", content: "" });
      const idx = this.messages.length - 1;
      const payload = this.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
      this.draft = "";
      this.loading = true;
      this.scrollBottom();
      let acc = "";
      let lastFlush = 0;
      common_api.chatStream(payload, {
        onText: (delta) => {
          acc += delta;
          const now = Date.now();
          if (now - lastFlush > 80) {
            this.messages[idx].content = acc;
            lastFlush = now;
            this.scrollBottom();
          }
        },
        onDone: () => {
          this.messages[idx].content = acc || "（空回复）";
          this.loading = false;
          this.scrollBottom();
        },
        onError: (e) => {
          this.messages[idx].content = acc + (acc ? "\n\n" : "") + "[出错] " + e.message;
          this.loading = false;
        }
      });
    }
  }
};
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  return common_vendor.e({
    a: $data.messages.length === 0
  }, $data.messages.length === 0 ? {
    b: common_vendor.f($data.examples, (q, i, i0) => {
      return {
        a: common_vendor.t(q),
        b: i,
        c: common_vendor.o(($event) => $options.sendQuick(q), i)
      };
    })
  } : {}, {
    c: common_vendor.f($data.messages, (m, i, i0) => {
      return {
        a: common_vendor.t(m.role === "user" ? "我" : "批"),
        b: common_vendor.t(m.content || "…"),
        c: i,
        d: common_vendor.n(m.role)
      };
    }),
    d: $data.scrollTop,
    e: $data.loading,
    f: common_vendor.o((...args) => $options.onSend && $options.onSend(...args), "0a"),
    g: $data.draft,
    h: common_vendor.o(($event) => $data.draft = $event.detail.value, "93"),
    i: common_vendor.t($data.loading ? "生成中" : "发送"),
    j: $data.loading || !$data.draft.trim(),
    k: common_vendor.o((...args) => $options.onSend && $options.onSend(...args), "ed")
  });
}
const MiniProgramPage = /* @__PURE__ */ common_vendor._export_sfc(_sfc_main, [["render", _sfc_render], ["__scopeId", "data-v-0a633310"]]);
wx.createPage(MiniProgramPage);
//# sourceMappingURL=../../../.sourcemap/mp-weixin/pages/chat/chat.js.map
