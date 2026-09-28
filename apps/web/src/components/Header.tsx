import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { isStaffUser, useApp } from "../store/app";

import { AuthModal } from "./AuthModal";
import { WalletWidget } from "./WalletWidget";
import {
  IconBell,
  IconClose,
  IconCoins,
  IconDoc,
  IconGift,
  IconGrid,
  IconHome,
  IconLive,
  IconLock,
  IconMenu,
  IconSearch,
  IconShield,
  IconTrophy,
  IconUser,
  IconWallet,
} from "./icons";

/** Brand mark — same "A" geometry as the favicon, drawn inline so it themes. */
export function LogoMark({ size = 21 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="logoAu" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb4954" />
          <stop offset="0.55" stopColor="#e71d3a" />
          <stop offset="1" stopColor="#a20c25" />
        </linearGradient>
      </defs>
      <path d="M32 10 L50 50 L40 50 L32 31 L24 50 L14 50 Z" fill="url(#logoAu)" />
      <circle cx="32" cy="44" r="4" fill="#0b0d14" />
      <circle cx="32" cy="44" r="8" fill="none" stroke="url(#logoAu)" strokeWidth="2" strokeOpacity="0.55" />
    </svg>
  );
}

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="logo">
      <span className="logo-mark">
        <LogoMark />
      </span>
      Aurora
    </Link>
  );
}

const PRIMARY_NAV = [
  { to: "/games", label: "Casino", icon: IconGrid },
  { to: "/live", label: "Live Casino", icon: IconLive },
  { to: "/crash", label: "Instant", icon: IconCoins },
  { to: "/promotions", label: "Promotions", icon: IconGift },
];

const DRAWER_EXTRA = [
  { to: "/", label: "Home", icon: IconHome, end: true },
  { to: "/tournaments", label: "Tournaments", icon: IconTrophy },
  { to: "/vip", label: "VIP", icon: IconShield },
  { to: "/leaderboard", label: "Leaderboard", icon: IconTrophy },
  { to: "/fairness", label: "Provably Fair", icon: IconLock },
  { to: "/history", label: "History", icon: IconDoc },
];

const BOTTOM_NAV = [
  { to: "/", label: "Home", icon: IconHome, end: true },
  { to: "/games", label: "Casino", icon: IconGrid },
  { to: "/live", label: "Live", icon: IconLive },
  { to: "/wallet", label: "Wallet", icon: IconWallet },
  { to: "/account", label: "Account", icon: IconUser },
];

export function Header() {
  const { user, logout, demoMode, setDemoMode, unreadCount } = useApp();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  const staff = isStaffUser(user);

  // Close transient panels whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
  }, [navigate]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const openAuth = (mode: "login" | "register") => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const term = search.trim();
    navigate(term ? `/games?search=${encodeURIComponent(term)}` : "/games");
    setSearch("");
  };

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <button className="btn btn-ghost btn-sm menu-toggle" onClick={() => setDrawerOpen(true)} aria-label="Menu">
            <IconMenu size={18} />
          </button>

          <Logo />

          <nav className="nav" aria-label="Main menu">
            {PRIMARY_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={"end" in item ? Boolean(item.end) : undefined}
                className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <form onSubmit={submitSearch} className="header-search">
            <span className="header-search-icon">
              <IconSearch size={16} />
            </span>
            <input
              className="header-search-input"
              placeholder="Search games..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search games"
            />
          </form>

          <div className="header-actions">
            {user ? (
              <>
                <button
                  className={`btn btn-sm ${demoMode ? "btn-gold" : "btn-ghost"}`}
                  onClick={() => setDemoMode(!demoMode)}
                  title="Demo ve gercek bakiye arasinda gecis"
                >
                  {demoMode ? "DEMO" : "REAL"}
                </button>

                <WalletWidget />

                <Link to="/account" className="header-icon-btn" aria-label="Notifications">
                  <IconBell size={18} />
                  {unreadCount > 0 && <span className="header-icon-dot">{unreadCount > 9 ? "9+" : unreadCount}</span>}
                </Link>

                <div style={{ position: "relative" }}>
                  <button className="header-icon-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Account menu" aria-expanded={menuOpen}>
                    <IconUser size={18} />
                  </button>
                  {menuOpen && (
                    <>
                      <div style={{ position: "fixed", inset: 0, zIndex: 190 }} onClick={() => setMenuOpen(false)} />
                      <div
                        className="card"
                        style={{ position: "absolute", right: 0, top: "calc(100% + 10px)", minWidth: 226, zIndex: 200, padding: 8 }}
                      >
                        <div className="small faint" style={{ padding: "4px 10px 8px" }}>
                          {user.username}
                        </div>
                        <div className="divider" style={{ margin: "0 0 6px" }} />
                        {[
                          { to: "/account", label: "Account", icon: IconUser },
                          { to: "/wallet", label: "Wallet", icon: IconWallet },
                          { to: "/history", label: "History", icon: IconDoc },
                          { to: "/fairness", label: "Provably Fair", icon: IconLock },
                          ...(staff ? [{ to: "/admin", label: "Admin Panel", icon: IconShield }] : []),
                        ].map((item) => (
                          <Link key={item.to} to={item.to} className="nav-link" style={{ display: "flex", gap: 10 }} onClick={() => setMenuOpen(false)}>
                            <item.icon size={16} />
                            {item.label}
                          </Link>
                        ))}
                        <div className="divider" style={{ margin: "6px 0" }} />
                        <button
                          className="nav-link"
                          style={{ display: "block", width: "100%", textAlign: "left" }}
                          onClick={async () => {
                            await logout();
                            setMenuOpen(false);
                            navigate("/");
                          }}
                        >
                  Log out
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => openAuth("login")}>
                  Login
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => openAuth("register")}>
                  Register
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {drawerOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <aside className="drawer" aria-label="Mobil menu">
            <div className="row-between" style={{ marginBottom: 14 }}>
              <Logo />
              <button className="btn btn-ghost btn-sm" onClick={() => setDrawerOpen(false)} aria-label="Close">
                <IconClose size={16} />
              </button>
            </div>

            {user && (
              <div className="card card-tight" style={{ marginBottom: 10 }}>
                <div className="row-between">
                  <div>
                    <div className="tiny faint">Balance</div>
                    <div className="bold" style={{ fontSize: 17 }}>
                      <WalletWidget compact />
                    </div>
                  </div>
                  <button
                    className={`btn btn-sm ${demoMode ? "btn-gold" : "btn-ghost"}`}
                    onClick={() => setDemoMode(!demoMode)}
                  >
                    {demoMode ? "DEMO" : "REAL"}
                  </button>
                </div>
              </div>
            )}

            {[...PRIMARY_NAV, ...DRAWER_EXTRA].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={"end" in item ? (item.end as boolean) : undefined}
                className={({ isActive }) => `drawer-link${isActive ? " active" : ""}`}
              >
                <item.icon size={18} />
                {item.label}
              </NavLink>
            ))}

            <div className="divider" />

            {user ? (
              <button
                className="drawer-link"
                onClick={async () => {
                  await logout();
                  setDrawerOpen(false);
                  navigate("/");
                }}
              >
                  Log out
              </button>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                <button
                  className="btn btn-ghost btn-block"
                  onClick={() => {
                    setDrawerOpen(false);
                    openAuth("login");
                  }}
                >
                    Login
                </button>
                <button
                  className="btn btn-primary btn-block"
                  onClick={() => {
                    setDrawerOpen(false);
                    openAuth("register");
                  }}
                >
                  Register
                </button>
              </div>
            )}
          </aside>
        </>
      )}

      <nav className="bottom-nav" aria-label="Alt menu">
        {BOTTOM_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
            <span className="bottom-nav-icon">
              <item.icon size={20} />
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} initialMode={authMode} />
    </>
  );
}
