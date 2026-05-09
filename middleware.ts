// 强制使用 Edge Runtime
export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { Buffer } from 'node:buffer';

export default async function middleware(request: NextRequest) {
  // 只代理加速域名，建议用环境变量便于复用；本地调试可用 localhost
  const ACCEL_DOMAIN = process.env.NEXT_PUBLIC_ACCEL_DOMAIN || 'www.090902.xyz';
  if (request.nextUrl.hostname !== ACCEL_DOMAIN) {
    console.warn(`非法加速域名：${request.nextUrl.hostname}`);
    return new NextResponse('CDN: 加速域名不匹配', { status: 403 });
  }

  // 源站信息（可从环境变量读取）
  const ORIGIN_HOST = process.env.ORIGIN_HOST || '45.207.210.202';
  const ORIGIN_PROTO = 'https';

  // 拼接源站 URL
  const originUrl = `${ORIGIN_PROTO}://${ORIGIN_HOST}${request.nextUrl.pathname}${request.nextUrl.search}`;

  // 准备转发请求头：保留原始头部，并附加 X-Real-IP
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(
    'X-Real-IP',
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );

  // 回源请求配置：关闭 TLS 证书验证（仅限边缘函数内部，不暴露给浏览器）
  const fetchOptions: RequestInit & { duplex?: string } = {
    method: request.method,
    headers: forwardedHeaders,
    // 非 GET/HEAD 请求需要把 body 带上
    ...(request.method !== 'GET' && request.method !== 'HEAD' && {
      body: request.body,
      duplex: 'half',
    }),
    // 忽略证书信任（自签名/过期证书也可正常回源）
    // @ts-ignore
    tls: { rejectUnauthorized: false },
  };

  // 处理预检请求（OPTIONS）
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
    const originResponse = await fetch(originUrl, fetchOptions);

    // 回源失败统一返回 502
    if (!originResponse.ok && originResponse.status >= 500) {
      console.error(`回源失败：${originUrl}，状态码：${originResponse.status}`);
      return new NextResponse('CDN: 回源失败', { status: 502 });
    }

    // 构造响应头，追加 CDN 缓存头及 CORS
    const responseHeaders = new Headers(originResponse.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Vercel-CDN-Cache', 'HIT');
    // 可进一步设置缓存策略，例如：
    // responseHeaders.set('CDN-Cache-Control', 'max-age=3600');

    return new NextResponse(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error(`CDN 代理异常：${error.message}`);
    return new NextResponse('CDN: 源站连接失败', { status: 502 });
  }
}

export const config = {
  // 拦截所有路径（除 _next/static 等内部资源）
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|map|woff|woff2|ttf|eot)$).*)'],
};