export interface DeerUser {
  scene: string;
  userId: string;
  canBeHelped: boolean;
  noDeerUntil: number | null;
}

export interface DeerCheckInResult {
  ok: boolean;
  records: Map<number, number>;
}

export interface DeerRankEntry {
  userId: string;
  count: number;
}

export interface DeerScene {
  key: string;
  isGroup: boolean;
  groupId?: string;
  privateUserId?: string;
}
