# ERP 真实字段对照与 Mock 数据说明

> 目的：让本地 mock 数据的**表结构、字段名、字段含义**与订单豹 ERP 保持一致，
> 值全部为虚拟构造。将来接真实 ERP 时，字段映射逻辑不需要改，只换数据源。

## 为什么不直接导数据库

ERP 的 `.env` 指向的是**阿里云 RDS 生产库**（`rdsyy6j2uzqezyuo.mysql.rds.aliyuncs.com`），
里面有真实客户姓名、手机号、欠款金额。而 `wholesale-agent` 是公开仓库 ——
导入真实数据等于数据泄露事故。

**正确做法：抄结构，造数据。**

- 字段名、类型、关联关系 → 照抄真实系统
- 每一个值 → 自己构造

这不只是"退而求其次"：真实数据里找不到边界样本（1000 天呆账、0.01 元欠款、
超长公司名、负库存），这些只有造得出来。

## 字段来源（ERP 源码位置）

| 数据 | ERP 表（前缀 `sanbao_`） | 源码依据 |
|---|---|---|
| 客户 | `member` | `app/stores/view/customer/index.html`、`app/service/finance/FinanceMemberDetailService.php` |
| 订单 | `order` | `app/service/export/OrderExportFieldService.php:20-55` |
| 订单明细 | `order_goods` | 同上，`:60-120` |
| 商品 / SKU / 库存 | `goods_sku` + `erp_sku_stock` | `app/Jobs/export/SkuStockExport.php:41-44, 76-81` |
| 欠款明细账 | `finance_member_detail` | `app/service/finance/FinanceMemberDetailService.php:86-104` |

## 一、客户表 `customers.json`

| 字段 | 含义 | 说明 |
|---|---|---|
| `member_id` | 客户 ID | 主键，订单表靠它关联 |
| `member_no` | 客户编号 | 如 `KH20230401` |
| `username` | 登录名 | 拼音，真实 ERP 的搜索默认走这个字段 |
| `nickname` | 客户姓名 / 昵称 | **ERP 客户列表实际显示的字段** |
| `realname` | 真实姓名 | 财务明细账口径用它 |
| `mobile` | 手机号 | |
| `company_name` | 公司名称 | 可能比 `nickname` 长很多 |
| `member_level_name` | 客户等级 | 如 `A级客户` |
| `settlement_type_name` | 结算类型 | 如 `月结30天` / `现结` |
| `salesman_name` | 所属业务员 | |
| `sales_cycle` | 订货周期 | |
| `sales_num` | 订货次数 | |
| `sales_money` | 历史订货金额 | |
| `end_diff_amount` | **期末欠款合计** | ERP 客户表上的冗余字段，与订单汇总应一致 |
| `balance_amount` | 余额账户余额 | |
| `reg_time` | 创建时间 | |
| `full_address` | 客户区域 | |
| `is_disable` | 屏蔽状态 | 0 = 正常 |
| `from_name` | 客户来源 | |
| `remark` | 备注 | |

> ⚠️ **ERP 里没有"账龄"字段**（`账龄 / aging / overdue_days / debt_days` 全项目零命中）。
> 账龄必须**算出来** —— 取该客户所有未结清订单里**最早的下单日期**，与今天做差。

## 二、订单表 `orders.json`

主表字段（来源 `OrderExportFieldService::getOrderFieldDefinitions`）：

| 字段 | 含义 |
|---|---|
| `order_id` / `order_no` | 订单 ID / 订单号 |
| `create_time` | 下单时间 ← **账龄的计算依据** |
| `member_id` / `member_name` / `member_short_name` | 客户关联字段 |
| `mobile` | 手机号 |
| `salesman_name` | 业务员 |
| `goods_unit_num` | 商品总数量 |
| `pay_money` | 订单金额（含运费） |
| `already_money` | 已收款金额 |
| `diff_money` | **欠款金额** ← 欠款来源 |
| `delivery_money` / `other_money` | 运费 / 其他费用 |
| `order_status_name` | 订单状态 |
| `receipts_status_name` | 收款状态 |
| `put_storage_status_name` | 出库状态 |
| `sign_status_name` | 签收状态 |
| `buyer_message` | 订单备注 |

明细字段 `order_goods[]`：

| 字段 | 含义 |
|---|---|
| `sku_no` / `sku_name` | 商品编号 / 名称 |
| `spec_name` | 规格 |
| `unit_name` | 结算单位 |
| `adjust_price` | 单价 |
| `unit_num` | 数量 |
| `goods_money` | 小计 |
| `cost_money` | 成本总价 |

## 三、商品 / 库存 `products.json`

来源 `SkuStockExport`，表 `erp_sku_stock` 关联 `goods_sku`：

| 字段 | 含义 |
|---|---|
| `sku_id` / `sku_no` | SKU 主键 / 编号 |
| `sku_name` | 商品名称 |
| `spec_name` | 规格 |
| `unit_sku_code` | 商品条码 |
| `unit_name` | 基础单位 |
| `category_name` | 商品分类 |
| `brand_name` | 商品品牌 |
| `cost_price` | 成本单价 |
| `stock` | 实际库存 |
| `unit_one_stock` | 副单位库存 |
| `stash_name` | 仓库名称 |
| `goods_state` | 商品状态（1 上架） |

## 数据量与原定测试预期

| 客户 | 欠款 | 账龄（按 2026-09-18） | 用途 |
|---|---|---|---|
| 李四 | 36200 | 92 天 | 高风险 → 完整催收链路 |
| 张三 | 12800 | 45 天 | 中风险 |
| 王五 | 1500 | 12 天 | 低风险 → 走 END，不产草稿 |
| 陈建国 | 186500 | 1000 天 | **呆账边界** |
| 孙小明 | 0.01 | 18 天 | **金额边界**（测试抹零 / 显示） |
| 大发五金建材批发部 | 25800 | 34 天 | **超长客户名边界** |
| （无记录）赵六 | — | — | 不存在 → 异常路径 |

> `nickname` 与 `end_diff_amount`、`diff_money` 三者已做**自洽校验**：
> 客户欠款 = 其名下订单欠款之和。

商品侧边界样本：正泰空气开关库存 `0`、雷士筒灯库存 `-12`（负库存）、
三雄极光平板灯名称 30 字符（测换行撑爆）。

## 待改造的代码位置

改字段名会牵动四处，**顺序不能乱**（先数据源、后消费方）：

1. `app/api/mock/[resource]/route.ts` — 三个 filter 的匹配字段
2. `lib/tool.ts` — 三个工具的类型定义与 `description`
3. `lib/collection-workflow.ts` 的 `loadDebt` — 改两跳 + 计算账龄
4. `app/api/chat/route.ts` — system prompt 里对字段的描述（如有）

## 备份位置

改造前的原数据在 `.workbuddy/backup/data-original/`（customers.json / orders.json / products.json）。
