// middleware.ts —— 整个网站的门卫
// 关键改动：根路径 / 不再重定向到 /login。
// 原因：EdgeOne Pages 预览链接下，应用 middleware 重定向 / → /login
// 会触发边缘层对 Location 的强制重写，造成 ERR_TOO_MANY_REDIRECTS。
// 新策略：根路径 / 直接放行，由 app/page.tsx 内部按 /api/me 登录态切换 LoginForm / ChatPage。
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SITE_PASSWORD = process.env.SITE_PASSWORD || 'demo123';

/**
 * 白名单路径：不需要登录就能访问
 * - /                  根路径（直接渲染登录页或聊天页，由 page.tsx 决定）
 * - /api/login         开锁接口（必须先放行，否则永远登录不上）
 * - /api/me            登录态查询接口（前端用，无 cookie 也能访问用于判断渲染）
 * - /api/mock/**       Agent 工具内部调用的 mock 数据接口（生产部署没有这些路径）
 *
 * 教训：写鉴权时一定要列「白名单路径」，避免"门卫卡住自家钥匙"的死锁；
 * 同时在 EdgeOne Pages 预览域名下尽量避免 server-side 重定向。
 */
function isPublicPath(pathname: string) {
  if (pathname === '/') return true;
  if (pathname === '/api/login') return true;
  if (pathname === '/api/me') return true;
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

  // 3. 未登录：API 直接 401；页面本来也都被 isPublicPath 覆盖了（根路径放行），
  //    其他罕见页面兜底也走 401 而不是重定向（避免 EdgeOne 重写循环）
  return NextResponse.json({ error: '未授权' }, { status: 401 });
}

// 哪些路径要进 middleware（排除静态资源就够了，业务白名单交给 isPublicPath）
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};