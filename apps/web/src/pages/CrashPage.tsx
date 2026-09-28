import { SocketEvents } from "../lib/events";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { socket } from "../lib/socket";
import { money, post } from "../lib/api";
import { useApp } from "../store/app";
import { Alert, Pill } from "../components/ui";

interface BetView {
  betId: string;
  userId: string;
  username: string;
  amount: string;
  cashedOutAt: string | null;
  payout: string | null;
}

interface RoundView {
  roundId: string;
  roundNumber: number;
  status: "OPEN" | "ACTIVE" | "SETTLED";
  multiplier: string;
  serverSeedHash: string;
  remainingMs: number;
  bets: BetView[];
  history: { roundNumber: number; crashPoint: string }[];
}

const QUICK_STAKES = ["5", "10", "25", "50", "100", "250"];

/**
 * Live crash table.
 *
 * The multiplier is driven by server ticks, never by a local timer, so two
 * players always see the same number. The curve is redrawn from the tick stream
 * into an SVG path; each tick appends one more point.
 */
export function CrashPage() {
  const { user, wallet, demoMode, setWallet } = useApp();
  const [round, setRound] = useState<RoundView | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [status, setStatus] = useState<"OPEN" | "ACTIVE" | "SETTLED">("OPEN");
  const [remainingMs, setRemainingMs] = useState(0);
  const [amount, setAmount] = useState("10");
  const [autoCashout, setAutoCashout] = useState("");
  const [myBet, setMyBet] = useState<{ betId: string; amount: string } | null>(null);
  const [cashes, setCashes] = useState<{ id: string; username: string; multiplier: string; payout: string }[]>([]);
  const [history, setHistory] = useState<{ roundNumber: number; crashPoint: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bets, setBets] = useState<BetView[]>([]);

  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  const [path, setPath] = useState("");

  useEffect(() => {
    const onHello = (payload: { crash: RoundView }) => {
      setRound(payload.crash);
      setStatus(payload.crash.status);
      setHistory(payload.crash.history ?? []);
      setBets(payload.crash.bets ?? []);
    };

    const onStarted = (payload: RoundView) => {
      setRound(payload);
      setStatus("OPEN");
      setMultiplier(1);
      setMyBet(null);
      setCashes([]);
      pointsRef.current = [];
      setPath("");
      setBets([]);
    };

    const onTick = (payload: { multiplier: string; remainingMs: number }) => {
      setRemainingMs(payload.remainingMs);
      const next = Number(payload.multiplier);
      setMultiplier(next);
      if (payload.multiplier !== "1.0000" && payload.remainingMs === 0) {
        setStatus("ACTIVE");
        pointsRef.current.push({ x: Date.now(), y: next });
        setPath(buildPath(pointsRef.current));
      } else {
        setStatus("OPEN");
      }
    };

    const onCrashed = (payload: { crashPoint: string; serverSeed: string }) => {
      setStatus("SETTLED");
      setMultiplier(Number(payload.crashPoint));
      setNotice(`Tur patladi: x${payload.crashPoint} — tohum: ${payload.serverSeed.slice(0, 24)}...`);
    };

    const onSettled = (payload: { roundNumber: number; crashPoint: string }) => {
      setHistory((prev) => [...prev.slice(-19), { roundNumber: payload.roundNumber, crashPoint: payload.crashPoint }]);
    };

    const onBetPlaced = (payload: { bet: BetView }) => setBets((prev) => [...prev, payload.bet]);

    const onCashed = (payload: { betId: string; userId: string; multiplier: string; payout: string }) => {
      setCashes((prev) => [{ id: payload.betId, username: "Player", multiplier: payload.multiplier, payout: payload.payout }, ...prev.slice(0, 24)]);
      setBets((prev) => prev.map((b) => (b.betId === payload.betId ? { ...b, cashedOutAt: payload.multiplier, payout: payload.payout } : b)));
    };

    const onBalance = (next: typeof wallet) => setWallet(next!);
    const onNotification = (payload: { title?: string; body?: string }) => {
      if (payload.title) setNotice(`${payload.title} — ${payload.body ?? ""}`);
    };

    socket.on(SocketEvents.HELLO, onHello);
    socket.on(SocketEvents.ROUND_STARTED, onStarted);
    socket.on(SocketEvents.ROUND_TICK, onTick);
    socket.on(SocketEvents.ROUND_CRASHED, onCrashed);
    socket.on(SocketEvents.ROUND_SETTLED, onSettled);
    socket.on(SocketEvents.BET_PLACED, onBetPlaced);
    socket.on(SocketEvents.BET_CASHED_OUT, onCashed);
    socket.on(SocketEvents.BALANCE_UPDATED, onBalance);
    socket.on(SocketEvents.NOTIFICATION, onNotification);

    socket.emit("crash:state", (state: RoundView) => {
      setRound(state);
      setStatus(state.status);
      setHistory(state.history ?? []);
      setBets(state.bets ?? []);
    });

    return () => {
      socket.off(SocketEvents.HELLO, onHello);
      socket.off(SocketEvents.ROUND_STARTED, onStarted);
      socket.off(SocketEvents.ROUND_TICK, onTick);
      socket.off(SocketEvents.ROUND_CRASHED, onCrashed);
      socket.off(SocketEvents.ROUND_SETTLED, onSettled);
      socket.off(SocketEvents.BET_PLACED, onBetPlaced);
      socket.off(SocketEvents.BET_CASHED_OUT, onCashed);
      socket.off(SocketEvents.BALANCE_UPDATED, onBalance);
      socket.off(SocketEvents.NOTIFICATION, onNotification);
    };
  }, [setWallet]);

  // Smooth the multiplier between server ticks so the display does not stutter.
  const [smooth, setSmooth] = useState(1);
  useEffect(() => {
    if (status !== "ACTIVE") {
      setSmooth(multiplier);
      return;
    }
    const timer = setInterval(() => setSmooth((prev) => Math.max(prev, multiplier)), 50);
    return () => clearInterval(timer);
  }, [status, multiplier]);

  const placeBet = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!user) return setError("You must log in to place a bet");

    socket.emit(
      "crash:bet",
      {
        amount,
        autoCashout: autoCashout ? Number(autoCashout) : undefined,
        demo: demoMode,
      },
      (ack: { ok: boolean; betId?: string; error?: string }) => {
        if (!ack.ok) return setError(ack.error ?? "Could not place the bet");
        setMyBet({ betId: ack.betId!, amount });
        setNotice(`Bahis yerlestirildi: ${money(amount)}`);
      },
    );
  };

  const cashOut = () => {
    if (!myBet) return;
    socket.emit("crash:cashout", { betId: myBet.betId }, (ack: { ok: boolean; multiplier?: string; payout?: string; error?: string }) => {
      if (!ack.ok) return setError(ack.error ?? "Could not cash out");
      setNotice(`Nakde cekildi: x${ack.multiplier} → ${money(ack.payout ?? "0")}`);
      setMyBet(null);
    });
  };

  const statusLabel = status === "OPEN" ? "Bets are open" : status === "ACTIVE" ? "Flight in progress" : "Tur Bitti";
  const statusClass = status === "OPEN" ? "waiting" : status === "ACTIVE" ? "flying" : "crashed";

  const balanceShown = demoMode ? wallet?.demo : wallet?.real;

  return (
    <div className="page">
      <div className="row-between mb">
        <div>
          <h1 className="section-title" style={{ margin: 0 }}>Crash</h1>
          <div className="small muted">Provably fair — tohum ozeti tur basinda yayinlanir</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {demoMode && <Pill kind="warning">DEMO MODU</Pill>}
          <Link to="/fairness" className="btn btn-ghost btn-sm">🔐 Verification</Link>
        </div>
      </div>

      {(error || notice) && (
        <Alert kind={error ? "error" : "info"}>{error ?? notice}</Alert>
      )}

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(300px, 1fr)", alignItems: "start" }}>
        <div className="col" style={{ gap: 16 }}>
          <div className="crash-stage">
            <svg className="crash-curve" viewBox="0 0 400 340" preserveAspectRatio="none">
              <defs>
                <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={status === "SETTLED" ? "#f43f5e" : "#10b981"} stopOpacity="0.5" />
                  <stop offset="100%" stopColor={status === "SETTLED" ? "#f43f5e" : "#10b981"} stopOpacity="0" />
                </linearGradient>
              </defs>
              {path && <path d={`${path} L400,340 L0,340 Z`} fill="url(#curveFill)" stroke="none" />}
              {path && <path d={path} fill="none" stroke={status === "SETTLED" ? "#f43f5e" : "#10b981"} strokeWidth="2.5" />}
            </svg>

            <div className={`crash-multiplier ${statusClass}`} style={{ fontVariantNumeric: "tabular-nums" }}>
              x{(status === "ACTIVE" ? smooth : multiplier).toFixed(2)}
            </div>
            <div className="crash-status muted">{statusLabel}</div>
            {status === "OPEN" && (
              <div className="small mt faint">Sonraki tur {(remainingMs / 1000).toFixed(1)} sn icinde</div>
            )}
            {round?.serverSeedHash && (
              <div className="tiny faint mono mt" style={{ maxWidth: "90%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                tohum ozeti: {round.serverSeedHash}
              </div>
            )}

            <div className="crash-history">
              {history.slice(-14).reverse().map((entry) => (
                <span
                  key={entry.roundNumber}
                  className="crash-history-chip"
                  style={{
                    background: Number(entry.crashPoint) >= 2 ? "rgba(16,185,129,0.2)" : "rgba(244,63,94,0.18)",
                    color: Number(entry.crashPoint) >= 2 ? "var(--success)" : "var(--danger)",
                  }}
                >
                  x{entry.crashPoint}
                </span>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Live Bets <span className="faint small">{bets.length} oyuncu</span></div>
            {bets.length === 0 ? (
              <div className="muted small center" style={{ padding: 16 }}>Bu turda henuz bahis yok</div>
            ) : (
              <div className="crash-bet-list">
                {bets.map((bet) => (
                  <div className="crash-bet-row" key={bet.betId}>
                    <span className="muted truncate" style={{ flex: 1 }}>{bet.username}</span>
                    <span className="mono">{money(bet.amount)}</span>
                    {bet.cashedOutAt ? (
                      <span className="bold" style={{ color: "var(--success)" }}>x{bet.cashedOutAt} → {money(bet.payout)}</span>
                    ) : (
                      <span className="faint tiny">ucta</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* bet panel */}
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="row-between mb">
              <span className="small muted">Balance</span>
              <span className="bold" style={{ fontVariantNumeric: "tabular-nums" }}>{money(balanceShown, wallet?.currency ?? "TRY")}</span>
            </div>

            {myBet ? (
              <button className="btn btn-success btn-lg btn-block" onClick={cashOut} disabled={status !== "ACTIVE"}>
                {status === "ACTIVE" ? `NAKDE CEK x${smooth.toFixed(2)}` : "Tur baslamasini bekleyin"}
              </button>
            ) : (
              <form onSubmit={placeBet}>
                <div className="field">
                  <label>Bet amount</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    step="1"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    disabled={status !== "OPEN"}
                  />
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {QUICK_STAKES.map((stake) => (
                    <button
                      key={stake}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setAmount(stake)}
                      disabled={status !== "OPEN"}
                    >
                      {stake}
                    </button>
                  ))}
                </div>

                <div className="field">
                  <label>Otomatik nakde cek (opsiyonel)</label>
                  <input
                    className="input"
                    type="number"
                    min="1.01"
                    step="0.01"
                    placeholder="or. 2.00"
                    value={autoCashout}
                    onChange={(event) => setAutoCashout(event.target.value)}
                    disabled={status !== "OPEN"}
                  />
                </div>

                <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={status !== "OPEN" || !user}>
                  {status === "OPEN" ? "Place Bet" : "Sonraki turu bekleyin"}
                </button>
                {!user && <Link to="/" className="btn btn-ghost btn-sm btn-block mt">Login</Link>}
              </form>
            )}

            <div className="divider" />
            <div className="tiny faint">
              {demoMode
                ? "Demo modunda oynuyorsunuz. Gercek para icin ustteki DEMO dugmesine basin."
                : "You are playing with real balance. Bets are deducted from your wallet instantly."}
            </div>
          </div>

          <div className="card card-tight">
            <div className="card-title" style={{ marginBottom: 8 }}>💥 Latest Cashouts</div>
            {cashes.length === 0 ? (
              <div className="muted small center" style={{ padding: 12 }}>None yet</div>
            ) : (
              <div className="col" style={{ gap: 5 }}>
                {cashes.slice(0, 10).map((entry) => (
                  <div className="row-between small" key={entry.id}>
                    <span className="faint">Player</span>
                    <span className="bold" style={{ color: "var(--success)" }}>x{entry.multiplier}</span>
                    <span className="mono">{money(entry.payout)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Map accumulated (time, multiplier) points onto the SVG viewbox. */
function buildPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  const width = 400;
  const height = 340;
  const t0 = points[0]!.x;
  const t1 = points[points.length - 1]!.x;
  const maxY = Math.max(2, ...points.map((p) => p.y));

  return points
    .map((point, index) => {
      const px = ((point.x - t0) / Math.max(1, t1 - t0)) * width;
      const py = height - (point.y / maxY) * height;
      return `${index === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
}
