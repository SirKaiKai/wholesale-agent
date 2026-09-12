<template>
  <view class="wrap">
    <view class="card">
      <view class="logo">批</view>
      <view class="title">批发通 Agent</view>
      <view class="sub">小程序 Demo · 连接本地 wholesale-agent</view>
      <input
        v-model="password"
        class="input"
        password
        placeholder="请输入访问密码"
        placeholder-class="ph"
        :disabled="loading"
        @confirm="doLogin"
      />
      <button class="btn" :loading="loading" @tap="doLogin">进入</button>
      <view class="tip" :class="{ err: errorMsg }">{{ errorMsg || '密码为后端 .env 中的 SITE_PASSWORD' }}</view>
    </view>
  </view>
</template>

<script>
import { login, checkLogin } from '@/common/api.js'

export default {
  data() {
    return {
      password: '',
      loading: false,
      errorMsg: '',
    }
  },
  onLoad() {
    checkLogin().then((ok) => {
      if (ok) uni.reLaunch({ url: '/pages/chat/chat' })
    })
  },
  methods: {
    doLogin() {
      if (!this.password.trim() || this.loading) return
      this.loading = true
      this.errorMsg = ''
      login(this.password.trim())
        .then(() => uni.reLaunch({ url: '/pages/chat/chat' }))
        .catch((e) => {
          this.errorMsg = e.message || '登录失败'
          this.loading = false
        })
    },
  },
}
</script>

<style scoped>
.wrap {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
}
.card {
  width: 100%;
  background: #ffffff;
  border-radius: 24rpx;
  padding: 64rpx 48rpx 48rpx;
  box-shadow: 0 4rpx 24rpx rgba(31, 35, 41, 0.06);
}
.logo {
  width: 112rpx;
  height: 112rpx;
  border-radius: 28rpx;
  background: #1b66ff;
  color: #ffffff;
  font-size: 56rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 32rpx;
}
.title {
  text-align: center;
  font-size: 40rpx;
  font-weight: 600;
  color: #1f2329;
}
.sub {
  text-align: center;
  font-size: 24rpx;
  color: #8a94a6;
  margin: 12rpx 0 48rpx;
}
.input {
  height: 96rpx;
  background: #f5f6f8;
  border-radius: 16rpx;
  padding: 0 32rpx;
  font-size: 30rpx;
}
.ph {
  color: #b3bcc9;
}
.btn {
  margin-top: 32rpx;
  background: #1b66ff;
  color: #ffffff;
  font-size: 32rpx;
  border-radius: 16rpx;
}
.btn[disabled] {
  background: #a8c6ff;
  color: #ffffff;
}
.tip {
  margin-top: 24rpx;
  text-align: center;
  font-size: 24rpx;
  color: #8a94a6;
}
.tip.err {
  color: #e8463a;
}
</style>
