import { json } from "../_lib/util.js";
import { extractSession } from "../_lib/session.js";
import { userMessages, readCountGet, enforceQuota, deleteUserMessages } from "../_lib/store.js";
import { audit } from "../_lib/store.js";

async function ownMessages(env, session, q) {
  try {
    await enforceQuota(env, session.wxId, session.level);
  } catch {}
  const msgs = await userMessages(env, session.wxId);
  const kw = (q || "").toLowerCase();
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
  return rows;
}

// GET /messages：本人全部消息（可按内容过滤）
export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").slice(0, 200);
  return json(await ownMessages(env, session, q));
}

// DELETE /messages：删除本人全部消息与已读记录（排行榜统计保留，只增不减）
export async function onRequestDelete(context) {
  const { request, env } = context;
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  await deleteUserMessages(env, session.wxId);
  await audit(env, "delete_all", session.wxId);
  return json({ status: "ok" });
}
