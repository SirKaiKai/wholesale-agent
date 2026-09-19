// app/api/mock/[resource]/route.ts —— 所有 mock 数据接口的"唯一入口"
// URL 结构不变：/api/mock/customers?name=张三 → resource = "customers"
// 以后新增数据（如对账单）：HANDLERS 加一行 + data/ 建一个 json，不用新建文件
//
// 字段名已对齐订单豹 ERP 真实表结构（sanbao_member / sanbao_order / erp_sku_stock），
// 详见 docs/ERP真实字段对照与Mock数据说明.md
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// 命中判定：任一候选字段包含关键词即算命中（空关键词 = 不筛选）
function hit(anyOf: any[], keyword: string): boolean {
  if (!keyword) return true;
  return anyOf.some((v) => typeof v === 'string' && v.includes(keyword));
}

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
    // 客户名不一定在 nickname 里，用公司全称（company_name）也要能查到
    filter: (rows, p) =>
      rows.filter((r: any) => hit([r.nickname, r.realname, r.company_name], (p.get('name') || '').trim())),
    notFound: (p) => `未找到客户「${p.get('name')}」的欠款记录`,
  },
  products: {
    file: 'products.json',
    responseKey: 'products',
    filter: (rows, p) =>
      rows.filter((r: any) => hit([r.sku_name, r.sku_no, r.brand_name], (p.get('name') || '').trim())),
    notFound: (p) => `未找到商品「${p.get('name')}」的库存记录`,
  },
  orders: {
    file: 'orders.json',
    responseKey: 'orders',
    filter: (rows, p) => {
      // ① 优先按 member_id 精确匹配 —— 工作流"两跳"的第二跳用这个（比姓名可靠）
      const memberId = p.get('memberId');
      if (memberId) return rows.filter((r: any) => String(r.member_id) === memberId);

      // ② 按客户名模糊匹配；不传 = 全量（保留原行为）
      const name = (p.get('name') || '').trim();
      if (!name) return rows;
      return rows.filter((r: any) => hit([r.member_name, r.member_short_name], name));
    },
    notFound: (p) =>
      p.get('memberId')
        ? `未找到会员 ID「${p.get('memberId')}」的订单`
        : `未找到客户「${p.get('name')}」的订单`,
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
