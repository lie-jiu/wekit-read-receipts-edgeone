import { json } from "../../_lib/util.js";
import { extractSession, isAdminUser } from "../../_lib/session.js";
import { userDel, deleteUserData, audit } from "../../_lib/store.js";

// DELETE /admin/users/{wxId}：删除用户及其全部数据（仅管理员）
export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (!isAdminUser(session.wxId, env)) return json({ error: "Forbidden" }, 403);
  let wxId;
  try {
    wxId = decodeURIComponent(params.wxId);
  } catch {
    return json({ error: "Invalid wxId encoding" }, 400);
  }
  if (wxId === session.wxId) {
    return json({ error: "You cannot delete your own account" }, 400);
  }
  if (isAdminUser(wxId, env)) {
    return json(
      { error: "This wxId is in the ADMIN list; remove it from the ADMIN variable first" },
      400
    );
  }
  await deleteUserData(env, wxId);
  await userDel(env, wxId);
  await audit(env, "user_delete", wxId);
  return json({ ok: true });
}
