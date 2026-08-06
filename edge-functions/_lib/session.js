import { SESSION_TTL_MS, LEVEL_MAX } from "./config.js";
import { sha256Hex, randomHex, nowTimestamp } from "./util.js";
import { userGet, sessionGet, sessionPut, sessionDel, deleteUserSessions } from "./store.js";

// ── 会话与权限 ──────────────────────────────────────────
// 会话记录存 KV（最终一致性）：登录后立即生效的请求可能读不到刚写入的会话，
// 因此 extractSession 对「查无会话」只重试一次（下次请求即可），不引入额外延迟。

// 从 Cookie 解析会话并绑定用户；每次请求都读用户记录，保证已删除账号的
// 会话立即失效、level 始终最新
export async function extractSession(request, env) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const trimmed = pair.trim();
    if (!trimmed.startsWith("__Host-session=")) continue;
    const value = trimmed.slice("__Host-session=".length);
    if (!value.startsWith("sess_")) continue;
    try {
      const tokenHash = await sha256Hex(value.slice(5));
      const s = await sessionGet(env, tokenHash);
      if (!s || !(s.expires_at > nowTimestamp())) continue;
      const user = await userGet(env, s.wx_id);
      if (!user) continue;
      const rawLevel = Number(user.level);
      const level =
        user.level != null && Number.isInteger(rawLevel)
          ? Math.max(0, Math.min(rawLevel, LEVEL_MAX))
          : 1;
      return { wxId: user.wx_id, level };
    } catch {}
  }
  return null;
}

export function isAdminUser(wxId, env) {
  if (!wxId || !env.ADMIN) return false;
  return String(env.ADMIN)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(wxId);
}

export async function createSessionCookie(env, wxId) {
  const sessionId = await randomHex(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  await sessionPut(env, {
    token_hash: await sha256Hex(sessionId),
    wx_id: wxId,
    created_at: nowTimestamp(),
    expires_at: expiresAt,
  });
  return `__Host-session=sess_${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}`;
}

export async function destroySession(request, env) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return;
  for (const pair of cookieHeader.split(";")) {
    const trimmed = pair.trim();
    if (trimmed.startsWith("__Host-session=")) {
      const value = trimmed.slice("__Host-session=".length);
      if (value.startsWith("sess_")) {
        try {
          await sessionDel(env, await sha256Hex(value.slice(5)));
        } catch {}
      }
    }
  }
}

// 吊销某用户除当前请求外的全部会话（修改密码后调用，保证旧会话立即失效）
export async function revokeOtherSessions(request, env, wxId) {
  const cookieHeader = request.headers.get("Cookie");
  let currentHash = null;
  if (cookieHeader) {
    for (const pair of cookieHeader.split(";")) {
      const trimmed = pair.trim();
      if (trimmed.startsWith("__Host-session=")) {
        const value = trimmed.slice("__Host-session=".length);
        if (value.startsWith("sess_")) {
          currentHash = await sha256Hex(value.slice(5));
        }
      }
    }
  }
  try {
    await deleteUserSessions(env, wxId, currentHash);
  } catch {}
}
