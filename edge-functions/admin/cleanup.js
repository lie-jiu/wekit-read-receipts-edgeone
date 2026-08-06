import { json } from "../_lib/util.js";
import { extractSession, isAdminUser } from "../_lib/session.js";
import { cleanup, audit } from "../_lib/store.js";

// POST /admin/cleanup：手动触发清理（替代 CF cron 定时任务）
// 清理：过期会话 + 超期审计日志。建议管理员定期手动触发，或借助
// EdgeOne 控制台的定时触发器/外部 cron 调用本接口。
export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (!isAdminUser(session.wxId, env)) return json({ error: "Forbidden" }, 403);
  try {
    await cleanup(env);
    await audit(env, "manual_cleanup", "ok");
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e && e.message ? e.message : "Cleanup failed" }, 500);
  }
}
