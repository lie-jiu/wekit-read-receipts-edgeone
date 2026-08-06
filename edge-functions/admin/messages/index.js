import { json } from "../../_lib/util.js";
import { extractSession, isAdminUser } from "../../_lib/session.js";
import { allMessages, readCountGet, deleteUserMessages, deleteUserStats, audit } from "../../_lib/store.js";

// GET /admin/messages：全量消息（可按 wxId / 内容过滤；仅管理员）
export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (!isAdminUser(session.wxId, env)) return json({ error: "Forbidden" }, 403);
  const url = new URL(request.url);
  const params = url.searchParams;
  const q = (params.get("q") || "").slice(0, 200).toLowerCase();
  const fwx = (params.get("wxId") || "").slice(0, 64);
  const msgs = await allMessages(env);
  const rows = [];
  for (const m of msgs) {
    if (fwx && m.wx_id !== fwx) continue;
    if (q && !String(m.content).toLowerCase().includes(q)) continue;
    rows.push({
      id: m.id,
      wxId: m.wx_id,
      content: m.content,
      timestamp: m.timestamp,
      reads: await readCountGet(env, m.id),
    });
  }
  rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return json(rows);
}

// DELETE /admin/messages?wxId=xxx：删除某用户的全部数据（仅管理员）
export async function onRequestDelete(context) {
  const { request, env } = context;
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (!isAdminUser(session.wxId, env)) return json({ error: "Forbidden" }, 403);
  const url = new URL(request.url);
  const wxId = (url.searchParams.get("wxId") || "").slice(0, 64);
  if (!wxId) return json({ error: "Missing wxId param" }, 400);
  await deleteUserMessages(env, wxId);
  await deleteUserStats(env, wxId);
  await audit(env, "admin_delete_wxid", wxId);
  return json({ ok: true });
}
