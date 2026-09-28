import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconChevronLeft, IconChevronRight, IconClose } from "./icons";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center" style={{ padding: 30 }}>
      <div className="spinner" />
      {label && <div className="muted small">{label}</div>}
    </div>
  );
}

export function Empty({ icon = "🎲", title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="bold">{title}</div>
      {hint && <div className="small mt">{hint}</div>}
    </div>
  );
}

export function Alert({ kind = "info", children }: { kind?: "error" | "success" | "info" | "warning"; children: ReactNode }) {
  return <div className={`alert alert-${kind}`}>{children}</div>;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Prevent the page behind the modal from scrolling.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal${wide ? " modal-wide" : ""}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="row-between">
          <div>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  delta,
  deltaUp,
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  deltaUp?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {delta && <div className={`stat-delta ${deltaUp ? "stat-up" : "stat-down"}`}>{delta}</div>}
    </div>
  );
}

export function Pill({ children, kind = "neutral" }: { children: ReactNode; kind?: string }) {
  return <span className={`pill pill-${kind}`}>{children}</span>;
}

/** Map a status string from the API onto a pill style. */
export function statusKind(status: string): string {
  const s = status.toUpperCase();
  if (["ACTIVE", "COMPLETED", "APPROVED", "WON", "SENT", "PAID", "RESOLVED"].includes(s)) return "success";
  if (["PENDING", "PENDING_VERIFICATION", "IN_REVIEW", "PROCESSING", "QUEUED", "OPEN", "SCHEDULED"].includes(s)) return "warning";
  if (["FAILED", "REJECTED", "BANNED", "SUSPENDED", "CANCELLED", "LOST", "CRITICAL"].includes(s)) return "danger";
  if (["CASHED_OUT", "INFO"].includes(s)) return "info";
  return "neutral";
}

export function useCountdown(target: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, target - now);
}

export function Toast({ message, kind, onDone }: { message: string; kind: "success" | "error"; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 4000);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <div className="toast-stack">
      <div className={`toast toast-${kind}`} role="status">
        <span className="toast-icon">{kind === "success" ? "✓" : "!"}</span>
        <span>{message}</span>
      </div>
    </div>
  );
}

/** Shimmering placeholder used while a shelf loads. */
export function SkeletonTile() {
  return (
    <div className="carousel-item">
      <div className="skeleton skeleton-tile" />
      <div className="skeleton skeleton-line" style={{ marginTop: 10 }} />
    </div>
  );
}

export function SkeletonShelf({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-row" style={{ marginTop: 14 }}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonTile key={i} />
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-games">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton skeleton-tile" />
          <div className="skeleton skeleton-line" style={{ marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Horizontal shelf with scroll buttons.
 *
 * Native horizontal scrolling does the work on touch; the arrow buttons are a
 * desktop affordance and disable themselves at either end.
 */
export function Carousel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [sync]);

  const scrollBy = (direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 200), behavior: "smooth" });
  };

  return (
    <div className="carousel">
      <div className="carousel-nav" style={{ position: "absolute", right: 0, top: -46, zIndex: 3 }}>
        <button className="carousel-btn" onClick={() => scrollBy(-1)} disabled={atStart} aria-label="Sola kaydir">
          <IconChevronLeft size={16} />
        </button>
        <button className="carousel-btn" onClick={() => scrollBy(1)} disabled={atEnd} aria-label="Saga kaydir">
          <IconChevronRight size={16} />
        </button>
      </div>
      <div className="carousel-track" ref={ref}>
        {children}
      </div>
    </div>
  );
}
