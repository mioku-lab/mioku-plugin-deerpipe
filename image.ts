import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ScreenshotService } from "mioku";
import { escapeHtml, getAvatarUrl, isNightMode } from "./utils";

interface CalendarOptions {
  year: number;
  month: number;
  todayDay: number;
  records: Map<number, number>;
  name: string;
  userId: number;
}

interface RankRow {
  rank: number;
  name: string;
  userId: number;
  count: number;
}

interface DeerTheme {
  pageBg: string;
  textColor: string;
  titleAccent: string;
  countColor: string;
  emptyColor: string;
  dayHalo: string;
  rankCountColor: string;
  avatarBorder: string;
}

const DAY_THEME: DeerTheme = {
  pageBg: "#ffffff",
  textColor: "#000000",
  titleAccent: "#d50000",
  countColor: "#d50000",
  emptyColor: "#888888",
  dayHalo: "#ffffff",
  rankCountColor: "#d50000",
  avatarBorder: "#cccccc",
};

const NIGHT_THEME: DeerTheme = {
  pageBg: "#1d2030",
  textColor: "#f1ecdb",
  titleAccent: "#ff6b6b",
  countColor: "#ff8a65",
  emptyColor: "#9a9a9a",
  dayHalo: "#2a2f44",
  rankCountColor: "#ff8a65",
  avatarBorder: "#5a5f73",
};

function getTheme(): DeerTheme {
  return isNightMode() ? NIGHT_THEME : DAY_THEME;
}

interface AssetUris {
  defaultAvatar: string;
  check: string;
  deerpipe: string;
}

let assetsCache: AssetUris | null = null;

const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

async function loadAssets(): Promise<AssetUris> {
  if (assetsCache) return assetsCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const assetsDir = path.join(here, "assets");

  async function readOptional(name: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(path.join(assetsDir, name));
    } catch {
      return null;
    }
  }

  const [avatar, check, deerpipe] = await Promise.all([
    readOptional("akkarin@80x80.png"),
    readOptional("check@96x100.png"),
    readOptional("deerpipe@100x82.png"),
  ]);
  if (!check || !deerpipe) {
    throw new Error(
      "deerpipe 必需素材缺失:check@96x100.png / deerpipe@100x82.png",
    );
  }
  assetsCache = {
    defaultAvatar: avatar
      ? `data:image/png;base64,${avatar.toString("base64")}`
      : TRANSPARENT_PNG,
    check: `data:image/png;base64,${check.toString("base64")}`,
    deerpipe: `data:image/png;base64,${deerpipe.toString("base64")}`,
  };
  return assetsCache;
}

// Mon–Sun weeks, matching Python's calendar.monthcalendar(year, month)
function buildMonthGrid(year: number, month: number): number[][] {
  const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  // Convert to Monday-first index: Mon=0..Sun=6
  const leadingEmpty = (firstDow + 6) % 7;
  const weeks: number[][] = [];
  let cur: number[] = new Array(leadingEmpty).fill(0);
  for (let d = 1; d <= daysInMonth; d++) {
    cur.push(d);
    if (cur.length === 7) {
      weeks.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) {
    while (cur.length < 7) cur.push(0);
    weeks.push(cur);
  }
  return weeks;
}

export async function generateCalendarImage(
  screenshotService: ScreenshotService,
  options: CalendarOptions,
): Promise<string> {
  const { year, month, records, name, userId } = options;
  const assets = await loadAssets();
  // 日历始终使用白天主题（按用户要求 🦌 / 🦌历 / 补🦌 不适配夜间模式）
  const theme = DAY_THEME;
  const weeks = buildMonthGrid(year, month);

  const cellSize = 100;
  const headerHeight = 100;
  const imgW = 700;
  const imgH = headerHeight + cellSize * weeks.length;

  const cellsHtml = weeks
    .map((week, weekIdx) =>
      week
        .map((day, dayIdx) => {
          if (day === 0) return "";
          const x = dayIdx * cellSize;
          const y = headerHeight + weekIdx * cellSize;
          const count = records.get(day) ?? 0;
          const checked = count > 0;
          const countText =
            count > 1 ? (count > 999 ? "x999+" : `x${count}`) : "";
          return `
            <img class="stamp" src="${assets.deerpipe}" style="left:${x}px;top:${y}px" />
            <div class="day-num" style="left:${x + 8}px;top:${y + 50}px">${day}</div>
            ${
              checked
                ? `<img class="check" src="${assets.check}" style="left:${x}px;top:${y}px" />`
                : ""
            }
            ${
              countText
                ? `<div class="count" style="left:${x + cellSize - 5}px;top:${y + cellSize - 25}px">${countText}</div>`
                : ""
            }
          `;
        })
        .join(""),
    )
    .join("");

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8" />
    <style>
      ${BASE_CSS}
      .canvas {
        position: relative;
        width: ${imgW}px;
        height: ${imgH}px;
        background: ${theme.pageBg};
        color: ${theme.textColor};
        overflow: hidden;
      }
      .avatar {
        position: absolute;
        left: 10px;
        top: 10px;
        width: 80px;
        height: 80px;
        object-fit: cover;
        border-radius: 50%;
        border: 2px solid ${theme.avatarBorder};
        box-sizing: border-box;
      }
      .title {
        position: absolute;
        left: 100px;
        top: 10px;
        font-size: 25px;
        line-height: 30px;
        color: ${theme.textColor};
      }
      .subtitle {
        position: absolute;
        left: 100px;
        top: 45px;
        font-size: 25px;
        line-height: 30px;
        color: ${theme.textColor};
      }
      .stamp { position: absolute; width: 100px; height: 82px; }
      .check { position: absolute; width: 96px; height: 100px; }
      .day-num {
        position: absolute;
        font-size: 36px;
        line-height: 36px;
        font-weight: 700;
        color: ${theme.textColor};
        text-shadow:
          1px 0 0 ${theme.dayHalo},
          -1px 0 0 ${theme.dayHalo},
          0 1px 0 ${theme.dayHalo},
          0 -1px 0 ${theme.dayHalo},
          1px 1px 0 ${theme.dayHalo},
          -1px -1px 0 ${theme.dayHalo},
          1px -1px 0 ${theme.dayHalo},
          -1px 1px 0 ${theme.dayHalo};
      }
      .count {
        position: absolute;
        transform: translateX(-100%);
        font-size: 20px;
        line-height: 20px;
        color: ${theme.countColor};
        font-weight: 700;
        -webkit-text-stroke: 1px ${theme.countColor};
      }
    </style>
  </head>
  <body>
    <div class="canvas">
      <img class="avatar" src="${escapeHtml(getAvatarUrl(userId))}" onerror="this.onerror=null;this.src='${assets.defaultAvatar}'" />
      <div class="title">${year}-${String(month).padStart(2, "0")} 🦌签到日历</div>
      <div class="subtitle">@${escapeHtml(name)}</div>
      ${cellsHtml}
    </div>
  </body></html>`;

  return screenshotService.screenshot(html, {
    width: imgW,
    height: imgH,
    fullPage: false,
    type: "png",
  });
}

export async function generateRankImage(
  screenshotService: ScreenshotService,
  rows: RankRow[],
  _year: number,
  _month: number,
): Promise<string> {
  const assets = await loadAssets();
  const theme = getTheme();
  const imgW = 400;
  const headerHeight = 100;
  const rowHeight = 100;
  // Original: IMG_H = (len(rank) + 1) * 100 — empty rank still gets header + 1 row.
  const visibleRows = rows.length || 1;
  const imgH = headerHeight + rowHeight * visibleRows;

  const rowsHtml = rows
    .map((row, idx) => {
      const y = headerHeight + idx * rowHeight;
      return `
        <img class="rank-avatar" src="${escapeHtml(getAvatarUrl(row.userId))}" onerror="this.onerror=null;this.src='${assets.defaultAvatar}'" style="top:${y + 10}px" />
        <div class="rank-name" style="top:${y + 10}px">@${escapeHtml(row.name)}</div>
        <div class="rank-count" style="top:${y + 50}px">x${row.count}</div>
      `;
    })
    .join("");

  const emptyHtml =
    rows.length === 0
      ? `<div class="rank-empty" style="top:${headerHeight + 30}px">本月还没人🦌过呢</div>`
      : "";

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8" />
    <style>
      ${BASE_CSS}
      .canvas {
        position: relative;
        width: ${imgW}px;
        height: ${imgH}px;
        background: ${theme.pageBg};
        color: ${theme.textColor};
        overflow: hidden;
      }
      .rank-title {
        position: absolute;
        left: 0;
        top: 25px;
        width: 100%;
        text-align: center;
        font-size: 50px;
        line-height: 50px;
        color: ${theme.titleAccent};
        font-weight: 700;
        -webkit-text-stroke: 1px ${theme.titleAccent};
      }
      .rank-avatar {
        position: absolute;
        left: 10px;
        width: 80px;
        height: 80px;
        object-fit: cover;
        border-radius: 50%;
        border: 2px solid ${theme.avatarBorder};
        box-sizing: border-box;
      }
      .rank-name {
        position: absolute;
        left: 100px;
        font-size: 25px;
        line-height: 25px;
        color: ${theme.textColor};
      }
      .rank-count {
        position: absolute;
        left: 100px;
        font-size: 25px;
        line-height: 25px;
        color: ${theme.rankCountColor};
      }
      .rank-empty {
        position: absolute;
        left: 0;
        width: 100%;
        text-align: center;
        font-size: 22px;
        color: ${theme.emptyColor};
      }
    </style>
  </head>
  <body>
    <div class="canvas">
      <div class="rank-title">本月Top5🦌榜</div>
      ${rowsHtml}
      ${emptyHtml}
    </div>
  </body></html>`;

  return screenshotService.screenshot(html, {
    width: imgW,
    height: imgH,
    fullPage: false,
    type: "png",
  });
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "MiSans", "PingFang SC", "Microsoft YaHei",
      "Noto Sans CJK SC", "Hiragino Sans GB", "Apple Color Emoji",
      "Noto Color Emoji", sans-serif;
  }
`;
