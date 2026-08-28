// app/api/me/route.ts —— 查询当前登录态
// 因为 site_token 是 httpOnly cookie，前端 JS 读不到，
// 必须通过这个接口让服务端代为判断后返回结果。
// middleware 已放行此路径。
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const SITE_PASSWORD = process.env.SITE_PASSWORD || 'demo123';
  const token = cookies().get('site_token')?.value;
  return NextResponse.json({ loggedIn: token === SITE_PASSWORD });
}