// middleware.ts —— 整个网站的门卫
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SITE_PASSWORD = process.env.SITE_PASSWORD || 'demo123';

/**
 * 白名单路径：不需要登录就能访问
 * - /login          登录页面本身（必须放行，否则未登录用户访问根会陷入死循环）
 * - /api/login      开锁接口（必须先放行，否则永远登录不上）
 * - /api/mock/**    Agent 工具内部调用的 mock 数据接口（生产部署没有这些路径）
 *
 * 教训：写鉴权时一定要列「白名单路径」，避免"门卫卡住自家钥匙"的死锁
 */
function isPublicPath(pathname: string) {
  if (pathname === '/login') return true;
  if (pathname === '/api/login') return true;
  if (pathname === '/api/mock' || pathname.startsWith('/api/mock/')) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. 白名单直接放行
  if (isPublicPath(pathname)) return NextResponse.next();

  // 2. 已登录放行
  const token = req.cookies.get('site_token')?.value;
  if (token === SITE_PASSWORD) return NextResponse.next();

  // 3. 未登录
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

// 哪些路径要进 middleware（排除静态资源就够了，业务白名单交给 isPublicPath）
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};