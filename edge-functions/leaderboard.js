import { json } from "./_lib/util.js";
import { extractSession } from "./_lib/session.js";
import { leaderboard } from "./_lib/store.js";
import { maskWxId, maskContent } from "./_lib/util.js";

// GET /leaderboard：注册/已读/消息排行榜（需登录；wxid 服务端脱敏）
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const params = url.searchParams;
  const scope = params.get("scope") || "total";
  const metric = params.get("metric") || "reg";
  if (scope !== "day" && scope !== "total") {
    return json({ error: "Invalid scope: must be day or total" }, 400);
  }
  if (metric !== "reg" && metric !== "read" && metric !== "msg") {
    return json({ error: "Invalid metric: must be reg, read or msg" }, 400);
  }
  const session = await extractSession(request, env);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const rows = await leaderboard(env, metric, scope);
  if (metric === "msg") {
    return json(
      rows.map((r) => ({
        id: r.id,
        wxId: maskWxId(r.wxId),
        content: maskContent(r.content),
        count: r.count,
        me: r.wxId === session.wxId,
      }))
    );
  }
  return json(
    rows.map((r) => ({
      wxId: maskWxId(r.wxId),
      count: r.count,
      me: r.wxId === session.wxId,
    }))
  );
}
