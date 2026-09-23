import {
  definePlugin,
  type CommandDefinition,
  type MessageEvent,
  type MiokuContext,
} from "mioku";
import { getService, Services } from "mioku";
import { initDeerDatabase, type DeerDatabase } from "./db";
import { handleDeerCommand, parseDeerCommand } from "./commands";

const deerpipePlugin = definePlugin({
  name: "deerpipe",

  async setup(ctx: MiokuContext) {
    ctx.logger.info("deerpipe 插件正在初始化...");

    const screenshotService = getService(ctx, Services.Screenshot);

    if (!screenshotService) {
      ctx.logger.warn("screenshot 服务未加载，deerpipe 插件无法生成图片");
      return () => {
        ctx.logger.info("deerpipe 插件已卸载");
      };
    }

    let db: DeerDatabase;
    try {
      db = await initDeerDatabase();
    } catch (error) {
      ctx.logger.error(`deerpipe 数据库初始化失败: ${error}`);
      return () => {
        ctx.logger.info("deerpipe 插件已卸载");
      };
    }

    try {
      const now = new Date();
      await db.cleanupOtherMonths(now.getFullYear(), now.getMonth() + 1);
    } catch (error) {
      ctx.logger.warn(`deerpipe 启动期数据清理失败: ${error}`);
    }

    ctx.cron("0 4 * * 1", async () => {
      try {
        const now = new Date();
        await db.cleanupOtherMonths(now.getFullYear(), now.getMonth() + 1);
        ctx.logger.info("deerpipe 跨月数据已清理");
      } catch (error) {
        ctx.logger.error(`deerpipe 定时清理失败: ${error}`);
      }
    });

    const run = async (event: MessageEvent, text: string) => {
      const cmd = parseDeerCommand(text, Array.from(event.message ?? []));
      if (cmd.type === "none") return;
      try {
        await handleDeerCommand(cmd, {
          ctx,
          db,
          screenshot: screenshotService,
          event,
        });
      } catch (error) {
        ctx.logger.error(`deerpipe 命令执行失败: ${error}`);
        try {
          await event.reply(`🦌管插件出错了: ${error}`, true);
        } catch {
          // 忽略二次失败
        }
      }
    };

    const cmd = (command: CommandDefinition) =>
      ctx.command({ ...command, prefixes: false });

    cmd({
      name: "🦌",
      match: /^(?:🦌|鹿)(?:\s|$|@)/,
      description: "签到一次（可加 @某人 帮其签到）",
      usage: ".🦌 / .🦌 @张三",
      handler: ({ event, body }) => run(event, body),
    });
    cmd({
      name: "补🦌",
      match: /^补(?:🦌|鹿)(?:\s|\d|$)/,
      description: "补签本月之前未签到的某天",
      usage: ".补🦌 5",
      handler: ({ event, body }) => run(event, body),
    });
    cmd({
      name: "🦌历",
      match: /^(?:🦌|鹿)历(?:\s|$|@)/,
      description: "查看本月🦌签到日历（可加 @某人）",
      usage: ".🦌历 / .🦌历 @张三",
      handler: ({ event, body }) => run(event, body),
    });
    cmd({
      name: "🦌榜",
      match: /^(?:🦌|鹿)榜(?:\s|$)/,
      description: "查看本月本群🦌签到排行榜（仅群组）",
      usage: ".🦌榜",
      handler: ({ event, body }) => run(event, body),
    });
    cmd({
      name: "帮🦌",
      match: /^帮(?:🦌|鹿)(?:\s|$|@)/,
      description: "允许/禁止被别人帮🦌；@某人需管理员",
      usage: ".帮🦌 off",
      handler: ({ event, body }) => run(event, body),
    });
    cmd({
      name: "禁🦌",
      match: /^禁(?:🦌|鹿)(?:\s|@|$)/,
      description: "禁止某人在一段时间内🦌，省略时长视为解禁（仅管理员）",
      usage: ".禁🦌 @张三 1d",
      handler: ({ event, body }) => run(event, body),
    });

    ctx.logger.info("deerpipe 插件初始化完成");

    return () => {
      ctx.logger.info("deerpipe 插件已卸载");
    };
  },
});

export default deerpipePlugin;
