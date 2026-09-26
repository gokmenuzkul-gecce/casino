import { create } from "zustand";
import { get, post, setTokens } from "../lib/api";

export interface User {
  id: string;
  email: string;
  username: string;
  roles: string[];
  status: string;
  currency: string;
  twoFactorEnabled: boolean;
  affiliateCode?: string | null;
}

export interface WalletSummary {
  currency: string;
  real: string;
  bonus: string;
  demo: string;
  locked: string;
  available: string;
}

interface AppState {
  user: User | null;
  wallet: WalletSummary | null;
  loading: boolean;
  booted: boolean;
  bonusCount: number;
  unreadCount: number;

  boot: () => Promise<void>;
  login: (identifier: string, password: string, totp?: string) => Promise<{ requiresTwoFactor?: boolean }>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setWallet: (wallet: WalletSummary) => void;
  setDemoMode: (on: boolean) => void;
  demoMode: boolean;
}

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
  currency?: string;
  phone?: string;
  referralCode?: string;
}

export const useApp = create<AppState>((set, getState) => ({
  user: null,
  wallet: null,
  loading: false,
  booted: false,
  bonusCount: 0,
  unreadCount: 0,
  demoMode: false,

  boot: async () => {
    const token = localStorage.getItem("aurora_access_token");
    if (!token) {
      set({ booted: true });
      return;
    }
    try {
      const me = await get<{ user: User; wallets: WalletSummary }>("/api/auth/me");
      const bonuses = await get<{ bonuses: { status: string }[] }>("/api/wallet/bonuses").catch(() => ({ bonuses: [] }));
      set({
        user: me.user,
        wallet: me.wallets,
        booted: true,
        bonusCount: bonuses.bonuses.filter((b) => b.status === "ACTIVE").length,
      });
    } catch {
      setTokens(null);
      set({ user: null, wallet: null, booted: true });
    }
  },

  login: async (identifier, password, totp) => {
    set({ loading: true });
    try {
      const result = await post<{
        requiresTwoFactor?: boolean;
        user?: User;
        wallets?: WalletSummary;
        tokens?: { accessToken: string; refreshToken: string };
      }>("/api/auth/login", { identifier, password, totp });

      if (result.requiresTwoFactor) return { requiresTwoFactor: true };
      if (result.tokens) setTokens(result.tokens);
      set({ user: result.user ?? null, wallet: result.wallets ?? null });
      return {};
    } finally {
      set({ loading: false });
    }
  },

  register: async (payload) => {
    set({ loading: true });
    try {
      const result = await post<{ user: User; wallets: WalletSummary; tokens: { accessToken: string; refreshToken: string } }>(
        "/api/auth/register",
        { ...payload, acceptTerms: true, ageConfirmed: true },
      );
      setTokens(result.tokens);
      set({ user: result.user, wallet: result.wallets });
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    await post("/api/auth/logout").catch(() => undefined);
    setTokens(null);
    set({ user: null, wallet: null, demoMode: false });
  },

  refreshMe: async () => {
    if (!getState().user) return;
    const me = await get<{ user: User; wallets: WalletSummary }>("/api/auth/me");
    set({ user: me.user, wallet: me.wallets });
  },

  setWallet: (wallet) => set({ wallet }),
  setDemoMode: (demoMode) => set({ demoMode }),
}));

export const isStaffUser = (user: User | null): boolean =>
  Boolean(user?.roles.some((r) => ["ADMIN", "SUPER_ADMIN", "MANAGER", "SUPPORT", "FINANCE", "RISK", "COMPLIANCE", "AFFILIATE_MANAGER", "CONTENT_MANAGER"].includes(r)));
