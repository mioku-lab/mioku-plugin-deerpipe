import { createDB } from "mioki";
import { ensureDataDir } from "mioku";
import * as path from "path";
import type {
  DeerCheckInResult,
  DeerRankEntry,
  DeerUser,
} from "./types";

interface UserRecord {
  canBeHelped: boolean;
  noDeerUntil: number | null;
}

/**
 * users:   key = "<scene>:<userId>"
 * records: scene -> "yyyy-mm" -> userId -> day -> count
 */
interface DeerStore {
  users: Record<string, UserRecord>;
  records: Record<
    string,
    Record<string, Record<string, Record<string, number>>>
  >;
}

const DEFAULT_STORE: DeerStore = {
  users: {},
  records: {},
};

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
}

function userKey(scene: string, userId: number): string {
  return `${scene}:${userId}`;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function initDeerDatabase(): Promise<DeerDatabase> {
  const dir = ensureDataDir("deerpipe");
  const file = path.join(dir, "deerpipe.json");
  const db = await createDB<DeerStore>(file, {
    defaultData: structuredClone(DEFAULT_STORE),
  });

  // Defensive: createDB merges with defaultData but keys may have been
  // dropped from a hand-edited file.
  if (!db.data.users) db.data.users = {};
  if (!db.data.records) db.data.records = {};

  function readUserRecord(scene: string, userId: number): UserRecord {
    const key = userKey(scene, userId);
    let row = db.data.users[key];
    if (!row) {
      row = { canBeHelped: true, noDeerUntil: null };
      db.data.users[key] = row;
    }
    return row;
  }

  function readMonthRecords(
    scene: string,
    userId: number,
    year: number,
    month: number,
  ): Record<string, number> {
    const sceneRecords = db.data.records[scene];
    if (!sceneRecords) return {};
    const monthRecords = sceneRecords[monthKey(year, month)];
    if (!monthRecords) return {};
    return monthRecords[String(userId)] ?? {};
  }

  function loadRecords(
    scene: string,
    userId: number,
    year: number,
    month: number,
  ): Map<number, number> {
    const raw = readMonthRecords(scene, userId, year, month);
    const map = new Map<number, number>();
    for (const [k, v] of Object.entries(raw)) {
      map.set(Number(k), Number(v));
    }
    return map;
  }

  return {
    getOrCreateUser(scene, userId) {
      const row = readUserRecord(scene, userId);
      return {
        scene,
        userId,
        canBeHelped: row.canBeHelped,
        noDeerUntil: row.noDeerUntil,
      };
    },

    async updateUser(user) {
      const row = readUserRecord(user.scene, user.userId);
      row.canBeHelped = user.canBeHelped;
      row.noDeerUntil = user.noDeerUntil;
      await db.write();
    },

    getRecords(scene, userId, year, month) {
      return loadRecords(scene, userId, year, month);
    },

    async checkIn(scene, userId, year, month, day, isPast) {
      readUserRecord(scene, userId);
      const sceneRecords = (db.data.records[scene] ??= {});
      const monthRecords = (sceneRecords[monthKey(year, month)] ??= {});
      const userRecords = (monthRecords[String(userId)] ??= {});

      const dayKey = String(day);
      if (userRecords[dayKey] != null) {
        if (isPast) {
          return {
            ok: false,
            records: loadRecords(scene, userId, year, month),
          };
        }
        userRecords[dayKey] = Number(userRecords[dayKey]) + 1;
      } else {
        userRecords[dayKey] = 1;
      }

      await db.write();
      return {
        ok: true,
        records: loadRecords(scene, userId, year, month),
      };
    },

    getRank(scene, year, month, limit) {
      const monthRecords = db.data.records[scene]?.[monthKey(year, month)];
      if (!monthRecords) return [];
      const totals: DeerRankEntry[] = [];
      for (const [uid, days] of Object.entries(monthRecords)) {
        let total = 0;
        for (const v of Object.values(days)) total += Number(v);
        if (total > 0) {
          totals.push({ userId: Number(uid), count: total });
        }
      }
      totals.sort((a, b) => b.count - a.count);
      return totals.slice(0, limit);
    },

    async cleanupOtherMonths(year, month) {
      const keepKey = monthKey(year, month);
      let dirty = false;
      for (const [scene, sceneRecords] of Object.entries(db.data.records)) {
        for (const k of Object.keys(sceneRecords)) {
          if (k !== keepKey) {
            delete sceneRecords[k];
            dirty = true;
          }
        }
        if (Object.keys(sceneRecords).length === 0) {
          delete db.data.records[scene];
          dirty = true;
        }
      }
      if (dirty) await db.write();
    },
  };
}
