import { destroySession } from "../_lib/session.js";
import { SECURITY_HEADERS } from "../_lib/config.js";

// POST /auth/logout：销毁会话
export async function onRequestPost(context) {
  const { request, env } = context;
  await destroySession(request, env);
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "__Host-session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      ...SECURITY_HEADERS,
    },
  });
}
