import { adminPage } from "../_lib/pages/admin.js";
import { extractSession, isAdminUser } from "../_lib/session.js";
import { SECURITY_HEADERS, DASHBOARD_CSP } from "../_lib/config.js";

// GET /admin：管理后台页面（仅管理员）
export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await extractSession(request, env);
  if (!session) return new Response("Unauthorized", { status: 401, headers: { ...SECURITY_HEADERS } });
  if (!isAdminUser(session.wxId, env)) {
    return new Response("Forbidden", { status: 403, headers: { ...SECURITY_HEADERS } });
  }
  return new Response(adminPage(session), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": DASHBOARD_CSP,
      ...SECURITY_HEADERS,
    },
  });
}

export const onRequest = onRequestGet;
