import { Database } from "bun:sqlite";
import * as path from "path";
import { ensureDataDir } from "mioku";
import type {
  DeerCheckInResult,
  DeerRankEntry,
  DeerUser,
} from "./types";

interface UserRow {
  can_be_helped: number;
  no_deer_until: number | null;
}

interface RecordRow {
  day: number;
  count: number;
}

export interface DeerDatabase {
  getOrCreateUser(scene: string, userId: number): DeerUser;
  updateUser(user: DeerUser): Promise<void>;
  getRecords(
    scene: string,
    userId: number,
    year: number,
    month: number,
  ): Map<number, number>;
  checkIn(
    scene: string,
    userId: number,
    year: number,
    month: number,
    day: number,
    isPast: boolean,
  ): Promise<DeerCheckInResult>;
  getRank(
    scene: string,
    year: number,
    month: number,
    limit: number,
  ): DeerRankEntry[];
  cleanupOtherMonths(year: number, month: number): Promise<void>;
  close(): void;
}

function userKey(scene: string, userId: number): string {
  return `${scene}:${userId}`;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function initDeerDatabase(): Promise<DeerDatabase> {
  const dir = ensureDataDir("deerpipe");
  const dbPath = path.join(dir, "deerpipe.db");
  const db = new Database(dbPath);

  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      key TEXT PRIMARY KEY,
      can_be_helped INTEGER NOT NULL DEFAULT 1,
      no_deer_until INTEGER
    );

    CREATE TABLE IF NOT EXISTS records (
      scene TEXT NOT NULL,
      month_key TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      day INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (scene, month_key, user_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_records_scene_month
      ON records(scene, month_key);
  `);

  const stmts = {
    getUser: db.prepare(
      `SELECT can_be_helped, no_deer_until FROM users WHERE key = $key`,
    ),
    insertUser: db.prepare(`
      INSERT INTO users (key, can_be_helped, no_deer_until)
      VALUES ($key, 1, NULL)
      ON CONFLICT(key) DO NOTHING
    `),
    updateUser: db.prepare(`
      INSERT INTO users (key, can_be_helped, no_deer_until)
      VALUES ($key, $canBeHelped, $noDeerUntil)
      ON CONFLICT(key) DO UPDATE SET
        can_be_helped = $canBeHelped,
        no_deer_until = $noDeerUntil
    `),
    getMonthRecords: db.prepare(`
      SELECT day, count FROM records
      WHERE scene = $scene AND month_key = $monthKey AND user_id = $userId
      ORDER BY day ASC
    `),
    getDayRecord: db.prepare(`
      SELECT count FROM records
      WHERE scene = $scene AND month_key = $monthKey AND user_id = $userId AND day = $day
    `),
    insertRecord: db.prepare(`
      INSERT INTO records (scene, month_key, user_id, day, count)
      VALUES ($scene, $monthKey, $userId, $day, 1)
    `),
    incrementRecord: db.prepare(`
      UPDATE records SET count = count + 1
      WHERE scene = $scene AND month_key = $monthKey AND user_id = $userId AND day = $day
    `),
    getMonthRank: db.prepare(`
      SELECT user_id, SUM(count) AS total FROM records
      WHERE scene = $scene AND month_key = $monthKey
      GROUP BY user_id
      ORDER BY total DESC
      LIMIT $limit
    `),
    deleteOtherMonths: db.prepare(
      `DELETE FROM records WHERE month_key != $keepKey`,
    ),
  };

  function loadRecords(
    scene: string,
    userId: number,
    year: number,
    month: number,
  ): Map<number, number> {
    const rows = stmts.getMonthRecords.all({
      $scene: scene,
      $monthKey: monthKey(year, month),
      $userId: userId,
    }) as RecordRow[];
    const map = new Map<number, number>();
    for (const row of rows) {
      map.set(row.day, row.count);
    }
    return map;
  }

  return {
    getOrCreateUser(scene, userId) {
      const key = userKey(scene, userId);
      let row = stmts.getUser.get({ $key: key }) as UserRow | null;
      if (!row) {
        stmts.insertUser.run({ $key: key });
        row = { can_be_helped: 1, no_deer_until: null };
      }
      return {
        scene,
        userId,
        canBeHelped: Boolean(row.can_be_helped),
        noDeerUntil: row.no_deer_until,
      };
    },

    async updateUser(user) {
      stmts.updateUser.run({
        $key: userKey(user.scene, user.userId),
        $canBeHelped: user.canBeHelped ? 1 : 0,
        $noDeerUntil: user.noDeerUntil,
      });
    },

    getRecords(scene, userId, year, month) {
      return loadRecords(scene, userId, year, month);
    },

    async checkIn(scene, userId, year, month, day, isPast) {
      stmts.insertUser.run({ $key: userKey(scene, userId) });

      const mKey = monthKey(year, month);
      const existing = stmts.getDayRecord.get({
        $scene: scene,
        $monthKey: mKey,
        $userId: userId,
        $day: day,
      }) as { count: number } | null;

      if (existing && isPast) {
        return {
          ok: false,
          records: loadRecords(scene, userId, year, month),
        };
      }

      if (existing) {
        stmts.incrementRecord.run({
          $scene: scene,
          $monthKey: mKey,
          $userId: userId,
          $day: day,
        });
      } else {
        stmts.insertRecord.run({
          $scene: scene,
          $monthKey: mKey,
          $userId: userId,
          $day: day,
        });
      }

      return {
        ok: true,
        records: loadRecords(scene, userId, year, month),
      };
    },

    getRank(scene, year, month, limit) {
      const rows = stmts.getMonthRank.all({
        $scene: scene,
        $monthKey: monthKey(year, month),
        $limit: limit,
      }) as Array<{ user_id: number; total: number }>;
      return rows.map((row) => ({
        userId: row.user_id,
        count: row.total,
      }));
    },

    async cleanupOtherMonths(year, month) {
      stmts.deleteOtherMonths.run({ $keepKey: monthKey(year, month) });
    },

    close() {
      db.close();
    },
  };
}
