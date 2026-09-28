import { SocketEvents } from "../lib/events";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { money, socket } from "../lib/socket";
import { useApp } from "../store/app";
import { IconGift, IconWallet } from "./icons";

/**
 * Header balance pill.
 *
 * The number always comes from the wallet store, which the API and the balance
 * socket both write to — never from local arithmetic.
 */
export function WalletWidget({ compact }: { compact?: boolean }) {
  const { wallet, demoMode, setWallet } = useApp();

  useEffect(() => {
    const onBalance = (next: typeof wallet) => setWallet(next!);
    socket.on(SocketEvents.BALANCE_UPDATED, onBalance);
    return () => {
      socket.off(SocketEvents.BALANCE_UPDATED, onBalance);
    };
  }, [setWallet]);

  const shown = demoMode ? wallet?.demo : wallet?.real;
  const currency = wallet?.currency ?? "TRY";
  const bonus = Number(wallet?.bonus ?? 0);

  if (compact) {
    return (
      <Link to="/wallet" className="pill pill-info" style={{ fontVariantNumeric: "tabular-nums" }}>
        <IconWallet size={13} /> {money(shown, currency)}
      </Link>
    );
  }

  return (
    <Link
      to="/wallet"
      className="row"
      style={{
        gap: 8,
        padding: "6px 13px",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border)",
      }}
      title={demoMode ? "Demo bakiye" : "Gercek bakiye"}
    >
      <IconWallet size={15} />
      <span className="bold" style={{ fontVariantNumeric: "tabular-nums", fontSize: 14 }}>
        {money(shown, currency)}
      </span>
      {bonus > 0 && !demoMode && (
        <span className="pill pill-success" style={{ fontVariantNumeric: "tabular-nums" }} title="Bonus balance">
          <IconGift size={12} /> {money(wallet?.bonus, currency)}
        </span>
      )}
    </Link>
  );
}

/** Patch the shared wallet store from a REST response. */
export function useWalletSync() {
  const setWallet = useApp((s) => s.setWallet);
  return setWallet;
}
