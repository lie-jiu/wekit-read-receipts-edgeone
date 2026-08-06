import { json, getClientIP, nowTimestamp, rateLimit, computeId } from "./_lib/util.js";
import {
  userGet,
  messageGet,
  messagePut,
  enforceQuota,
  regStatsInc,
} from "./_lib/store.js";
import { REGISTER_RATE_LIMIT, MESSAGE_CONTENT_MAX } from "./_lib/config.js";

// POST /register：注册消息（无需登录，wxId 必须是已注册账号）
export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = getClientIP(request);
  // fail-open：客户端注册失败只是静默丢一条，不应因限流故障断送功能
  if (!(await rateLimit("regmsg:" + ip, REGISTER_RATE_LIMIT, 60, false))) {
    return json({ error: "Too Many Requests" }, 429);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { wxId, content, createTime } = body;
  if (!wxId || !content || createTime == null) {
    return json({ error: "Missing fields: wxId, content, createTime" }, 400);
  }
  if (
    typeof wxId !== "string" ||
    wxId.length > 64 ||
    typeof content !== "string" ||
    content.length > MESSAGE_CONTENT_MAX
  ) {
    return json(
      {
        error: `Invalid fields: wxId (string ≤64 chars), content (string ≤${MESSAGE_CONTENT_MAX} chars)`,
      },
      400
    );
  }
  const user = await userGet(env, wxId);
  if (!user) {
    return json({ error: "Forbidden: wxId is not registered" }, 403);
  }
  if (user.level === 0) {
    return json({ error: "Forbidden: account is blocked (level 0)" }, 403);
  }
  const id = await computeId(wxId, content, createTime);
  // 已存在的消息直接返回相同 id（幂等，重复注册不触发配额清理）
  if (!(await messageGet(env, wxId, id))) {
    await messagePut(env, {
      id,
      wx_id: wxId,
      content,
      timestamp: nowTimestamp(),
    });
    try {
      await enforceQuota(env, wxId, user.level);
    } catch {}
    // 排行榜按「注册过多少条消息」累计统计（只增不减）；失败不影响主流程
    try {
      await regStatsInc(env, wxId);
    } catch {}
  }
  return json({ id });
}
