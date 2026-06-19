import type { ScreenshotService } from "mioku";
import type { MiokiContext } from "mioki";
import type { DeerDatabase } from "./db";
import { generateCalendarImage, generateRankImage } from "./image";
import {
  formatDateTime,
  getAtUserId,
  parseDuration,
  replyImage,
  resolveScene,
  resolveUserName,
} from "./utils";

const MAX_NO_DEER_DURATION_S = 30 * 86400;

interface CommandContext {
  ctx: MiokiContext;
  db: DeerDatabase;
  screenshot: ScreenshotService;
  event: any;
}

function normalize(text: string): string {
  return text.replace(/鹿/g, "🦌").trim();
}

function isGroupAdmin(event: any): boolean {
  const role = event?.sender?.role;
  return role === "admin" || role === "owner";
}

export type DeerCommand =
  | { type: "deer"; targetUserId?: number }
  | { type: "past"; day: number }
  | { type: "calendar"; targetUserId?: number }
  | { type: "rank" }
  | { type: "set_can_be_helped"; allowed: boolean; targetUserId?: number }
  | { type: "set_no_deer"; targetUserId: number; durationText?: string }
  | { type: "invalid_past" }
  | { type: "none" };

/**
 * Parse a message into a deer command.
 * Returns "none" if the message doesn't look like a deer command at all.
 */
export function parseDeerCommand(
  text: string,
  message: any[],
): DeerCommand {
  const normalized = normalize(text);
  if (!normalized) return { type: "none" };
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const head = tokens[0];
  if (!head) return { type: "none" };

  if (head === "🦌") {
    return { type: "deer", targetUserId: getAtUserId(message) };
  }

  if (head === "补🦌") {
    const arg = tokens[1];
    if (!arg) return { type: "invalid_past" };
    const day = Number(arg);
    if (!Number.isInteger(day)) return { type: "invalid_past" };
    return { type: "past", day };
  }

  if (head === "🦌历") {
    return { type: "calendar", targetUserId: getAtUserId(message) };
  }

  if (head === "🦌榜") {
    return { type: "rank" };
  }

  if (head === "帮🦌") {
    const flag = (tokens[1] || "").toLowerCase();
    if (flag !== "on" && flag !== "off") return { type: "none" };
    return {
      type: "set_can_be_helped",
      allowed: flag === "on",
      targetUserId: getAtUserId(message),
    };
  }

  if (head === "禁🦌") {
    const targetUserId = getAtUserId(message);
    if (!targetUserId) return { type: "none" };
    const durationText = tokens.slice(1).join("").trim();
    return {
      type: "set_no_deer",
      targetUserId,
      durationText: durationText || undefined,
    };
  }

  return { type: "none" };
}

export async function handleDeerCommand(
  cmd: DeerCommand,
  cmdCtx: CommandContext,
): Promise<void> {
  switch (cmd.type) {
    case "deer":
      return handleDeer(cmdCtx, cmd.targetUserId);
    case "past":
      return handlePast(cmdCtx, cmd.day);
    case "calendar":
      return handleCalendar(cmdCtx, cmd.targetUserId);
    case "rank":
      return handleRank(cmdCtx);
    case "set_can_be_helped":
      return handleSetCanBeHelped(cmdCtx, cmd.allowed, cmd.targetUserId);
    case "set_no_deer":
      return handleSetNoDeer(cmdCtx, cmd.targetUserId, cmd.durationText);
    case "invalid_past":
      await cmdCtx.event.reply("不是合法的补🦌日期捏", true);
      return;
    case "none":
      return;
  }
}

async function handleDeer(
  cmdCtx: CommandContext,
  targetUserId?: number,
): Promise<void> {
  const { ctx, db, screenshot, event } = cmdCtx;
  const scene = resolveScene(event);
  const now = new Date();

  // 帮🦌 only makes sense in groups
  if (targetUserId && !scene.isGroup) {
    return;
  }

  const userId =
    targetUserId != null ? targetUserId : Number(event.user_id);
  const user = db.getOrCreateUser(scene.key, userId);

  if (targetUserId && !user.canBeHelped) {
    await event.reply("该用户不准别人帮🦌捏", true);
    return;
  }

  if (
    scene.isGroup &&
    user.noDeerUntil != null &&
    user.noDeerUntil > now.getTime()
  ) {
    await event.reply(
      `该用户已被禁🦌至 ${formatDateTime(user.noDeerUntil)}`,
      true,
    );
    return;
  }

  const result = await db.checkIn(
    scene.key,
    userId,
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
    false,
  );

  const name = await resolveUserName(ctx, event, userId);
  const imagePath = await generateCalendarImage(screenshot, {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    todayDay: now.getDate(),
    records: result.records,
    name,
    userId,
  });

  const prefix = targetUserId
    ? [{ type: "text", data: { text: "成功帮 " } }, ctx.segment.at(targetUserId), { type: "text", data: { text: " 🦌了\n" } }]
    : [{ type: "text", data: { text: "成功🦌了\n" } }];

  await replyImage(event, ctx.segment, imagePath, prefix);
}

async function handlePast(
  cmdCtx: CommandContext,
  day: number,
): Promise<void> {
  const { ctx, db, screenshot, event } = cmdCtx;
  const scene = resolveScene(event);
  const now = new Date();

  if (day < 1 || day >= now.getDate()) {
    await event.reply("不是合法的补🦌日期捏", true);
    return;
  }

  const userId = Number(event.user_id);
  db.getOrCreateUser(scene.key, userId);

  const result = await db.checkIn(
    scene.key,
    userId,
    now.getFullYear(),
    now.getMonth() + 1,
    day,
    true,
  );

  const name = await resolveUserName(ctx, event, userId);
  const imagePath = await generateCalendarImage(screenshot, {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    todayDay: now.getDate(),
    records: result.records,
    name,
    userId,
  });

  const text = result.ok ? "成功补🦌\n" : "不能补🦌已经🦌过的日子捏\n";
  await replyImage(
    event,
    ctx.segment,
    imagePath,
    [{ type: "text", data: { text } }],
  );
}

async function handleCalendar(
  cmdCtx: CommandContext,
  targetUserId?: number,
): Promise<void> {
  const { ctx, db, screenshot, event } = cmdCtx;
  const scene = resolveScene(event);
  if (targetUserId && !scene.isGroup) return;

  const now = new Date();
  const userId = targetUserId ?? Number(event.user_id);
  db.getOrCreateUser(scene.key, userId);
  const records = db.getRecords(
    scene.key,
    userId,
    now.getFullYear(),
    now.getMonth() + 1,
  );

  const name = await resolveUserName(ctx, event, userId);
  const imagePath = await generateCalendarImage(screenshot, {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    todayDay: now.getDate(),
    records,
    name,
    userId,
  });

  await replyImage(event, ctx.segment, imagePath);
}

async function handleRank(cmdCtx: CommandContext): Promise<void> {
  const { ctx, db, screenshot, event } = cmdCtx;
  const scene = resolveScene(event);
  if (!scene.isGroup) return;

  const now = new Date();
  const top = db.getRank(
    scene.key,
    now.getFullYear(),
    now.getMonth() + 1,
    5,
  );

  const rows = await Promise.all(
    top.map(async (entry, idx) => ({
      rank: idx + 1,
      userId: entry.userId,
      name: await resolveUserName(ctx, event, entry.userId),
      count: entry.count,
    })),
  );

  const imagePath = await generateRankImage(
    screenshot,
    rows,
    now.getFullYear(),
    now.getMonth() + 1,
  );

  await replyImage(event, ctx.segment, imagePath);
}

async function handleSetCanBeHelped(
  cmdCtx: CommandContext,
  allowed: boolean,
  targetUserId?: number,
): Promise<void> {
  const { ctx, db, event } = cmdCtx;
  const scene = resolveScene(event);
  if (!scene.isGroup) return;

  if (targetUserId && !isGroupAdmin(event)) {
    await event.reply("权限不足", true);
    return;
  }

  const userId = targetUserId ?? Number(event.user_id);
  const user = db.getOrCreateUser(scene.key, userId);
  user.canBeHelped = allowed;
  await db.updateUser(user);

  if (targetUserId) {
    await event.reply(
      [
        { type: "text", data: { text: `已${allowed ? "允许" : "禁止"}帮 ` } },
        ctx.segment.at(targetUserId),
        { type: "text", data: { text: " 🦌" } },
      ],
      true,
    );
  } else {
    await event.reply(`已${allowed ? "允许" : "禁止"}别人帮🦌`, true);
  }
}

async function handleSetNoDeer(
  cmdCtx: CommandContext,
  targetUserId: number,
  durationText?: string,
): Promise<void> {
  const { ctx, db, event } = cmdCtx;
  const scene = resolveScene(event);
  if (!scene.isGroup) return;

  if (!isGroupAdmin(event)) {
    await event.reply("权限不足", true);
    return;
  }

  let durationS: number | null = null;
  if (durationText) {
    durationS = parseDuration(durationText);
    if (durationS == null) {
      await event.reply("时间段表达式解析错误", true);
      return;
    }
    if (durationS > MAX_NO_DEER_DURATION_S) {
      await event.reply(
        `时间段过长：最大允许时间为 ${MAX_NO_DEER_DURATION_S / 86400} 天`,
        true,
      );
      return;
    }
  }

  const user = db.getOrCreateUser(scene.key, targetUserId);
  user.noDeerUntil =
    durationS == null ? null : Date.now() + durationS * 1000;
  await db.updateUser(user);

  if (user.noDeerUntil == null) {
    await event.reply(
      [
        { type: "text", data: { text: "已解禁 " } },
        ctx.segment.at(targetUserId),
        { type: "text", data: { text: " 的🦌权" } },
      ],
      true,
    );
  } else {
    await event.reply(
      [
        { type: "text", data: { text: "已禁止 " } },
        ctx.segment.at(targetUserId),
        {
          type: "text",
          data: {
            text: ` 的🦌权至 ${formatDateTime(user.noDeerUntil)}`,
          },
        },
      ],
      true,
    );
  }
}
