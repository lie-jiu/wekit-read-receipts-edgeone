import { json, hashPassword } from "../_lib/util.js";
import { extractSession, isAdminUser, revokeOtherSessions } from "../_lib/session.js";
import { userGet, userPut, audit } from "../_lib/store.js";
import { PASSWORD_MIN, PASSWORD_MAX } from "../_lib/config.js";

// POST /admin/password：为任意用户设置新密码（仅管理员）
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
  const password = String(body.password || "");
  if (!wxId) return json({ error: "Missing wxId" }, 400);
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX || password === wxId) {
    return json(
      {
        error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters and different from wxId`,
      },
      400
    );
  }
  const user = await userGet(env, wxId);
  if (!user) return json({ error: "User not found" }, 404);
  user.password_hash = await hashPassword(password);
  await userPut(env, user);
  await audit(env, "admin_set_password", wxId);
  await revokeOtherSessions(request, env, wxId);
  return json({ ok: true });
}
