import { json, jsonWithCookie, getClientIP, sleep, rateLimit, passwordMatches } from "../_lib/util.js";
import { userGet } from "../_lib/store.js";
import { createSessionCookie } from "../_lib/session.js";
import { AUTH_RATE_LIMIT } from "../_lib/config.js";

// POST /auth/verify：wxid + 密码登录
export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = getClientIP(request);
  if (!(await rateLimit("verify:" + ip, AUTH_RATE_LIMIT, 60, true))) {
    return json({ error: "Too Many Requests" }, 429);
  }
  const formData = await request.formData();
  const wxId = String(formData.get("wxId") || "").trim();
  const password = String(formData.get("password") || "");
  const user = await userGet(env, wxId);
  const ok = user && (await passwordMatches(password, user.password_hash));
  if (!ok) {
    // 失败延迟：进一步抬高暴力破解成本
    await sleep(250 + Math.random() * 500);
    return json({ error: "Invalid wxId or password" }, 401);
  }
  const cookie = await createSessionCookie(env, wxId);
  if (!cookie) return json({ error: "Session creation failed" }, 500);
  return jsonWithCookie({ ok: true, redirect: "/" }, cookie);
}
