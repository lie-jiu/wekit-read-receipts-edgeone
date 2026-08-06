import {
  json,
  getClientIP,
  rateLimit,
  hashPassword,
  passwordMatches,
} from "../_lib/util.js";
import { userGet, userPut, audit } from "../_lib/store.js";
import { extractSession, revokeOtherSessions } from "../_lib/session.js";
import { PASSWORD_MIN, PASSWORD_MAX, AUTH_RATE_LIMIT } from "../_lib/config.js";

// POST /auth/password：修改自己的密码（需要会话）
export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = getClientIP(request);
  if (!(await rateLimit("passwd:" + ip, AUTH_RATE_LIMIT, 60, true))) {
    return json({ error: "Too Many Requests" }, 429);
  }
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const oldP = String(body.oldPassword || "");
  const newP = String(body.newPassword || "");
  const user = await userGet(env, session.wxId);
  if (!user || !(await passwordMatches(oldP, user.password_hash))) {
    return json({ error: "Current password is incorrect" }, 403);
  }
  if (newP.length < PASSWORD_MIN || newP.length > PASSWORD_MAX || newP === session.wxId) {
    return json(
      {
        error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters and different from wxId`,
      },
      400
    );
  }
  user.password_hash = await hashPassword(newP);
  await userPut(env, user);
  await audit(env, "password_change", session.wxId);
  await revokeOtherSessions(request, env, session.wxId);
  return json({ ok: true });
}
