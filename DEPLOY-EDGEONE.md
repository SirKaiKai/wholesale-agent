# wholesale-agent · EdgeOne Pages 上线指南

> 沿用 my-first-agent 已跑通的部署链路（EdgeOne Pages + Git 导入），全程浏览器操作。

## 零、本地已完成的上线适配（无需再做）

| 适配项 | 文件 | 说明 |
|---|---|---|
| 请求域名注入 | `lib/api.ts` + `app/api/chat/route.ts` | 生产环境 mock 接口自动用站点自身域名，不再依赖 localhost |
| 数据文件打包 | `next.config.mjs` | `data/` 与 `knowledge-base/` 显式打进部署产物，线上 fs 可读 |
| 密钥不入库 | `.gitignore` | `.env` 已排除，密钥只配在 EdgeOne 环境变量 |
| 构建验证 | `npm run build` | ✅ 已通过 |

## 一、推送到 GitHub（本机命令行执行）

1. 浏览器打开 https://github.com/new ，仓库名 `wholesale-agent`，**不要勾选** README / .gitignore / license（保持空仓库）
2. 在项目目录执行（Windows 弹出登录窗口就按提示登录）：

```bash
git remote add origin https://github.com/SirKaiKai/wholesale-agent.git
git push -u origin main
```

## 二、EdgeOne Pages 导入部署

1. 访问 <https://pages.edgeone.ai> → 登录控制台（微信/腾讯云账号）
2. 「创建项目」→「导入 Git 仓库」→ 授权 GitHub（已授权过，直接选 `wholesale-agent`）
3. 构建配置（通常自动识别）：

| 配置项 | 值 |
|---|---|
| Framework Preset | Next.js |
| Build Command | `npm run build` |
| Output Directory | `.next` |

4. **环境变量（3 个，一个都不能少）**：

```
DEEPSEEK_API_KEY=sk-你的key        # 对话模型（漏了 → Agent 回复报错）
SILICONFLOW_API_KEY=sk-你的key     # RAG embedding（漏了 → 知识库入库失败）
SITE_PASSWORD=你的访问密码          # 登录门禁（漏了 → 任何密码都登录不上！）
```

> ⚠️ `SITE_PASSWORD` 必须配：middleware 和登录接口共用它，不配会导致「永远拒绝任何密码」。

5. 点「Deploy」，等 1-3 分钟出现 ✅ Ready

## 三、访问（重要机制）

- 默认域名形如 `xxx.edgeone.cool`，**直连返回 401**
- 必须用控制台「项目概览」右上角「**预览**」按钮生成带 token 的预览链接（**3 小时有效**，过期重新生成）
- 长期访问：绑定已完成 ICP 备案的域名（参考 my-first-agent/DEPLOY-EDGEONE-FILING.md 三阶段流程）

## 四、部署后验证清单

用预览链接打开，逐项测：

| # | 操作 | 预期 |
|---|---|---|
| 1 | 直接访问首页 | 跳转 /login 登录页 |
| 2 | 输入 SITE_PASSWORD | 跳回首页 |
| 3 | 问「张三欠款吗」 | 走工具，答 ¥12,800 / 45 天 / B 级（证明 api.ts 域名注入生效） |
| 4 | 问「退货政策是什么」 | 答出 7 天/15 天/临期规则（证明 knowledge-base 打包生效） |
| 5 | 不登录直接访问 /api/mock/customers | 401 JSON（middleware 生效） |

第 3、4 项任何一个失败，回 EdgeOne 看构建日志，最常见原因：环境变量漏配。

## 五、日常迭代

改代码后：

```bash
git add -A && git commit -m "改动说明" && git push
```

EdgeOne 检测到 push 自动重新部署（CI/CD），无需重复导入。
