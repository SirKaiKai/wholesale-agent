// app/api/me/route.ts —— 查询当前登录态
// 支持两种凭证：浏览器场景的 site_token cookie；小程序场景显式携带的 x-site-token 头
// （小程序对 Set-Cookie 的自动管理在真机上不可靠，改由前端手动携带）
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(req: Request) {
  const SITE_PASSWORD = process.env.SITE_PASSWORD || 'demo123';
  const token = cookies().get('site_token')?.value || req.headers.get('x-site-token') || '';
  return NextResponse.json({ loggedIn: token === SITE_PASSWORD });
}
