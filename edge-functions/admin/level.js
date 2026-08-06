import { json } from "../_lib/util.js";
import { extractSession, isAdminUser } from "../_lib/session.js";
import { userGet, userPut, deleteUserMessages, deleteUserStats, audit } from "../_lib/store.js";
import { LEVEL_MAX } from "../_lib/config.js";

// POST /admin/level：调整用户等级（仅管理员）
export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (!isAdminUser(session.wxId, env)) return json({ error: "Forbidden" }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const wxId = String(body.wxId || "");
  const level = Number(body.level);
  if (!wxId || !Number.isInteger(level) || level < 0 || level > LEVEL_MAX) {
    return json({ error: `Invalid wxId or level (must be integer 0-${LEVEL_MAX})` }, 400);
  }
  const user = await userGet(env, wxId);
  if (!user) return json({ error: "User not found" }, 404);
  user.level = level;
  await userPut(env, user);
  // 等级 0 = 拉黑：立即清空其全部消息、已读记录与排行统计（账号保留）
  if (level === 0) {
    await deleteUserMessages(env, wxId);
    await deleteUserStats(env, wxId);
  }
  await audit(env, "set_level", level === 0 ? `${wxId} -> 0 (data wiped)` : `${wxId} -> ${level}`);
  return json({ ok: true });
}
