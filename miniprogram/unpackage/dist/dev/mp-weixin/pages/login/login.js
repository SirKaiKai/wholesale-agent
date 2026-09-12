"use strict";
const common_vendor = require("../../common/vendor.js");
const common_api = require("../../common/api.js");
const _sfc_main = {
  data() {
    return {
      password: "",
      loading: false,
      errorMsg: ""
    };
  },
  onLoad() {
    common_api.checkLogin().then((ok) => {
      if (ok)
        common_vendor.index.reLaunch({ url: "/pages/chat/chat" });
    });
  },
  methods: {
    doLogin() {
      if (!this.password.trim() || this.loading)
        return;
      this.loading = true;
      this.errorMsg = "";
      common_api.login(this.password.trim()).then(() => common_vendor.index.reLaunch({ url: "/pages/chat/chat" })).catch((e) => {
        this.errorMsg = e.message || "登录失败";
        this.loading = false;
      });
    }
  }
};
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  return {
    a: $data.loading,
    b: common_vendor.o((...args) => $options.doLogin && $options.doLogin(...args), "33"),
    c: $data.password,
    d: common_vendor.o(($event) => $data.password = $event.detail.value, "89"),
    e: $data.loading,
    f: common_vendor.o((...args) => $options.doLogin && $options.doLogin(...args), "ce"),
    g: common_vendor.t($data.errorMsg || "密码为后端 .env 中的 SITE_PASSWORD"),
    h: $data.errorMsg ? 1 : ""
  };
}
const MiniProgramPage = /* @__PURE__ */ common_vendor._export_sfc(_sfc_main, [["render", _sfc_render], ["__scopeId", "data-v-e4e4508d"]]);
wx.createPage(MiniProgramPage);
//# sourceMappingURL=../../../.sourcemap/mp-weixin/pages/login/login.js.map
