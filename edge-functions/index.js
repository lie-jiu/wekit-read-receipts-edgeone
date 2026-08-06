import { LOGIN_HTML } from "./_lib/pages/login.js";
import { htmlPage } from "./_lib/pages/dashboard.js";
import { extractSession } from "./_lib/session.js";
import { SECURITY_HEADERS, LOGIN_CSP, DASHBOARD_CSP } from "./_lib/config.js";

// GET /：未登录显示登录页，已登录显示仪表盘
export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await extractSession(request, env);
  if (!session) {
    return new Response(LOGIN_HTML, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": LOGIN_CSP,
        ...SECURITY_HEADERS,
      },
    });
  }
  return new Response(htmlPage(session), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": DASHBOARD_CSP,
      ...SECURITY_HEADERS,
    },
  });
}
