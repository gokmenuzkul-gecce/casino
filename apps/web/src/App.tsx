import { useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Header } from "./components/Header";
import { useApp, isStaffUser } from "./store/app";
import { HomePage } from "./pages/HomePage";
import { GamesPage, PlayPage } from "./pages/GamesPage";
import { CrashPage } from "./pages/CrashPage";
import { WalletPage, PromotionsPage } from "./pages/WalletPage";
import { AccountPage, KycPage, HistoryPage } from "./pages/AccountPage";
import { VipPage, LeaderboardPage, TournamentsPage, LivePage, FairnessPage } from "./pages/MiscPages";
import { CmsPage } from "./pages/CmsPage";
import { ChatWidget } from "./components/ChatWidget";
import { LogoMark } from "./components/Header";
import { AdminLayout } from "./admin/AdminLayout";
import { Spinner } from "./components/ui";

export default function App() {
  const { boot, booted } = useApp();
  const location = useLocation();

  useEffect(() => {
    void boot();
  }, [boot]);

  // Scroll to top on navigation; game pages manage their own scroll.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (!booted) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Spinner label="Aurora yukleniyor" />
      </div>
    );
  }

  if (location.pathname.startsWith("/admin")) {
    // The admin shell owns its own nested <Routes>, which only resolve relative
    // to a parent route — mounting it at "/admin/*" keeps the URL in sync.
    return (
      <Routes>
        <Route path="/admin/*" element={<AdminLayout />} />
      </Routes>
    );
  }

  return (
    <div className="app-shell">
      <Header />
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/play/:slug" element={<PlayPage />} />
          <Route path="/crash" element={<CrashPage />} />
          <Route path="/live" element={<LivePage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/promotions" element={<PromotionsPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/kyc" element={<KycPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/vip" element={<VipPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/fairness" element={<FairnessPage />} />
          <Route path="/cms/:slug" element={<CmsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ChatWidget />
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div>
          <div className="logo" style={{ marginBottom: 12 }}>
            <span className="logo-mark">
              <LogoMark />
            </span>
            Aurora
          </div>
          <p className="small muted" style={{ maxWidth: 320, lineHeight: 1.6 }}>
            Online casino platform built on a provably fair game engine. Every round can be verified independently.
          </p>
          <div className="footer-badges" style={{ marginTop: 16 }}>
            <span className="footer-badge">18+</span>
            <span className="footer-badge">Provably Fair</span>
            <span className="footer-badge">Responsible Gaming</span>
          </div>
        </div>

        <div>
          <div className="footer-col-title">Casino</div>
          <Link to="/games" className="footer-link">All Games</Link>
          <Link to="/live" className="footer-link">Live Casino</Link>
          <Link to="/games?category=SLOTS" className="footer-link">Slots</Link>
          <Link to="/games?category=TABLE" className="footer-link">Table Games</Link>
          <Link to="/crash" className="footer-link">Instant</Link>
        </div>

        <div>
          <div className="footer-col-title">Activities</div>
          <Link to="/promotions" className="footer-link">Promotions</Link>
          <Link to="/tournaments" className="footer-link">Tournaments</Link>
          <Link to="/leaderboard" className="footer-link">Hall of Fame</Link>
          <Link to="/leaderboard" className="footer-link">High Rollers</Link>
        </div>

        <div>
          <div className="footer-col-title">Legal</div>
          <Link to="/cms/sorumlu-oyun" className="footer-link">Responsible Gaming</Link>
          <Link to="/cms/gizlilik" className="footer-link">Cookie Files</Link>
          <Link to="/cms/kullanim-sartlari" className="footer-link">Terms</Link>
          <Link to="/cms/hakkimizda" className="footer-link">About Us</Link>
          <Link to="/cms/sss" className="footer-link">FAQ</Link>
        </div>

        <div>
          <div className="footer-col-title">Contact us</div>
          <a href="mailto:support@aurora.com" className="footer-link">support@aurora.com</a>
          <a href="mailto:marketing@aurora.com" className="footer-link">marketing@aurora.com</a>
          <a href="mailto:cooperation@aurora.com" className="footer-link">cooperation@aurora.com</a>
        </div>
      </div>

      <div className="footer-bottom">
        <span className="tiny faint">
          Notice: This is gambling-related advertising. Gambling will not help you fix financial issues. Always read
          the terms and conditions and gamble responsibly.
        </span>
        <div className="footer-badges">
          <span className="footer-badge">Aurora Originals</span>
          <span className="footer-badge">SSL Secured</span>
        </div>
      </div>
    </footer>
  );
}

export { isStaffUser };
