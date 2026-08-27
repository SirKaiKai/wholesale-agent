import { tool } from 'ai';
import { z } from 'zod';
import { apiGet } from './api';   // ← 只引这一个

// 欠款查询
export interface CustomerDebtResult {
    found: boolean;
    customer?: {
        customerName: string;
        debtAmount: number;
        debtDays: number;
        level: string;
        lastFollowUp: string;
    }[];
    message?: string;
}
export const getCustomerDebt = tool({
    description: '查询客户欠款信息，包括欠款金额、账龄天数、最后跟进时间和客户等级。当用户询问某个客户欠了多少钱、欠款多久时调用此工具。',
    parameters: z.object({
        customerName: z.string().describe('客户姓名，如：张三'),
    }),
    execute: async ({ customerName }) => {
        // 业务层只写「路径 + 参数」，不再碰 fetch / 域名 / 鉴权
        return apiGet<CustomerDebtResult>('/customers', { name: customerName });
    },
});


// 库存 
export interface StockResult {
    found: boolean;
    products?: { productName: string; category: string; unit: string; stock: number; safeStock: number; warehouse: string }[];
    message?: string;
}
export const getStock = tool({
    description: "查询商品库存：当前库存数量、安全库存、所在仓库。当用户询问某个商品还有多少货、库存够不够、是否需要补货时调用此工具。",
    parameters: z.object({
        productName: z.string().describe('商品名称，如：农夫山泉550ml'),
    }),
    execute: async ({ productName }) => {
        return apiGet<StockResult>('/products', { name: productName });
    },
})

// 订单
export interface OrderResult {
    found: boolean;
    orders?: { orderNo: string; customerName: string; productName: string; quantity: number; amount: number; orderDate: string; status: string }[];
    message?: string;
}

export const getOrders = tool({
    description: '查询客户订单：订单号、商品、金额、下单日期、发货状态。当用户询问某个客户的订单、某段时间的销售情况、谁的订单最大时调用此工具。',
    parameters: z.object({
        customerName: z.string().optional().describe('客户姓名，如：张三；不填则查全部订单，用于比较统计'),
    }),
    execute: async ({ customerName }) => {
        // 不传客户名时，query 传 undefined，apiGet 不会拼任何参数
        return apiGet<OrderResult>('/orders', customerName ? { customerName } : undefined);
    },
});