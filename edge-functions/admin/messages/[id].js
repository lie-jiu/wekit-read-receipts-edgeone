import { json } from "../../_lib/util.js";
import { extractSession, isAdminUser } from "../../_lib/session.js";
import { messageGetById, deleteMessageData, audit } from "../../_lib/store.js";

// DELETE /admin/messages/{id}：删除单条消息及其读取记录（仅管理员）
export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (!isAdminUser(session.wxId, env)) return json({ error: "Forbidden" }, 403);
  let id;
  try {
    id = decodeURIComponent(params.id);
  } catch {
    return json({ error: "Invalid id encoding" }, 400);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(id)) {
    return json({ error: "Invalid id" }, 400);
  }
  const msg = await messageGetById(env, id);
  if (!msg) return json({ error: "Not Found" }, 404);
  await deleteMessageData(env, msg.wx_id, id);
  await audit(env, "admin_delete_message", id);
  return json({ ok: true });
}
