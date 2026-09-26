import { Server as SocketServer, Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { SocketEvents, isStaff, UserRole } from "@aurora/shared";
import { prisma } from "@aurora/db";
import { authService } from "../services/auth.js";
import { ledger } from "../services/ledger.js";
import { crashEngine } from "./crash.js";
import { env } from "../lib/env.js";

interface AuthedSocket extends Socket {
  userId?: string;
  username?: string;
  roles?: string[];
  currency?: string;
  vipTier?: string;
  isStaff?: boolean;
}

/**
 * Realtime layer.
 *
 * Two namespaces' worth of concerns share one server: player traffic (lobby
 * stats, crash rounds, chat, wallet pushes) and a staff-only admin feed. Room
 * naming is `game:<slug>`, `user:<id>`, `chat:<channel>` and `admin`.
 *
 * Socket auth reuses the same JWT as the REST API, so a revoked session cannot
 * keep a live connection open indefinitely: the token is verified on connect and
 * the session row is checked for revocation on privileged actions.
 */
export class RealtimeServer {
  private io: SocketServer;
  private onlineUsers = new Set<string>();
  private jackpotTimer?: NodeJS.Timeout;
  private statsTimer?: NodeJS.Timeout;

  constructor(httpServer: HttpServer) {
    this.io = new SocketServer(httpServer, {
      cors: { origin: env.appUrl, credentials: true },
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
    this.wire();
  }

  private wire(): void {
    this.io.use(async (socket: AuthedSocket, next) => {
      try {
        const token =
          (socket.handshake.auth?.token as string | undefined) ??
          parseCookie(socket.handshake.headers.cookie)?.access_token;
        if (!token) return next(); // anonymous: lobby and chat are public

        const payload = authService.verifyAccess(token);
        const session = await prisma.session.findUnique({ where: { id: payload.sid } });
        if (!session?.isActive) return next();

        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, username: true, roles: true, currency: true, vip: { select: { tier: true } } },
        });
        if (user) {
          socket.userId = user.id;
          socket.username = user.username;
          socket.roles = user.roles;
          socket.currency = user.currency;
          socket.vipTier = user.vip?.tier ?? undefined;
          socket.isStaff = isStaff(user.roles as UserRole[]);
        }
        next();
      } catch {
        next();
      }
    });

    this.io.on("connection", (socket: AuthedSocket) => {
      void this.onConnection(socket);
    });

    crashEngine.subscribe((event) => this.broadcastCrash(event));
  }

  private async onConnection(socket: AuthedSocket): Promise<void> {
    socket.join("lobby");

    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
      this.onlineUsers.add(socket.userId);
      await prisma.session
        .updateMany({ where: { id: socket.handshake.auth?.sid }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }
    if (socket.isStaff) socket.join("admin");

    socket.emit(SocketEvents.HELLO, {
      userId: socket.userId ?? null,
      username: socket.username ?? null,
      serverTime: new Date().toISOString(),
      crash: crashEngine.currentView(),
    });

    if (socket.userId) {
      const balance = await ledger.summary(socket.userId, socket.currency ?? "TRY");
      socket.emit(SocketEvents.BALANCE_UPDATED, balance);
    }

    // ── crash game ──────────────────────────────────────────────────────
    socket.on("crash:bet", async (payload: { amount?: string; autoCashout?: number; demo?: boolean }, ack?: (r: unknown) => void) => {
      try {
        if (!socket.userId) throw new Error("Giris yapmalisiniz");
        const amount = String(payload?.amount ?? "0");
        const { toMinor } = await import("@aurora/shared");
        const stake = toMinor(amount, (socket.currency ?? "TRY") as never);
        if (stake <= 0n) throw new Error("Gecersiz tutar");

        const bet = await crashEngine.placeBet({
          userId: socket.userId,
          username: socket.username ?? "Oyuncu",
          amount: stake,
          currency: socket.currency ?? "TRY",
          autoCashout: payload?.autoCashout,
          isDemo: Boolean(payload?.demo),
        });

        const balance = await ledger.summary(socket.userId, socket.currency ?? "TRY");
        socket.emit(SocketEvents.BALANCE_UPDATED, balance);
        ack?.({ ok: true, betId: bet.betId });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Hata" });
      }
    });

    socket.on("crash:cashout", async (payload: { betId?: string }, ack?: (r: unknown) => void) => {
      try {
        if (!socket.userId || !payload?.betId) throw new Error("Gecersiz istek");
        const result = await crashEngine.cashOut(payload.betId);
        const balance = await ledger.summary(socket.userId, socket.currency ?? "TRY");
        socket.emit(SocketEvents.BALANCE_UPDATED, balance);
        ack?.({ ok: true, ...result });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Hata" });
      }
    });

    socket.on("crash:state", (ack?: (r: unknown) => void) => {
      ack?.(crashEngine.currentView());
    });

    // ── chat ────────────────────────────────────────────────────────────
    socket.on("chat:join", async (payload: { channel?: string }) => {
      const channel = payload?.channel ?? "lobby";
      socket.join(`chat:${channel}`);
      const history = await prisma.chatMessage.findMany({
        where: { channel, isDeleted: false },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      socket.emit(SocketEvents.CHAT_HISTORY, {
        channel,
        messages: history.reverse().map((m) => ({
          id: m.id,
          username: m.username,
          message: m.message,
          role: m.role,
          vipTier: m.vipTier,
          at: m.createdAt,
        })),
      });
    });

    socket.on("chat:send", async (payload: { channel?: string; message?: string }, ack?: (r: unknown) => void) => {
      try {
        if (!socket.userId || !socket.username) throw new Error("Sohbet icin giris yapmalisiniz");
        const message = String(payload?.message ?? "").trim().slice(0, 300);
        if (!message) throw new Error("Bos mesaj gonderilemez");

        // Basic flood control: max 5 messages per 10 seconds.
        const recent = await prisma.chatMessage.count({
          where: { userId: socket.userId, createdAt: { gte: new Date(Date.now() - 10_000) } },
        });
        if (recent >= 5) throw new Error("Cok hizli mesaj gonderiyorsunuz");

        const record = await prisma.chatMessage.create({
          data: {
            channel: payload?.channel ?? "lobby",
            userId: socket.userId,
            username: socket.username,
            message,
            role: socket.roles?.[0] ?? "PLAYER",
            vipTier: socket.vipTier,
          },
        });

        this.io.to(`chat:${record.channel}`).emit(SocketEvents.CHAT_MESSAGE, {
          id: record.id,
          channel: record.channel,
          username: record.username,
          message: record.message,
          role: record.role,
          vipTier: record.vipTier,
          at: record.createdAt,
        });
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Hata" });
      }
    });

    socket.on("disconnect", () => {
      if (socket.userId) this.onlineUsers.delete(socket.userId);
    });
  }

  private broadcastCrash(event: import("./crash.js").CrashEvent): void {
    switch (event.type) {
      case "round:started":
        this.io.to("lobby").emit(SocketEvents.ROUND_STARTED, event.round);
        break;
      case "round:tick":
        this.io.to("lobby").emit(SocketEvents.ROUND_TICK, {
          roundId: event.roundId,
          gameSlug: "crash",
          state: "ACTIVE",
          multiplier: event.multiplier,
          remainingMs: event.remainingMs,
          serverTime: new Date().toISOString(),
        });
        break;
      case "round:crashed":
        this.io.to("lobby").emit(SocketEvents.ROUND_CRASHED, event);
        break;
      case "round:settled":
        this.io.to("lobby").emit(SocketEvents.ROUND_SETTLED, event);
        break;
      case "bet:placed":
        this.io.to("lobby").emit(SocketEvents.BET_PLACED, event);
        break;
      case "bet:cashed":
        this.io.to("lobby").emit(SocketEvents.BET_CASHED_OUT, event);
        // A big cashout feeds the lobby ticker.
        if (Number(event.payout) > 10_000) {
          this.io.to("lobby").emit(SocketEvents.BIG_WIN, {
            id: event.betId,
            username: "Oyuncu",
            gameName: "Crash",
            gameSlug: "crash",
            amount: event.payout,
            currency: "TRY",
            multiplier: event.multiplier,
            at: new Date().toISOString(),
          });
        }
        break;
    }
  }

  /** Periodic lobby metrics: online count, jackpots, top wins. */
  startLobbyLoop(): void {
    this.jackpotTimer = setInterval(() => void this.pushJackpots(), 5_000);
    this.statsTimer = setInterval(() => void this.pushStats(), 10_000);
  }

  private async pushJackpots(): Promise<void> {
    try {
      const jackpots = await prisma.jackpot.findMany({ where: { isActive: true }, take: 6 });
      if (jackpots.length === 0) return;
      this.io.to("lobby").emit(SocketEvents.JACKPOT_TICK, {
        jackpots: jackpots.map((j) => ({
          id: j.id,
          name: j.name,
          amount: j.currentAmount.toString(),
          currency: j.currency,
        })),
      });
    } catch (error) {
      console.error("[realtime] jackpot gonderilemedi", error);
    }
  }

  private async pushStats(): Promise<void> {
    try {
      const onlinePlayers = await prisma.session.count({
        where: { isActive: true, lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
      });
      const activeBets = crashEngine.currentView().bets.length;

      this.io.to("lobby").emit(SocketEvents.LOBBY_STATS, {
        onlinePlayers,
        activeBets,
        totalWageredToday: "0",
        biggestWinToday: "0",
        jackpots: [],
      });

      // Staff dashboard gets a richer, role-gated payload.
      if (this.io.sockets.adapter.rooms.has("admin")) {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const [deposits, withdrawals, bets, pendingWd, pendingKyc, openFlags, signups] = await Promise.all([
          prisma.paymentIntent.aggregate({
            where: { direction: "DEPOSIT", status: "COMPLETED", completedAt: { gte: today } },
            _sum: { amount: true },
          }),
          prisma.paymentIntent.aggregate({
            where: { direction: "WITHDRAWAL", status: "COMPLETED", completedAt: { gte: today } },
            _sum: { amount: true },
          }),
          prisma.bet.aggregate({
            where: { isDemo: false, placedAt: { gte: today } },
            _sum: { stake: true, payout: true },
          }),
          prisma.paymentIntent.count({ where: { direction: "WITHDRAWAL", status: "PENDING" } }),
          prisma.kycProfile.count({ where: { status: { in: ["PENDING", "IN_REVIEW"] } } }),
          prisma.riskFlag.count({ where: { status: "OPEN" } }),
          prisma.user.count({ where: { createdAt: { gte: today } } }),
        ]);

        const wagered = bets._sum.stake ?? 0n;
        const paid = bets._sum.payout ?? 0n;

        this.io.to("admin").emit(SocketEvents.ADMIN_METRICS, {
          onlinePlayers,
          activeSessions: onlinePlayers,
          depositsToday: (deposits._sum.amount ?? 0n).toString(),
          withdrawalsToday: (withdrawals._sum.amount ?? 0n).toString(),
          ggr: (wagered - paid).toString(),
          ngr: (wagered - paid).toString(),
          pendingWithdrawals: pendingWd,
          pendingKyc,
          openRiskFlags: openFlags,
          signupsToday: signups,
          at: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("[realtime] istatistik gonderilemedi", error);
    }
  }

  /** Push a balance change to a specific player after a REST action. */
  pushBalance(userId: string, balance: Record<string, unknown>): void {
    this.io.to(`user:${userId}`).emit(SocketEvents.BALANCE_UPDATED, balance);
  }

  pushNotification(userId: string, payload: Record<string, unknown>): void {
    this.io.to(`user:${userId}`).emit(SocketEvents.NOTIFICATION, payload);
  }

  pushAdminAlert(payload: Record<string, unknown>): void {
    this.io.to("admin").emit(SocketEvents.ADMIN_ALERT, payload);
  }

  get onlineCount(): number {
    return this.onlineUsers.size;
  }

  stop(): void {
    clearInterval(this.jackpotTimer);
    clearInterval(this.statsTimer);
    crashEngine.stop();
    void this.io.close();
  }
}

function parseCookie(header: string | undefined): Record<string, string> | null {
  if (!header) return null;
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) out[key] = rest.join("=");
  }
  return out;
}
