import type { ScreenshotService } from "mioku";
import { definePlugin, type MiokiContext } from "mioki";
import { initDeerDatabase, type DeerDatabase } from "./db";
import { handleDeerCommand, parseDeerCommand } from "./commands";

const deerpipePlugin = definePlugin({
  name: "deerpipe",
  version: "1.0.0",
  description: "🦌管签到插件，支持自🦌、帮🦌、补🦌、🦌历、🦌榜",

  async setup(ctx: MiokiContext) {
    ctx.logger.info("deerpipe 插件正在初始化...");

    const screenshotService = ctx.services?.screenshot as
      | ScreenshotService
      | undefined;

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

    // 启动时清掉非本月的旧数据，与原版 cleanup 行为一致
    try {
      const now = new Date();
      await db.cleanupOtherMonths(now.getFullYear(), now.getMonth() + 1);
    } catch (error) {
      ctx.logger.warn(`deerpipe 启动期数据清理失败: ${error}`);
    }

    // 每周一 4:00 清理跨月数据
    ctx.cron("0 4 * * 1", async () => {
      try {
        const now = new Date();
        await db.cleanupOtherMonths(now.getFullYear(), now.getMonth() + 1);
        ctx.logger.info("deerpipe 跨月数据已清理");
      } catch (error) {
        ctx.logger.error(`deerpipe 定时清理失败: ${error}`);
      }
    });

    ctx.handle("message", async (event: any) => {
      const text = ctx.text(event);
      if (!text) return;

      const cmd = parseDeerCommand(text, event.message ?? []);
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
    });

    ctx.logger.info("deerpipe 插件初始化完成");

    return () => {
      ctx.logger.info("deerpipe 插件已卸载");
    };
  },
});

export default deerpipePlugin;
