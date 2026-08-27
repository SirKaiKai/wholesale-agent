// app/api/mock/[resource]/route.ts —— 所有 mock 数据接口的"唯一入口"
// URL 结构不变：/api/mock/customers?name=张三 → resource = "customers"
// 以后新增数据（如对账单）：HANDLERS 加一行 + data/ 建一个 json，不用新建文件
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// ===== 表驱动：每个资源 = 数据文件 + 过滤规则 + 响应字段名 =====
const HANDLERS: Record<
  string,
  {
    file: string;
    responseKey: string;
    filter: (rows: any[], p: URLSearchParams) => any[];
    notFound: (p: URLSearchParams) => string;
  }
> = {
  customers: {
    file: 'customers.json',
    responseKey: 'customer',          // 契约不变：欠款返回字段是单数 customer
    filter: (rows, p) => rows.filter((r: any) => r.customerName.includes(p.get('name') || '')),
    notFound: (p) => `未找到客户「${p.get('name')}」的欠款记录`,
  },
  products: {
    file: 'products.json',
    responseKey: 'products',
    filter: (rows, p) => rows.filter((r: any) => r.productName.includes(p.get('name') || '')),
    notFound: (p) => `未找到商品「${p.get('name')}」的库存记录`,
  },
  orders: {
    file: 'orders.json',
    responseKey: 'orders',
    filter: (rows, p) => {
      const name = p.get('customerName') || '';
      return name ? rows.filter((r: any) => r.customerName.includes(name)) : rows;  // 不传 = 全量
    },
    notFound: (p) => `未找到客户「${p.get('customerName')}」的订单`,
  },
};

export async function GET(
  request: Request,
  { params }: { params: { resource: string } }
) {
  const { resource } = params;
  const handler = HANDLERS[resource];

  // 未知资源：返回 400，顺带告诉 Agent 有哪些可用类型
  if (!handler) {
    return NextResponse.json(
      { error: `未知数据类型「${resource}」，可用：${Object.keys(HANDLERS).join(' / ')}` },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(request.url);
  console.log(`[mock API] 收到${resource}查询:`, searchParams.toString() || '(全部)');

  const filePath = path.join(process.cwd(), 'data', handler.file);
  const rows = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  const found = handler.filter(rows, searchParams);

  if (found.length === 0) {
    return NextResponse.json({ found: false, message: handler.notFound(searchParams) });
  }

  // 保持原契约：customers → customer，products/orders → 复数
  return NextResponse.json({ found: true, [handler.responseKey]: found });
}
