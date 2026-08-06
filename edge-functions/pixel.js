import { PNG_1x1 } from "./_lib/png.js";
import { getClientIP, nowTimestamp, rateLimit, pixelParams } from "./_lib/util.js";
import { messageGet, readMark, readStatsInc, msgStatsInc } from "./_lib/store.js";
import { PIXEL_RATE_LIMIT, SECURITY_HEADERS } from "./_lib/config.js";

// GET /pixel：追踪像素。对已注册的消息记录一次去重已读（同 IP 只计 1 次）
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { wxId, id } = pixelParams(url);
  if (!wxId || !id || wxId.length > 64 || id.length > 64) {
    return new Response("Bad Request", { status: 400, headers: { ...SECURITY_HEADERS } });
  }
  const ip = getClientIP(request);
  if (ip === "unknown") {
    return new Response("Bad Request", { status: 400, headers: { ...SECURITY_HEADERS } });
  }
  if (!(await rateLimit("pixel:" + ip, PIXEL_RATE_LIMIT, 60, false))) {
    return new Response("Too Many Requests", { status: 429, headers: { ...SECURITY_HEADERS } });
  }
  const msg = await messageGet(env, wxId, id);
  if (!msg) {
    return new Response("Not Found", { status: 404, headers: { ...SECURITY_HEADERS } });
  }
  const isNew = await readMark(env, id, ip);
  // 排行榜统计（只增不减，不受配额清理影响）；失败不影响像素主流程
  if (isNew) {
    try {
      await readStatsInc(env, wxId);
      await msgStatsInc(env, id, wxId, msg.content);
    } catch {}
  }
  return new Response(PNG_1x1, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": "67",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      ...SECURITY_HEADERS,
    },
  });
}

export const onRequest = onRequestGet;
