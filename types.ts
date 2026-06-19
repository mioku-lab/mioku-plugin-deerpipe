export interface DeerUser {
  scene: string;
  userId: number;
  canBeHelped: boolean;
  noDeerUntil: number | null;
}

export interface DeerCheckInResult {
  ok: boolean;
  records: Map<number, number>;
}

export interface DeerRankEntry {
  userId: number;
  count: number;
}

export interface DeerScene {
  key: string;
  isGroup: boolean;
  groupId?: number;
  privateUserId?: number;
}
