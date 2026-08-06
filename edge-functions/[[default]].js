import { SECURITY_HEADERS } from "./_lib/config.js";

// 兜底路由：favicon 与未匹配路径
export function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname === "/favicon.ico") {
    return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS } });
  }
  return new Response("Not Found", { status: 404, headers: { ...SECURITY_HEADERS } });
}
