import { tool } from 'ai';
import { z } from 'zod';
import { apiGet } from './api';   // ← 只引这一个

// ⚠️ 本文件所有 interface 的字段名 = 订单豹 ERP 真实表结构的字段名
//    （sanbao_member / sanbao_order / erp_sku_stock），不是随便起的别名。
//    详见 docs/ERP真实字段对照与Mock数据说明.md
//
//    只声明「AI 用得上」的字段，不必把 20 个字段全抄进来 ——
//    工具的返回值会进 AI 上下文，给多了就是污染。

// 欠款查询
export interface CustomerDebtResult {
    found: boolean;
    customer?: {
        member_id: number;          // 会员 ID（客户身份，工作流两跳的第二跳用它查订单）
        nickname: string;           // 客户姓名（ERP 列表实际显示字段）
        company_name: string;       // 公司全称
        mobile: string;             // 联系电话
        member_level_name: string;  // 客户等级，如：A级客户
        salesman_name: string;      // 所属业务员
        end_diff_amount: number;    // 欠款金额（期末差额）
        balance_amount: number;     // 账户余额（预存）
    }[];
    message?: string;
}
export const getCustomerDebt = tool({
    description: '查询客户欠款信息：欠款金额、账户余额、客户等级、所属业务员、联系电话。当用户询问某个客户欠了多少钱时调用此工具。注意：本工具只回答"欠多少钱"，不做账龄分析、不生成催款消息；用户要催款请改用 collectionWorkflow。',
    parameters: z.object({
        customerName: z.string().describe('客户姓名，如：张三；也可以用公司全称，如：永辉商贸有限公司'),
    }),
    execute: async ({ customerName }) => {
        // 业务层只写「路径 + 参数」，不再碰 fetch / 域名 / 鉴权
        return apiGet<CustomerDebtResult>('/customers', { name: customerName });
    },
});


// 库存 
export interface StockResult {
    found: boolean;
    products?: {
        sku_no: string;         // 商品编号
        sku_name: string;       // 商品名称
        spec_name: string;      // 规格
        unit_name: string;      // 单位
        category_name: string;  // 分类
        stock: number;          // 当前库存
        cost_price: number;     // 成本价
        stash_name: string;     // 所在仓库
    }[];
    message?: string;
}
export const getStock = tool({
    description: "查询商品库存：当前库存数量、规格、单位、所在仓库、成本价。当用户询问某个商品还有多少货、库存够不够、是否需要补货时调用此工具。",
    parameters: z.object({
        productName: z.string().describe('商品名称，如：公牛插座 GN-606 5米'),
    }),
    execute: async ({ productName }) => {
        return apiGet<StockResult>('/products', { name: productName });
    },
})

// 订单
export interface OrderResult {
    found: boolean;
    orders?: {
        order_no: string;            // 订单号
        create_time: string;         // 下单时间
        member_id: number;           // 会员 ID（跟客户表的 member_id 对得上）
        member_name: string;         // 客户名称
        member_short_name: string;   // 客户简称（模糊查询也能命中）
        salesman_name: string;       // 所属业务员
        goods_unit_num: number;      // 商品总件数
        pay_money: number;           // 订单金额
        already_money: number;       // 已收金额
        diff_money: number;          // 未收金额（这个就是欠款）
        order_status_name: string;   // 发货状态，如：已出库
        receipts_status_name: string;// 收款状态，如：未收款
        buyer_message: string;       // 客户留言（可能为空）
        // 商品明细：接口返回的是嵌套数组，主表金额就是它汇总出来的
        order_goods: {
            sku_no: string;          // 商品编号
            sku_name: string;        // 商品名称
            spec_name: string;       // 规格
            unit_name: string;       // 单位
            unit_num: number;        // 数量
            goods_money: number;     // 小计金额
        }[];
    }[];
    message?: string;
}

export const getOrders = tool({
    description: '查询客户订单：订单号、下单时间、订单金额、已收/未收金额、发货状态、收款状态，以及每笔订单的商品明细（买了什么、数量、金额）。当用户询问某个客户的订单、某段时间的销售情况、某个客户买了哪些货、谁的订单最大时调用此工具。',
    parameters: z.object({
        customerName: z.string().optional().describe('客户姓名，如：张三；不填则查全部订单，用于比较统计'),
    }),
    execute: async ({ customerName }) => {
        // 不传客户名时，query 传 undefined，apiGet 不会拼任何参数
        return apiGet<OrderResult>('/orders', customerName ? { name: customerName } : undefined);
    },
});
