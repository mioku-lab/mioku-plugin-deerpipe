import type { MiokiContext } from "mioki";
import * as fs from "fs/promises";
import type { DeerScene } from "./types";

export function getAvatarUrl(userId: number): string {
  return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`;
}

export function getAtUserId(message: any[]): number | undefined {
  if (!Array.isArray(message)) return undefined;
  for (const seg of message) {
    if (seg?.type !== "at") continue;
    const raw = seg?.qq ?? seg?.data?.qq;
    if (raw === "all" || raw == null) continue;
    const qq = Number(raw);
    if (Number.isFinite(qq)) return qq;
  }
  return undefined;
}

export function resolveScene(event: any): DeerScene {
  if (event?.message_type === "group" && event?.group_id != null) {
    return {
      key: `g:${event.group_id}`,
      isGroup: true,
      groupId: Number(event.group_id),
    };
  }
  return {
    key: `p:${event.user_id}`,
    isGroup: false,
    privateUserId: Number(event.user_id),
  };
}

export async function resolveUserName(
  ctx: MiokiContext,
  event: any,
  userId: number,
): Promise<string> {
  const selfId = Number(event?.self_id);
  if (event?.message_type === "group" && event?.group_id != null) {
    try {
      const member = await ctx
        .pickBot(selfId)
        .getGroupMemberInfo(Number(event.group_id), userId);
      const name =
        String(member?.card || "").trim() ||
        String(member?.nickname || "").trim();
      if (name) return name;
    } catch {
      // fall through
    }
  }
  if (Number(event?.user_id) === userId && event?.sender) {
    const name =
      String(event.sender?.card || "").trim() ||
      String(event.sender?.nickname || "").trim();
    if (name) return name;
  }
  try {
    const stranger = (await ctx
      .pickBot(selfId)
      .api("get_stranger_info", { user_id: userId })) as
      | { nickname?: string }
      | undefined;
    const name = String(stranger?.nickname || "").trim();
    if (name) return name;
  } catch {
    // ignore
  }
  return String(userId);
}

const DURATION_RE = /(\d+)\s*([smhdwy秒分时天周年]|min|hour|day|week|year)/gi;

export function parseDuration(text: string): number | null {
  const t = String(text || "").trim();
  if (!t) return null;
  let total = 0;
  let matched = false;
  for (const m of t.matchAll(DURATION_RE)) {
    matched = true;
    const value = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (unit === "s" || unit === "秒") total += value;
    else if (unit === "m" || unit === "min" || unit === "分") total += value * 60;
    else if (unit === "h" || unit === "hour" || unit === "时") total += value * 3600;
    else if (unit === "d" || unit === "day" || unit === "天") total += value * 86400;
    else if (unit === "w" || unit === "week" || unit === "周") total += value * 604800;
    else if (unit === "y" || unit === "year" || unit === "年") total += value * 31536000;
  }
  if (!matched) {
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    return null;
  }
  return total;
}

export function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 19:00–07:00 视为夜间模式，与 help 插件保持一致
export function isNightMode(): boolean {
  const hour = new Date().getHours();
  return hour >= 19 || hour < 7;
}

export async function replyImage(
  event: any,
  segment: { image: (file: string) => any } | undefined,
  imagePath: string,
  text?: any[],
): Promise<void> {
  const imageSeg = segment?.image
    ? segment.image(imagePath)
    : { type: "image", file: imagePath };
  const payload = text ? [...text, imageSeg] : [imageSeg];
  try {
    await event.reply(payload, true);
  } catch {
    const buf = await fs.readFile(imagePath);
    const base64 = `base64://${buf.toString("base64")}`;
    const fallbackSeg = segment?.image
      ? segment.image(base64)
      : { type: "image", file: base64 };
    const fallback = text ? [...text, fallbackSeg] : [fallbackSeg];
    await event.reply(fallback, true);
  }
}
