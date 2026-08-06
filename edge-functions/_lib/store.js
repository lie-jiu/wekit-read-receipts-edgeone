import { LEVEL_MAX, AUDIT_LOG_RETENTION_DAYS } from "./config.js";
import { hex, tsKey, nowTimestamp, sha256Hex, randomHex, chinaDate } from "./util.js";

// ── KV 键设计（仅限数字/字母/下划线）──────────────────
//   u_{hex(wxId)}               用户记录
//   m_{hex(wxId)}_{id}          消息（id 为 64 位 hex）
//   r_{id}_{sha256(ip)}         已读去重标记（值含真实 IP 与时间；已读人数由此派生）
//   s_{sha256(token)}           会话
//   a_{tsKey}_{rand}            审计日志
//   gs_{hex(wxId)}_{date}       注册消息统计（按用户×日累计）
//   rs_{hex(wxId)}_{date}       已读统计（按用户×日累计）
//   ms_{id}_{date}              消息已读统计（按消息×日累计）
//
// 说明：
// - KV 绑定后为全局变量（控制台绑定时的变量名，代码默认使用 my_kv）；
//   store() 做兜底，dev 或别名场景下也支持 env.KV。
// - KV 最终一致性 ≤60s：同一 IP 短时间内重复上报时，去重标记可能
//   短暂不可见导致重复计数（原 D1 用 INSERT OR IGNORE 原子去重），
//   误计概率低，属可接受的近似。

const json = (v) => JSON.stringify(v);
const parse = (v) => {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

export function store(env) {
  if (typeof my_kv !== "undefined" && my_kv) return my_kv;
  return (env && (env.KV || env.kv || env.my_kv)) || null;
}

const get = (env, key) => store(env).get(key);
const put = (env, key, value) => store(env).put(key, value);
const del = (env, key) => store(env).delete(key);

// ── 通用：前缀分页列举（limit 上限 256，自动翻页）──────
export async function listAll(env, prefix) {
  const out = [];
  let cursor;
  for (;;) {
    const page = await store(env).list({
      prefix,
      limit: 256,
      ...(cursor ? { cursor } : {}),
    });
    const keys = (page && page.keys) || [];
    out.push(...keys.map((k) => k.key));
    if (!page || page.complete) break;
    if (!page.cursor) break;
    cursor = page.cursor;
    if (out.length > 200000) break; // 防死循环
  }
  return out;
}

// 列举某前缀下全部键的值
export async function listValues(env, prefix) {
  const keys = await listAll(env, prefix);
  const out = [];
  for (const key of keys) {
    const v = await get(env, key);
    const rec = parse(v);
    if (rec) out.push(rec);
  }
  return out;
}

// ── 用户 ──────────────────────────────────────────────
export const userGet = (env, wxId) => get(env, `u_${hex(wxId)}`).then(parse);
export const userPut = (env, user) => put(env, `u_${hex(user.wx_id)}`, json(user));
export const userDel = (env, wxId) => del(env, `u_${hex(wxId)}`);

export async function usersList(env) {
  const users = await listValues(env, "u_");
  users.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return users;
}

// ── 消息 ──────────────────────────────────────────────
export const messageGet = (env, wxId, id) => get(env, `m_${hex(wxId)}_${id}`).then(parse);
export const messagePut = (env, msg) => put(env, `m_${hex(msg.wx_id)}_${msg.id}`, json(msg));
export const messageDel = (env, wxId, id) => del(env, `m_${hex(wxId)}_${id}`);

export async function userMessages(env, wxId) {
  const prefix = `m_${hex(wxId)}_`;
  const keys = await listAll(env, prefix);
  const out = [];
  for (const key of keys) {
    const v = await get(env, key);
    const m = parse(v);
    if (m) {
      m.id = key.slice(prefix.length);
      out.push(m);
    }
  }
  return out;
}

export async function allMessages(env) {
  const keys = await listAll(env, "m_");
  const out = [];
  for (const key of keys) {
    const v = await get(env, key);
    const m = parse(v);
    if (m) {
      const rest = key.slice(2);
      const id = rest.slice(-64);
      m.id = id;
      m.wx_id = m.wx_id || "";
      out.push(m);
    }
  }
  return out;
}

// 仅凭消息 id 反查（管理端用，不需要 wxId）
export async function messageGetById(env, id) {
  const suffix = `_${id}`;
  const keys = await listAll(env, "m_");
  for (const key of keys) {
    if (!key.endsWith(suffix)) continue;
    const v = await get(env, key);
    const m = parse(v);
    if (m) {
      m.id = id;
      m.wx_id = m.wx_id || "";
      return m;
    }
  }
  return null;
}

// ── 已读 ──────────────────────────────────────────────
export async function readMark(env, id, ip) {
  const key = `r_${id}_${await sha256Hex(ip)}`;
  const existing = await get(env, key);
  if (existing != null) return false;
  await put(env, key, json({ ip, timestamp: nowTimestamp() }));
  return true;
}

export async function readList(env, id) {
  return listValues(env, `r_${id}_`);
}

export async function deleteReads(env, id) {
  const keys = await listAll(env, `r_${id}_`);
  for (const key of keys) await del(env, key);
}

// 已读人数 = 去重标记键数（KV 单键计数器有丢失更新问题，改由只增标记派生，天然精确）
export async function readCountGet(env, id) {
  const keys = await listAll(env, `r_${id}_`);
  return keys.length;
}

// ── 会话 ──────────────────────────────────────────────
export const sessionGet = (env, tokenHash) => get(env, `s_${tokenHash}`).then(parse);
export const sessionPut = (env, s) => put(env, `s_${s.token_hash}`, json(s));
export const sessionDel = (env, tokenHash) => del(env, `s_${tokenHash}`);

export async function deleteUserSessions(env, wxId, exceptHash) {
  const keys = await listAll(env, "s_");
  for (const key of keys) {
    const s = parse(await get(env, key));
    if (s && s.wx_id === wxId && s.token_hash !== exceptHash) {
      await del(env, key);
    }
  }
}

// ── 审计 ──────────────────────────────────────────────
export async function audit(env, action, detail) {
  try {
    const ts = nowTimestamp();
    await put(env, `a_${tsKey(ts)}_${await randomHex(4)}`, json({ timestamp: ts, action, detail: String(detail).slice(0, 500) }));
  } catch {}
}

// ── 统计（排行榜，只增不减）───────────────────────────
async function statsInc(env, prefix, suffix, base) {
  const key = `${prefix}${suffix}`;
  const cur = parse(await get(env, key));
  const next = cur ? { ...cur, count: (Number(cur.count) || 0) + 1 } : { ...base, count: 1 };
  await put(env, key, json(next));
}

export const regStatsInc = (env, wxId) =>
  statsInc(env, "gs_", `${hex(wxId)}_${chinaDate()}`, { wx_id: wxId });
export const readStatsInc = (env, wxId) =>
  statsInc(env, "rs_", `${hex(wxId)}_${chinaDate()}`, { wx_id: wxId });
export const msgStatsInc = (env, id, wxId, content) =>
  statsInc(env, "ms_", `${id}_${chinaDate()}`, { wx_id: wxId, content: String(content).slice(0, 50) });

// 排行榜：metric=reg|read|msg，scope=day|total，返回前 10
export async function leaderboard(env, metric, scope) {
  const prefix = metric === "reg" ? "gs_" : metric === "read" ? "rs_" : "ms_";
  const date = scope === "day" ? chinaDate() : "";
  const keys = await listAll(env, prefix);
  const groups = new Map();
  for (const key of keys) {
    const rest = key.slice(prefix.length);
    const idx = rest.lastIndexOf("_");
    if (idx < 0) continue;
    const idPart = rest.slice(0, idx);
    const dayPart = rest.slice(idx + 1);
    if (date && dayPart !== date) continue;
    const rec = parse(await get(env, key));
    if (!rec) continue;
    const g = groups.get(idPart) || { count: 0, wx_id: rec.wx_id, content: rec.content };
    g.count += Number(rec.count) || 0;
    groups.set(idPart, g);
  }
  const rows = Array.from(groups, ([idPart, g]) => ({
    ...(metric === "msg" ? { id: idPart, wxId: g.wx_id, content: g.content } : { wxId: g.wx_id }),
    count: g.count,
  }));
  rows.sort((a, b) => b.count - a.count || String(a.wxId || "").localeCompare(String(b.wxId || "")));
  return rows.slice(0, 10);
}

// ── 删除辅助 ──────────────────────────────────────────
// 删除单条消息及其全部已读标记（排行榜统计保留，只增不减，语义与 D1 版一致）
export async function deleteMessageData(env, wxId, id) {
  await messageDel(env, wxId, id);
  await deleteReads(env, id);
}

// 仅删除某用户的全部消息与其已读标记（自我清空用；不碰统计与会话，
// 与 CF 原版 DELETE /messages 行为一致）
export async function deleteUserMessages(env, wxId) {
  const msgs = await userMessages(env, wxId);
  for (const m of msgs) await deleteMessageData(env, wxId, m.id);
}

// 删除某用户的全部排行榜统计（gs_/rs_ 按用户前缀；ms_ 键不含 wxId，
// 需按记录中的 wx_id 过滤；管理员清空数据/拉黑/删用户时调用）
export async function deleteUserStats(env, wxId) {
  const regKeys = await listAll(env, `gs_${hex(wxId)}_`);
  for (const key of regKeys) await del(env, key);
  const readKeys = await listAll(env, `rs_${hex(wxId)}_`);
  for (const key of readKeys) await del(env, key);
  const msgKeys = await listAll(env, "ms_");
  for (const key of msgKeys) {
    const rec = parse(await get(env, key));
    if (rec && rec.wx_id === wxId) await del(env, key);
  }
}

// 清空某用户的全部数据（消息/已读/统计/会话；不删账号本身）
// 仅管理员删除用户时使用（与 CF 原版 DELETE /admin/users/{wxId} 一致）
export async function deleteUserData(env, wxId) {
  await deleteUserMessages(env, wxId);
  await deleteUserStats(env, wxId);
  await deleteUserSessions(env, wxId);
}

// ── 等级配额（惰性清理，语义与 D1 版一致）──────────────
// 等级 N = 保留 N 条消息 × N 个月：超期消息（超过 N 个月）整批删除，
// 与条数无关；再在存活消息中删除最早的超出部分（与原版 SQL 两步删除一致）
export async function enforceQuota(env, wxId, level) {
  const n = Math.max(0, Math.min(Number(level) || 0, LEVEL_MAX));
  const cutoff = new Date(Date.now() - n * 30 * 24 * 3600 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const msgs = await userMessages(env, wxId);
  const alive = [];
  for (const m of msgs) {
    if (m.timestamp < cutoff) {
      try {
        await deleteMessageData(env, wxId, m.id);
      } catch {}
    } else {
      alive.push(m);
    }
  }
  if (alive.length > n) {
    alive.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    for (const m of alive.slice(n)) {
      try {
        await deleteMessageData(env, wxId, m.id);
      } catch {}
    }
  }
}

// ── 手动清理（替代 CF cron）：过期会话 + 超期审计日志 ──
export async function cleanup(env) {
  const now = nowTimestamp();
  const sessionKeys = await listAll(env, "s_");
  for (const key of sessionKeys) {
    const s = parse(await get(env, key));
    if (s && (!s.expires_at || s.expires_at <= now)) await del(env, key);
  }
  const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 86400000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const cutoffTs = tsKey(cutoff);
  const auditKeys = await listAll(env, "a_");
  for (const key of auditKeys) {
    const ts = key.slice(2, 16);
    if (ts < cutoffTs) await del(env, key);
  }
}
