import { PBKDF2_ITERATIONS, SECURITY_HEADERS } from "./config.js";

// ── 基础工具 ────────────────────────────────────────────

export const enc = new TextEncoder();
export const dec = new TextDecoder();

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
  });
}

export function jsonWithCookie(data, cookie, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookie,
      ...SECURITY_HEADERS,
    },
  });
}

// 只信任 EdgeOne 注入的真实客户端 IP；不接受客户端可控的 X-Forwarded-For
export function getClientIP(request) {
  const ip = request && request.eo && request.eo.clientIp;
  return typeof ip === "string" && ip ? ip : "unknown";
}

export function nowTimestamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// KV 键只能包含数字、字母、下划线：把任意字符串（如 wxId）编码为十六进制
export function hex(s) {
  const bytes = enc.encode(String(s));
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(h) {
  const s = String(h || "");
  const bytes = new Uint8Array(Math.floor(s.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return dec.decode(bytes);
}

// 时间戳 "YYYY-MM-DD HH:MM:SS" → 纯数字串（可字典序比较，用于 KV 键）
export function tsKey(t) {
  return String(t || "").replace(/[^0-9]/g, "");
}

export async function sha256Hex(input) {
  const data = enc.encode(String(input));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hexStr) {
  const out = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function randomHex(bytes) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

// PBKDF2-SHA256 密码哈希：pbkdf2$<iterations>$<salt_hex>$<hash_hex>
export async function pbkdf2Hash(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations, hash: "SHA-256" },
    key,
    256
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password) {
  const saltHex = await randomHex(16);
  const hash = await pbkdf2Hash(password, saltHex, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${hash}`;
}

// 常量时间比较：先做 SHA-256 摘要再比较，避免逐字符比较的时序侧信道
export async function safeEquals(input, expected) {
  const a = await sha256Hex(String(input));
  const b = await sha256Hex(String(expected));
  return a === b;
}

export async function passwordMatches(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < 1000) return false;
  const a = await pbkdf2Hash(password, parts[2], iterations);
  const b = await sha256Hex(parts[3]);
  return (await sha256Hex(a)) === b;
}

export async function computeId(wxId, content, createTime) {
  const raw = wxId + "\0" + content + "\0" + String(createTime);
  return sha256Hex(raw);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 基于 Cache API 的固定窗口限流（近似计数：缓存仅在本边缘节点有效，
// 并发请求存在微小 TOCTOU 偏差，对登录限流仅弱化不失效，可接受）。
// failClosed=true：故障时拒绝；false：放行。
let _rlCache = null;
export async function rateLimit(key, limit, windowSec, failClosed = false) {
  try {
    if (!_rlCache) {
      _rlCache =
        typeof caches.open === "function"
          ? await caches.open("read-receipts-rate-limit")
          : caches.default;
    }
    const url = `https://internal.ratelimit.local/${encodeURIComponent(key)}`;
    let count = 0;
    try {
      // 缓存过期时 match 会抛 504，视为无计数
      const cached = await _rlCache.match(url);
      if (cached) {
        const data = await cached.json();
        count = Number(data.count) || 0;
      }
    } catch {}
    if (count >= limit) return false;
    await _rlCache.put(
      url,
      new Response(JSON.stringify({ count: count + 1 }), {
        headers: { "Cache-Control": `max-age=${windowSec}` },
      })
    );
    return true;
  } catch {
    return !failClosed;
  }
}

// 中国时区（UTC+8）当日日期 YYYY-MM-DD（日榜按中国自然日划分）
export function chinaDate() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 中国时区（UTC+8）当日 0 点对应的 UTC 时间戳，格式与 timestamp 列一致（YYYY-MM-DD HH:MM:SS），可直接比较
export function chinaDayStartTimestamp() {
  const nowCn = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const ms =
    Date.UTC(nowCn.getUTCFullYear(), nowCn.getUTCMonth(), nowCn.getUTCDate()) -
    8 * 3600 * 1000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
    d.getUTCHours()
  )}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// 用户名脱敏：wxid 开头保留 "wxid_" + 前 1 位 + 后 3 位，中间用星号掩盖（仅服务端调用，避免完整 wxid 暴露到前端）
export function maskWxId(wxId) {
  const s = String(wxId || "");
  if (!/^wxid_/i.test(s)) return s;
  return s.slice(0, 7) + "***" + s.slice(-3);
}

// 消息内容脱敏：≥5 字时只保留前后各 2 字，中间用星号掩盖；不足 5 字全文显示
export function maskContent(s) {
  const str = String(s || "");
  if (str.length < 5) return str;
  return str.slice(0, 2) + "***" + str.slice(-2);
}

// /pixel 参数容错解析：收件端微信可能原样保留 CDATA 中的 &amp; 或将其转义，
// 逐级兜底，保证只要 URL 带完整 id 就能识别
export function pixelParams(url) {
  const raw = url.search.replace(/&amp;/g, "&");
  const p = new URLSearchParams(raw);
  // URLSearchParams 会解码 %26 等转义，可能把后续参数并进值里，截断处理
  let wxId = (p.get("wxId") || "").split("&")[0];
  let id = p.get("id") || "";
  if (!/^[0-9a-fA-F]{64}$/.test(id)) id = "";
  if (!wxId || !id) {
    let decoded = "";
    try {
      decoded = decodeURIComponent(raw).replace(/&amp;/g, "&");
    } catch {}
    if (!wxId) {
      const m = /(?:^|[?&])wxId=([^&"<\s]+)/.exec(decoded);
      if (m) wxId = m[1];
    }
    if (!id) {
      const m = /(?:^|[?&])id=([0-9a-fA-F]{64})(?:&|$)/.exec(decoded);
      if (m) id = m[1];
    }
  }
  return { wxId, id };
}
