# MCP 全链路演示脚本

> 目标：3 分钟内证明「AI Agent 能通过自研 MCP 工具读取企业 ERP 真实数据」
> 两条路线：命令行（稳定可控，主推）+ WorkBuddy（真实 Agent 调用，加分项）

---

## 零、演示前检查（3 分钟，必做）

| # | 检查项 | 操作 | 期望结果 |
|---|--------|------|----------|
| 1 | phpstudy nginx | 打开 phpstudy 面板 | nginx 绿灯 |
| 2 | MySQL | 面板点「启动」 | MySQL 绿灯（**不启动则接口返回空数据**） |
| 3 | 站点可达 | 浏览器开 `http://dingdanbao.test` | 出现 ERP 登录页 |
| 4 | Cookie 有效 | 跑一次完整命令（见第一节） | 有真实数据返回，不是「登录态失效」 |
| 5 | 依赖完整 | `wholesale-agent/node_modules` 存在 | — |

**Cookie 失效了就重做附录 A，2 分钟。**

---

## 一、命令行演示（主推路线）

### 命令

```powershell
cd D:\AppGallery\2026-07-19-18-38-44\wholesale-agent
& "C:\Users\15290\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" ./node_modules/tsx/dist/cli.mjs mcp-server/test-client.ts
```

> 说明：这条命令做的事和真实 Host 完全一样——拉起 MCP Server 子进程、走 stdio 握手、发现工具、调用工具。
> 只是把「LLM 决定调哪个」这一步换成了写死的调用，所以输出稳定可控，适合演示。

### 预期输出与讲解词（5 段，逐段推进）

| 输出段 | 演示的技术点 | 讲解词 |
|--------|-------------|--------|
| `✅ 发现工具: search_wholesale_policy, call_erp_api` | **工具自描述 + 自动发现** | 「Host 启动时先问 Server『你会干啥』，Server 返回工具清单和参数 schema。这是 MCP 最核心的机制——工具是自描述的，我不用为每个 Host 写适配代码。」 |
| `── search_wholesale_policy ──`<br>返回 `return-policy.md` 片段 | **检索型工具（RAG）** | 「这是检索型工具，返回知识库相关片段和来源文件。它复用了我自建的 RAG 链路：向量 + 关键词混合检索、RRF 融合、重排序。」 |
| `── call_erp_api · 公开接口 ──`<br>`HTTP 200 ... defaultSearchWords` | **接口型工具 · 免鉴权** | 「这是接口型工具，去调企业 ERP 的 HTTP 接口。先打一个公开接口验证链路通。」 |
| `── call_erp_api · 库存总览 ──`<br>库存总量 + 金额 | **真实业务数据** | 「这个是带登录态的。返回的是公司 ERP 的真实库存总量和总金额——**注意这个数字每次跑都不一样，因为它是实时从数据库查的**，不是写死的 mock。」 |
| `── call_erp_api · 客户列表 ──`<br>客户编号 / 手机号 / 业务员 | **真实敏感数据** | 「客户档案，总数 420 条，每条带客户编号和归属业务员。这类数据走的是同一套鉴权。」 |

### 收尾一句

> 整条链路是：命令行客户端 → MCP stdio → Node 服务端 → nginx + php-cgi → ThinkPHP → MySQL。
> **全程没有改动公司 ERP 一行代码**，全部通过请求头适配从外部打通。

---

## 二、接入真实 Agent 演示（WorkBuddy，加分项）

### 前置

连接器管理 → 找到 `wholesale-kb` → **开关关一下再打开**（加载最新工具列表）

### 演示话术（用显式指令，成功率 100%）

> 调用 wholesale-kb 的 call_erp_api，查一下库存总量和总金额

**为什么用「调用 xxx 的 yyy」这种显式句式**：实测显式指令必定触发，而裸问题（如「退货怎么处理」）可能被 Host 的澄清策略或其他 Skill 抢路由。演示要的是稳定成功，不是赌概率。

### 备选话术

> 调用 wholesale-kb 的 search_wholesale_policy，查一下退货政策

---

## 三、HTTP 企业形态演示（加分项）

前面两节是「本机单机」形态。这一段演示**企业部署形态**：Server 作为常驻服务，多客户端通过 URL 接入，鉴权集中在服务端。

### 启动服务

```powershell
cd D:\AppGallery\2026-07-19-18-38-44\wholesale-agent
& "C:\Users\15290\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" ./node_modules/tsx/dist/cli.mjs mcp-server/src/http.ts
```

预期输出：

```
[MCP] HTTP 入口已启动  http://localhost:3900/mcp
[MCP] 鉴权：未启用（开发模式，仅限本机）
[MCP] 探活：http://localhost:3900/health
```

### 另开一个终端，跑 HTTP 客户端

```powershell
& "C:\Users\15290\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" ./node_modules/tsx/dist/cli.mjs mcp-server/test-http-client.ts
```

预期输出（**重点看会话 ID**）：

```
✅ 服务探活: {"ok":true,"server":"wholesale-kb","transport":"streamable-http",...}
✅ HTTP 传输连接成功 http://localhost:3900/mcp
   会话 ID: 8d3319f2-e699-44f4-b7b3-4d98f96829e1
✅ 发现工具: search_wholesale_policy, call_erp_api
── search_wholesale_policy ──  （知识库片段）
── call_erp_api · 库存总览 ──  （真实库存金额）
✅ 会话已关闭
```

### 三个演示点（讲解词）

| 现象 | 讲解词 |
|------|--------|
| 会话 ID | 「HTTP 是**有状态会话**——Server 给每个连接分配 sessionId，后续请求靠它找回上下文。stdio 不需要这个，因为一个进程本来就只服务一个 Host。」 |
| 服务端日志出现「会话建立」 | 「Server 端能看到谁连上来了、什么角色——**这就是审计的起点**。」 |
| 两种传输共存 | 「我保留了 stdio 入口，两个入口共用同一套工具代码：`server.ts` 是工厂，`index.ts` 和 `http.ts` 只是两个壳。」 |

### 演示鉴权（30 秒，强烈建议做）

企业形态的关键差异是**身份从凭证来**。带 token 启动：

```powershell
$env:MCP_AUTH_TOKEN="test-secret-123"
& "C:\Users\15290\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" ./node_modules/tsx/dist/cli.mjs mcp-server/src/http.ts
```

实测结果：

| 请求 | 结果 |
|------|------|
| 不带 token | `HTTP 401` `Unauthorized` |
| 错误 token | `HTTP 401` `Unauthorized` |
| 正确 token | `HTTP 200` + 分配会话 ID |

讲解词：

> 「stdio 模式下凭证放在客户端本地——我的 `.env` 里存着 ERP 的 Cookie。搬到企业形态，凭证就归服务端管：客户端只拿一个 token，真正的业务系统账号由 Server 持有。这样每个员工不需要知道 ERP 的密码，而且 Server 知道**每次调用是谁发起的**。」

### 企业做法对照（收尾用）

| 维度 | stdio（默认） | HTTP（企业形态） |
|------|--------------|-----------------|
| 凭证 | Cookie 在客户端 `.env` | token 换身份，服务账号在 Server 侧 |
| 用户数 | 我一个人 | 全公司（N 个并发会话） |
| 权限 | 全量 | 可按 caller 裁剪工具集（已预留 `buildServer(caller)`） |
| 审计 | 无 | 服务端会话日志 |

---

## 四、录屏脚本（3 分钟，含旁白）

| 时间 | 画面 | 旁白 |
|------|------|------|
| 0:00–0:15 | phpstudy 面板（nginx + MySQL 绿灯） | 「首先这是我的本地环境，一个真实的 PHP 企业系统，nginx 加 MySQL。」 |
| 0:15–0:35 | 浏览器打开 `dingdanbao.test`，展示 ERP 登录页 | 「这是公司的 ERP 后台，ThinkPHP 框架。注意——我不改它任何代码，只在外部调它的接口。」 |
| 0:35–0:50 | 切到终端，展示并执行命令 | 「现在跑这段脚本。它模拟一个 AI Host，通过 MCP 协议连接我写的工具服务端。」 |
| 0:50–1:20 | 输出第 1 段：工具发现 | 「第一步，Host 问 Server 会干啥，Server 返回两个工具和它们的参数定义。这就是 MCP 的自描述能力。」 |
| 1:20–1:50 | 输出第 2 段：RAG 检索 | 「第一个工具是检索型，返回知识库片段和来源文件，底层复用我自建的 RAG 链路。」 |
| 1:50–2:40 | 输出第 3–5 段：ERP 数据 | 「重点来了。第二个工具是接口型，它带上了登录态去调 ERP 后台接口。你看这是真实的库存总量和金额，后面是客户档案，420 条，带手机号。」 |
| 2:40–3:00 | 回到终端顶部，收尾 | 「整条链路从 MCP 到企业 ERP 全通，而且没动公司一行代码。这个工具服务端我用 TypeScript 写的，用了官方的 MCP SDK。」 |

---

## 五、演示中可能被追问（预案）

| 追问 | 应答要点 |
|------|----------|
| 这数据是真实的吗？ | 是。ERP 是本机的真实企业系统，数据从 MySQL 实拉。知识库那部分是模拟文档。 |
| 登录态怎么来的？ | 我登录 ERP 后台后从浏览器复制 Cookie，写进 `.env`。Cookie 约一天过期，过期后工具会明确报「登录态失效」并给出处理步骤，不会瞎答。 |
| 为什么不直连数据库？ | 接口方式复用了系统自身的业务逻辑和权限校验，而且不改对方代码，风险最低。 |
| 会读到敏感数据吗？ | 会——客户手机号、库存金额。所以只在本机调试用，Cookie 未硬编码且已加 gitignore。生产需要工具级权限控制。 |
| 为什么不做成自动触发？ | 显式指令已 100% 生效；自动触发率由 Host 侧 LLM 决定，Server 只能通过描述影响。这是 MCP 的机制特性，不是缺陷。 |

---

## 附录 A · Cookie 获取步骤（2 分钟）

1. 浏览器打开 `http://dingdanbao.test/shop/login/login.html`
2. 用你的账号登录
3. 按 `F12` → 切到 **Network（网络）** 面板
4. **刷新页面**，点左侧任意一个请求
5. 在 **Request Headers（请求标头）** 找到 `cookie:` 这一行
6. 复制整串值（形如 `think_lang=zh-cn; PHPSESSID=xxxxx`，**全部复制**）
7. 打开 `D:\AppGallery\2026-07-19-18-38-44\wholesale-agent\.env`
8. 找到最后一行 `ERP_COOKIE=`，改成：

```
ERP_COOKIE=think_lang=zh-cn; PHPSESSID=你复制的那串
```

9. 保存文件，重跑命令

> 验证是否成功：输出里没有「登录态失效」，且有真实数据。

---

## 附录 B · 故障速查

| 现象 | 原因 | 处理 |
|------|------|------|
| `请求失败：fetch failed` | phpstudy 站点没启动 / hosts 没配 | 检查面板 nginx 绿灯，检查 `C:\Windows\System32\drivers\etc\hosts` 有 `127.0.0.1 dingdanbao.test` |
| `登录态失效：...重定向到登录页` | Cookie 过期（约一天） | 重做附录 A |
| HTTP 200 但 `data` 是空数组 | MySQL 没启动 | phpstudy 面板启动 MySQL |
| HTTP 500 `variable type error: array` | 请求头缺 `Accept: application/json` | 工具内已内置三件套，出现此错说明代码被改动 |
| 返回 HTML 页面 | 路由不存在 / 登录态失效 | 核对接口路径；对照工具描述里的已验证路径列表 |
| 中文乱码 | PowerShell 管道按 GBK 解码 | 用 `cmd /c` 或直接看终端原始输出，内容本身没问题 |

---

## 附录 C · 已验证接口清单（演示时可现场追加调用）

| 接口路径 | 数据 | 实测量 |
|----------|------|--------|
| `/erp/skustock/getStashTotalStockAndCost` | 库存总量 + 总金额 | 金额 ¥41,084,244 |
| `/erp/skustock/getStockWarningList` | 库存预警明细 | 104 条 |
| `/erp/purchaseorder/index` | 采购单列表 | 1,206 张 |
| `/crm/customer/memberList` | 客户列表 | 420 条 |
| `/crm/customer/tradelist` | 交易记录 | 4,948 条 |
| `/crm/customer/contractList` | 合同列表 | — |
| `/crm/memberlevel/levelList` | 客户等级 | 5 个 |
| `/api/goods/defaultSearchWords` | 搜索词（免鉴权） | — |

**通用分页参数**：`page`、`page_size`（如 `params: { page: '1', page_size: '5' }`）
