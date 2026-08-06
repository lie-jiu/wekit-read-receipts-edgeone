import { json } from "../_lib/util.js";

// GET /auth/status：登录页元信息（是否要求邀请码）
export function onRequestGet(context) {
  const env = context.env || {};
  return json({
    auth_required: true,
    invite_required: !!env.INVITE_CODE,
  });
}
