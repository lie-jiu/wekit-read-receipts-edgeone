import {
  json,
  jsonWithCookie,
  getClientIP,
  nowTimestamp,
  safeEquals,
  sleep,
  rateLimit,
  hashPassword,
} from "../_lib/util.js";
import { userGet, userPut, audit } from "../_lib/store.js";
import { createSessionCookie } from "../_lib/session.js";
import {
  WXID_RE,
  PASSWORD_MIN,
  PASSWORD_MAX,
  AUTH_RATE_LIMIT,
} from "../_lib/config.js";

// POST /auth/register：自助注册（wxid 即账号）
export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = getClientIP(request);
  if (!(await rateLimit("register:" + ip, AUTH_RATE_LIMIT, 60, true))) {
    return json({ error: "Too many attempts. Try again later." }, 429);
  }
  const formData = await request.formData();
  const wxId = String(formData.get("wxId") || "").trim();
  const password = String(formData.get("password") || "");
  const password2 = String(formData.get("password2") || "");
  const invite = String(formData.get("invite") || "").trim();
  if (!WXID_RE.test(wxId)) {
    return json(
      {
        error:
          "wxId must match pattern: wxid_ followed by 14 lowercase letters/digits (e.g. wxid_abc123def4567g)",
      },
      400
    );
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return json({ error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters` }, 400);
  }
  if (password === wxId) {
    return json({ error: "Password cannot be the same as wxId" }, 400);
  }
  if (password !== password2) {
    return json({ error: "Passwords do not match" }, 400);
  }
  if (env.INVITE_CODE) {
    if (!(await safeEquals(invite, env.INVITE_CODE))) {
      await sleep(250 + Math.random() * 500);
      return json({ error: "Invalid invite code" }, 403);
    }
  }
  if (await userGet(env, wxId)) {
    return json({ error: "This wxId is already registered" }, 409);
  }
  const stored = await hashPassword(password);
  await userPut(env, {
    wx_id: wxId,
    password_hash: stored,
    level: 1,
    created_at: nowTimestamp(),
  });
  await audit(env, "user_register", wxId);
  const cookie = await createSessionCookie(env, wxId);
  if (!cookie) return json({ error: "Session creation failed" }, 500);
  return jsonWithCookie({ ok: true, redirect: "/" }, cookie);
}
