export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';

export default async function middleware(request: NextRequest) {
  // 加速域名（可通过环境变量覆盖）
  const ACCEL_DOMAIN = process.env.NEXT_PUBLIC_ACCEL_DOMAIN || 'www.090902.xyz';
  if (request.nextUrl.hostname !== ACCEL_DOMAIN) {
    return new NextResponse('CDN: 域名未授权', { status: 403 });
  }

  // 源站信息
  const ORIGIN_HOST = process.env.ORIGIN_HOST || '45.207.210.202';
  const ORIGIN_PROTO = 'https';

  const originUrl = `${ORIGIN_PROTO}://${ORIGIN_HOST}${request.nextUrl.pathname}${request.nextUrl.search}`;

  // 提取客户端真实 IP
  const realIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  // 构造转发请求头
  const headers = new Headers(request.headers);
  headers.set('X-Real-IP', realIp);

  const fetchOptions: RequestInit & { duplex?: string; tls?: any } = {
    method: request.method,
    headers,
    ...(request.method !== 'GET' && request.method !== 'HEAD'
      ? { body: request.body, duplex: 'half' }
      : {}),
    // 忽略源站证书信任
    // @ts-ignore
    tls: { rejectUnauthorized: false },
  };

  // 预检请求直接返回
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    const originRes = await fetch(originUrl, fetchOptions);

    if (!originRes.ok && originRes.status >= 500) {
      console.error(`源站 ${originRes.status}：${originUrl}`);
      return new NextResponse('CDN: 源站故障', { status: 502 });
    }

    const responseHeaders = new Headers(originRes.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Vercel-CDN-Cache', 'HIT');

    return new NextResponse(originRes.body, {
      status: originRes.status,
      statusText: originRes.statusText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error(`回源连接失败：${err.message}`);
    return new NextResponse('CDN: 无法连接源站', { status: 502 });
  }
}

export const config = {
  matcher: [
    // 排除静态资源，其他全部走中间件
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|map|woff|woff2|ttf|eot)$).*)',
  ],
};