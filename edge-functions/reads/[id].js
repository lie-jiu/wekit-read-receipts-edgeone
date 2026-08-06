import { json } from "../_lib/util.js";
import { extractSession } from "../_lib/session.js";
import { messageGetById, readList, enforceQuota } from "../_lib/store.js";

// GET /reads/{id}：本人消息的读取详情（先校验归属）
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
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
  if (!msg || msg.wx_id !== session.wxId) {
    return json({ error: "Not Found" }, 404);
  }
  try {
    await enforceQuota(env, session.wxId, session.level);
  } catch {}
  const reads = await readList(env, id);
  reads.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return json(reads);
}
