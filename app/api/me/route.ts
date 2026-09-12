// app/api/me/route.ts —— 查询当前登录态
// 支持两种凭证：浏览器场景的 site_token cookie；小程序场景显式携带的 x-site-token 头
// （小程序对 Set-Cookie 的自动管理在真机上不可靠，改由前端手动携带）
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(req: Request) {
  try {
    const SITE_PASSWORD = process.env.SITE_PASSWORD || 'demo123';
    let token = '';

    // EdgeOne Pages 运行时 cookies() 可能不稳定，单独 try 避免整段挂掉
    try {
      token = cookies().get('site_token')?.value || '';
    } catch {}

    if (!token) {
      token = req.headers.get('x-site-token') || '';
    }

    return NextResponse.json({ loggedIn: token === SITE_PASSWORD });
  } catch {
    // 任何异常都返回未登录，让前端有状态可渲染，不能卡住
    return NextResponse.json({ loggedIn: false });
  }
}
