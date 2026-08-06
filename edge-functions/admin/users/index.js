import { json, nowTimestamp, hashPassword } from "../../_lib/util.js";
import { extractSession, isAdminUser } from "../../_lib/session.js";
import { usersList, userGet, userPut, audit } from "../../_lib/store.js";
import { PASSWORD_MIN, PASSWORD_MAX } from "../../_lib/config.js";

// GET /admin/users：用户列表（仅管理员）
export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (!isAdminUser(session.wxId, env)) return json({ error: "Forbidden" }, 403);
  const users = await usersList(env);
  return json(users.map((u) => ({ wxId: u.wx_id, level: u.level, createdAt: u.created_at })));
}

// POST /admin/users：管理员创建新用户（不校验 wxId 格式，仅要求不重复）
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
  const wxId = String(body.wxId || "").trim();
  const password = String(body.password || "");
  if (!wxId || wxId.length > 64) {
    return json({ error: "Invalid wxId (non-empty, ≤64 chars)" }, 400);
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX || password === wxId) {
    return json(
      {
        error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters and different from wxId`,
      },
      400
    );
  }
  if (await userGet(env, wxId)) {
    return json({ error: "This wxId already exists" }, 409);
  }
  const stored = await hashPassword(password);
  await userPut(env, {
    wx_id: wxId,
    password_hash: stored,
    level: 1,
    created_at: nowTimestamp(),
  });
  await audit(env, "admin_create_user", wxId);
  return json({ ok: true });
}
