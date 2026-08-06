import { json } from "./_lib/util.js";
import { userGet, messageGet, readCountGet, enforceQuota } from "./_lib/store.js";

// GET /count：获取消息的去重已读次数（无需登录，通过 wxId 指定账号）
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const params = url.searchParams;
  const wxId = params.get("wxId") || "";
  const id = params.get("id") || "";
  if (!wxId || !id) return json({ error: "Missing wxId or id" }, 400);
  const user = await userGet(env, wxId);
  if (user) {
    try {
      await enforceQuota(env, wxId, user.level);
    } catch {}
  }
  const msg = await messageGet(env, wxId, id);
  if (!msg) return json({ error: "Not Found" }, 404);
  return json({ count: await readCountGet(env, id) });
}
