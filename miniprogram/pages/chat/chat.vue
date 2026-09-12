<template>
  <view class="page">
    <scroll-view class="msgs" scroll-y :scroll-top="scrollTop">
      <view v-if="messages.length === 0" class="empty">
        <view class="empty-title">你好，我是批发通</view>
        <view class="empty-sub">下面三问分别验证 工具 / 知识库 / 混合 三条链路</view>
        <view v-for="(q, i) in examples" :key="i" class="chip" @tap="sendQuick(q)">{{ q }}</view>
      </view>

      <view v-for="(m, i) in messages" :key="i" class="row" :class="m.role">
        <view class="avatar">{{ m.role === 'user' ? '我' : '批' }}</view>
        <view class="bubble">
          <text>{{ m.content || '…' }}</text>
        </view>
      </view>
      <view class="bottom-pad"></view>
    </scroll-view>

    <view class="input-bar">
      <input
        v-model="draft"
        class="input"
        placeholder="问点什么…"
        placeholder-class="ph"
        :disabled="loading"
        confirm-type="send"
        @confirm="onSend"
      />
      <button class="send" :disabled="loading || !draft.trim()" @tap="onSend">
        {{ loading ? '生成中' : '发送' }}
      </button>
    </view>
  </view>
</template>

<script>
import { chatStream, TOKEN_KEY } from '@/common/api.js'

const EXAMPLES = [
  '张三欠了多少货款？',
  '咱们公司的退货政策是什么？',
  '张三欠款情况怎么样？按公司政策该怎么跟进？',
]

export default {
  data() {
    return {
      messages: [],
      draft: '',
      loading: false,
      scrollTop: 0,
      examples: EXAMPLES,
    }
  },
  onLoad() {
    // 直接落到聊天页（如热重载/自定义编译模式）时兜底：无 token 踢回登录
    if (!uni.getStorageSync(TOKEN_KEY)) {
      uni.reLaunch({ url: '/pages/login/login' })
    }
  },
  methods: {
    sendQuick(q) {
      this.draft = q
      this.onSend()
    },
    scrollBottom() {
      // scroll-top 同值不触发滚动，递增保证每次都生效
      this.scrollTop += 1000
    },
    onSend() {
      const text = this.draft.trim()
      if (!text || this.loading) return

      this.messages.push({ role: 'user', content: text })
      this.messages.push({ role: 'assistant', content: '' })
      const idx = this.messages.length - 1
      // 后端直接消费 OpenAI 风格 messages，带上全部历史即为多轮对话
      const payload = this.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))

      this.draft = ''
      this.loading = true
      this.scrollBottom()

      let acc = ''
      let lastFlush = 0

      chatStream(payload, {
        onText: (delta) => {
          acc += delta
          // 80ms 节流渲染，避免每个 chunk 都触发页面更新
          const now = Date.now()
          if (now - lastFlush > 80) {
            this.messages[idx].content = acc
            lastFlush = now
            this.scrollBottom()
          }
        },
        onDone: () => {
          this.messages[idx].content = acc || '（空回复）'
          this.loading = false
          this.scrollBottom()
        },
        onError: (e) => {
          this.messages[idx].content = acc + (acc ? '\n\n' : '') + '[出错] ' + e.message
          this.loading = false
        },
      })
    },
  },
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f6f8;
}
.msgs {
  flex: 1;
  padding: 24rpx 24rpx 0;
  box-sizing: border-box;
}
.empty {
  padding: 96rpx 24rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.empty-title {
  font-size: 36rpx;
  font-weight: 600;
  color: #1f2329;
}
.empty-sub {
  font-size: 24rpx;
  color: #8a94a6;
  margin: 16rpx 0 48rpx;
}
.chip {
  width: 100%;
  box-sizing: border-box;
  background: #ffffff;
  border-radius: 16rpx;
  padding: 24rpx 28rpx;
  margin-bottom: 20rpx;
  font-size: 28rpx;
  color: #1f2329;
  text-align: center;
}
.row {
  display: flex;
  margin-bottom: 24rpx;
}
.row.user {
  flex-direction: row-reverse;
}
.avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: #1b66ff;
  color: #ffffff;
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.row.user .avatar {
  background: #8a94a6;
}
.bubble {
  max-width: 75%;
  background: #ffffff;
  border-radius: 4rpx 20rpx 20rpx 20rpx;
  padding: 20rpx 24rpx;
  font-size: 28rpx;
  line-height: 1.6;
  color: #1f2329;
  word-break: break-all;
  margin: 0 16rpx;
}
.row.user .bubble {
  background: #1b66ff;
  color: #ffffff;
  border-radius: 20rpx 4rpx 20rpx 20rpx;
}
.bottom-pad {
  height: 32rpx;
}
.input-bar {
  display: flex;
  align-items: center;
  padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom));
  background: #ffffff;
  border-top: 1rpx solid #eef0f3;
}
.input {
  flex: 1;
  height: 76rpx;
  background: #f5f6f8;
  border-radius: 38rpx;
  padding: 0 32rpx;
  font-size: 28rpx;
}
.ph {
  color: #b3bcc9;
}
.send {
  margin-left: 16rpx;
  background: #1b66ff;
  color: #ffffff;
  font-size: 28rpx;
  border-radius: 38rpx;
  padding: 0 36rpx;
  line-height: 76rpx;
  height: 76rpx;
}
.send[disabled] {
  background: #a8c6ff;
  color: #ffffff;
}
</style>
