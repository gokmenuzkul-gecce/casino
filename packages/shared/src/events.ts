/** Realtime event contracts shared by the Socket.IO server and clients. */

export const SocketEvents = {
  // connection
  HELLO: "hello",
  ERROR: "error",
  // wallet
  BALANCE_UPDATED: "wallet:balance",
  TX_CREATED: "wallet:tx",
  // lobby
  LOBBY_STATS: "lobby:stats",
  JACKPOT_TICK: "lobby:jackpot",
  BIG_WIN: "lobby:bigwin",
  // game rounds
  ROUND_STARTED: "round:started",
  ROUND_JOINED: "round:joined",
  ROUND_STATE: "round:state",
  ROUND_TICK: "round:tick",
  ROUND_CRASHED: "round:crashed",
  ROUND_SETTLED: "round:settled",
  BET_PLACED: "round:bet",
  BET_CASHED_OUT: "round:cashout",
  // chat
  CHAT_MESSAGE: "chat:message",
  CHAT_HISTORY: "chat:history",
  // notifications
  NOTIFICATION: "notification",
  // tournaments
  TOURNAMENT_UPDATE: "tournament:update",
  LEADERBOARD_UPDATE: "leaderboard:update",
  // admin
  ADMIN_METRICS: "admin:metrics",
  ADMIN_ALERT: "admin:alert",
  ADMIN_FEED: "admin:feed",
} as const;

export interface BalanceUpdate {
  currency: string;
  real: string;
  bonus: string;
  locked: string;
  demo: string;
  reason?: string;
}

export interface LobbyStats {
  onlinePlayers: number;
  activeBets: number;
  totalWageredToday: string;
  biggestWinToday: string;
  jackpots: { id: string; name: string; amount: string; currency: string }[];
}

export interface BigWinFeedItem {
  id: string;
  username: string;
  gameName: string;
  gameSlug: string;
  amount: string;
  currency: string;
  multiplier: string;
  at: string;
}

export interface RoundTickPayload {
  roundId: string;
  gameSlug: string;
  state: string;
  /** For crash-style games: current multiplier. */
  multiplier?: string;
  /** Seconds remaining for betting/open phases. */
  remainingMs?: number;
  serverTime: string;
}

export interface CrashPointPayload {
  roundId: string;
  crashPoint: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export interface ChatMessagePayload {
  id: string;
  channel: string;
  userId: string | null;
  username: string;
  message: string;
  role: string;
  vipTier: string | null;
  at: string;
}

export interface AdminMetrics {
  onlinePlayers: number;
  activeSessions: number;
  depositsToday: string;
  withdrawalsToday: string;
  ggr: string;
  ngr: string;
  pendingWithdrawals: number;
  pendingKyc: number;
  openRiskFlags: number;
  signupsToday: number;
  at: string;
}
