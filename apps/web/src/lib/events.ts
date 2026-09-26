/**
 * Realtime event names.
 *
 * Mirrors the server contract in `@aurora/shared`, duplicated here because the
 * shared package also carries the server-side provably-fair crypto helpers and
 * must not be bundled into the browser build.
 */
export const SocketEvents = {
  HELLO: "hello",
  ERROR: "error",
  BALANCE_UPDATED: "wallet:balance",
  TX_CREATED: "wallet:tx",
  LOBBY_STATS: "lobby:stats",
  JACKPOT_TICK: "lobby:jackpot",
  BIG_WIN: "lobby:bigwin",
  ROUND_STARTED: "round:started",
  ROUND_JOINED: "round:joined",
  ROUND_STATE: "round:state",
  ROUND_TICK: "round:tick",
  ROUND_CRASHED: "round:crashed",
  ROUND_SETTLED: "round:settled",
  BET_PLACED: "round:bet",
  BET_CASHED_OUT: "round:cashout",
  CHAT_MESSAGE: "chat:message",
  CHAT_HISTORY: "chat:history",
  NOTIFICATION: "notification",
  TOURNAMENT_UPDATE: "tournament:update",
  LEADERBOARD_UPDATE: "leaderboard:update",
  ADMIN_METRICS: "admin:metrics",
  ADMIN_ALERT: "admin:alert",
  ADMIN_FEED: "admin:feed",
} as const;
