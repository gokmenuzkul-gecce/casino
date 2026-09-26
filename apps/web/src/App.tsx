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
            Provably fair oyun motoru uzerine kurulu, lisanslanabilir online casino platformu. Her tur bagimsiz olarak
            dogrulanabilir.
          </p>
          <div className="footer-badges" style={{ marginTop: 16 }}>
            <span className="footer-badge">18+</span>
            <span className="footer-badge">Provably Fair</span>
            <span className="footer-badge">Sorumlu Oyun</span>
          </div>
        </div>

        <div>
          <div className="footer-col-title">Oyunlar</div>
          <Link to="/games" className="footer-link">Tum Oyunlar</Link>
          <Link to="/live" className="footer-link">Canli Casino</Link>
          <Link to="/games?category=SLOTS" className="footer-link">Slotlar</Link>
          <Link to="/games?category=TABLE" className="footer-link">Masa Oyunlari</Link>
          <Link to="/crash" className="footer-link">Crash</Link>
        </div>

        <div>
          <div className="footer-col-title">Kampanyalar</div>
          <Link to="/promotions" className="footer-link">Bonuslar</Link>
          <Link to="/tournaments" className="footer-link">Turnuvalar</Link>
          <Link to="/vip" className="footer-link">VIP Programi</Link>
          <Link to="/leaderboard" className="footer-link">Liderlik Tablosu</Link>
        </div>

        <div>
          <div className="footer-col-title">Hesabim</div>
          <Link to="/account" className="footer-link">Profil</Link>
          <Link to="/wallet" className="footer-link">Cuzdan</Link>
          <Link to="/history" className="footer-link">Islem Gecmisi</Link>
          <Link to="/kyc" className="footer-link">Kimlik Dogrulama</Link>
        </div>

        <div>
          <div className="footer-col-title">Yasal</div>
          <Link to="/cms/kullanim-sartlari" className="footer-link">Kullanim Sartlari</Link>
          <Link to="/cms/gizlilik" className="footer-link">Gizlilik Politikasi</Link>
          <Link to="/cms/sorumlu-oyun" className="footer-link">Sorumlu Oyun</Link>
          <Link to="/fairness" className="footer-link">Provably Fair</Link>
        </div>
      </div>

      <div className="footer-bottom">
        <span className="tiny faint">
          © {new Date().getFullYear()} Aurora. Tum haklari saklidir. 18+ · Kumar bagimlilik yapabilir, sorumlu oynayin.
        </span>
        <div className="footer-badges">
          <span className="footer-badge">Aurora Originals</span>
          <span className="footer-badge">SSL Korumali</span>
        </div>
      </div>
    </footer>
  );
}

export { isStaffUser };
