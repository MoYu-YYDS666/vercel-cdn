export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';

export default async function middleware(request: NextRequest) {
  // 验证加速域名（支持环境变量）
  const ACCEL_DOMAIN = process.env.NEXT_PUBLIC_ACCEL_DOMAIN || 'www.090902.xyz';
  if (request.nextUrl.hostname !== ACCEL_DOMAIN) {
    return new NextResponse('CDN: 域名未授权', { status: 403 });
  }

  // 源站配置（推荐通过环境变量传入）
  const ORIGIN_HOST = process.env.ORIGIN_HOST || '45.207.210.202';
  const ORIGIN_PROTO = 'https';

  const originUrl = `${ORIGIN_PROTO}://${ORIGIN_HOST}${request.nextUrl.pathname}${request.nextUrl.search}`;

  // 提取用户真实 IP
  const realIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  // 复制请求头，附加 X-Real-IP
  const headers = new Headers(request.headers);
  headers.set('X-Real-IP', realIp);

  // 构造回源请求参数
  const fetchOptions: RequestInit & { duplex?: string; tls?: any } = {
    method: request.method,
    headers,
    // 非 GET/HEAD 请求需要携带 body
    ...(request.method !== 'GET' && request.method !== 'HEAD'
      ? { body: request.body, duplex: 'half' }
      : {}),
    // 关键：忽略源站证书校验
    // @ts-ignore
    tls: { rejectUnauthorized: false },
  };

  // 处理预检请求
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
    const res = await fetch(originUrl, fetchOptions);

    // 源站 5xx 统一返回 502
    if (!res.ok && res.status >= 500) {
      console.error(`源站响应异常：${res.status} ${originUrl}`);
      return new NextResponse('CDN: 源站不可用', { status: 502 });
    }

    // 透传响应，并添加 CORS 及 CDN 标识头
    const responseHeaders = new Headers(res.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Vercel-CDN-Cache', 'HIT');

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error(`回源请求失败：${error.message}`);
    return new NextResponse('CDN: 连接源站失败', { status: 502 });
  }
}

export const config = {
  matcher: [
    // 排除 Next.js 内部资源、静态文件等
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|map|woff|woff2|ttf|eot)$).*)',
  ],
};