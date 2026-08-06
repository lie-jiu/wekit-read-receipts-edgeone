import { json } from "../../_lib/util.js";
import { extractSession, isAdminUser } from "../../_lib/session.js";
import { readList } from "../../_lib/store.js";

// GET /admin/reads/{id}：查看任意消息的读取详情（仅管理员）
export async function onRequestGet(context) {
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
  const reads = await readList(env, id);
  reads.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return json(reads);
}
