import { json } from "../_lib/util.js";
import { extractSession } from "../_lib/session.js";
import { userMessages, readCountGet, enforceQuota, deleteUserMessages } from "../_lib/store.js";
import { audit } from "../_lib/store.js";

// GET/DELETE /messages/{wxId}：本人指定发送者（必须等于自己）
export async function onRequest(context) {
  const { request, env, params } = context;
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  let wxId;
  try {
    wxId = decodeURIComponent(params.wxId);
  } catch {
    return json({ error: "Invalid wxId encoding" }, 400);
  }
  if (wxId !== session.wxId) {
    return json({ error: "Forbidden: wxId must match your account" }, 403);
  }
  const method = request.method;
  if (method === "DELETE") {
    await deleteUserMessages(env, wxId);
    await audit(env, "delete_wxid", wxId);
    return json({ status: "ok" });
  }
  if (method === "GET") {
    try {
      await enforceQuota(env, wxId, session.level);
    } catch {}
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").slice(0, 200);
    const kw = q.toLowerCase();
    const msgs = await userMessages(env, wxId);
    const rows = [];
    for (const m of msgs) {
      if (kw && !String(m.content).toLowerCase().includes(kw)) continue;
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
  return json({ error: "Method Not Allowed" }, 405);
}
