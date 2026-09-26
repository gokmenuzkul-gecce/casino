import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { GAME_CATALOG } from "@aurora/game-core";

const prisma = new PrismaClient();

/**
 * Idempotent seed. Safe to run repeatedly in development: every write is an
 * upsert keyed on a natural identifier, so re-running refreshes configuration
 * without duplicating catalogue rows or wiping player data.
 */

const CATEGORIES = [
  { slug: "SLOTS", name: "Slot Oyunlari", sortOrder: 1 },
  { slug: "LIVE_CASINO", name: "Canli Casino", sortOrder: 2 },
  { slug: "TABLE", name: "Masa Oyunlari", sortOrder: 3 },
  { slug: "CRASH", name: "Crash", sortOrder: 4 },
  { slug: "INSTANT", name: "Anlik Oyunlar", sortOrder: 5 },
  { slug: "JACKPOT", name: "Jackpot", sortOrder: 6 },
  { slug: "LOTTERY", name: "Keno & Piyango", sortOrder: 7 },
  { slug: "FISHING", name: "Balikcilik", sortOrder: 8 },
  { slug: "VIRTUAL", name: "Sanal", sortOrder: 9 },
  { slug: "SPORTS", name: "Spor Bahis", sortOrder: 10 },
];

const INTERNAL_PROVIDER = { slug: "aurora-originals", name: "Aurora Originals", type: "INTERNAL" };

const GAME_META: Record<string, { description: string; themeColor: string; volatility: string; featured?: boolean; isNew?: boolean }> = {
  slots: { description: "5 makarali, 20 odeme hesapli klasik slot. Yuksek volatilite, 96% RTP.", themeColor: "#7c3aed", volatility: "HIGH", featured: true },
  crash: { description: "Carpan yukselirken nakde cek. Provably fair, anlik sonuclar.", themeColor: "#f43f5e", volatility: "HIGH", featured: true, isNew: true },
  mines: { description: "25 karede mayinlardan kacin, her kare kazancini artirir.", themeColor: "#10b981", volatility: "MEDIUM", featured: true },
  plinko: { description: "Topu birak, katsayi havuzuna dussun. 3 risk seviyesi.", themeColor: "#3b82f6", volatility: "MEDIUM", featured: true },
  dice: { description: "Hedef belirle, 0-100 arasi zar at. Sabit %99 RTP.", themeColor: "#8b5cf6", volatility: "LOW" },
  limbo: { description: "Hedef katsayiyi tuttur. Yuksek carpanlar mumkun.", themeColor: "#ec4899", volatility: "HIGH" },
  keno: { description: "40 sayidan 10'unu sec, 10 sayi cekilir. 4 risk modu.", themeColor: "#f59e0b", volatility: "MEDIUM", isNew: true },
  roulette: { description: "Avrupa ve Amerikan carki. Tam masa bahis secenekleri.", themeColor: "#dc2626", volatility: "MEDIUM", featured: true },
  blackjack: { description: "6 desteli ayakkabi, satici soft 17'de durur. 3:2 blackjack.", themeColor: "#0ea5e9", volatility: "LOW", featured: true },
};

const VIP_TIERS = [
  { tier: "BRONZE", name: "Bronze", level: 1, minWagered: 0n, cashbackPercent: 0, weeklyBonus: 0n, monthlyBonus: 0n, rakebackPercent: 0, benefits: ["Temel destek"], color: "#b45309" },
  { tier: "SILVER", name: "Silver", level: 2, minWagered: 50_000_00n, cashbackPercent: 2, weeklyBonus: 250_00n, monthlyBonus: 0n, rakebackPercent: 0.2, benefits: ["Haftalik bonus", "%2 cashback"], color: "#9ca3af" },
  { tier: "GOLD", name: "Gold", level: 3, minWagered: 250_000_00n, cashbackPercent: 5, weeklyBonus: 1_000_00n, monthlyBonus: 0n, rakebackPercent: 0.5, benefits: ["Haftalik bonus", "%5 cashback", "Oncelikli destek"], color: "#f59e0b" },
  { tier: "PLATINUM", name: "Platinum", level: 4, minWagered: 1_000_000_00n, cashbackPercent: 8, weeklyBonus: 3_000_00n, monthlyBonus: 5_000_00n, rakebackPercent: 0.8, benefits: ["Haftalik + aylik bonus", "%8 cashback", "Hizli cekim"], color: "#a5f3fc" },
  { tier: "DIAMOND", name: "Diamond", level: 5, minWagered: 5_000_000_00n, cashbackPercent: 12, weeklyBonus: 10_000_00n, monthlyBonus: 20_000_00n, rakebackPercent: 1.2, personalManager: true, benefits: ["Kisisel yonetici", "%12 cashback", "Sinirsiz cekim"], color: "#38bdf8" },
  { tier: "VIP_BLACK", name: "VIP Black", level: 6, minWagered: 25_000_000_00n, cashbackPercent: 20, weeklyBonus: 50_000_00n, monthlyBonus: 100_000_00n, rakebackPercent: 2, personalManager: true, benefits: ["Ozel masalar", "%20 cashback", "Ozel etkinlikler", "Dedike yonetici"], color: "#111827" },
];

const PAYMENT_METHODS = [
  { method: "CARD", displayName: "Kredi/Banka Karti", minAmount: 5_000n, maxAmount: 5_000_000n, feePercent: 0, feeFixed: 0n, sortOrder: 1, instructions: "3D Secure ile guvenli odeme." },
  { method: "BANK_TRANSFER", displayName: "Havale/EFT", minAmount: 10_000n, maxAmount: 50_000_000n, feePercent: 0, feeFixed: 0n, sortOrder: 2, instructions: "IBAN'a havale, aciklama kismina referans kodunu yazin." },
  { method: "PAPARA", displayName: "Papara", minAmount: 5_000n, maxAmount: 2_000_000n, feePercent: 0, feeFixed: 0n, sortOrder: 3 },
  { method: "PAYFIX", displayName: "PayFix", minAmount: 5_000n, maxAmount: 2_000_000n, feePercent: 0, feeFixed: 0n, sortOrder: 4 },
  { method: "E_WALLET", displayName: "Cuzdan", minAmount: 5_000n, maxAmount: 1_000_000n, feePercent: 1, feeFixed: 0n, sortOrder: 5 },
  { method: "CRYPTO", displayName: "Kripto (USDT/BTC)", minAmount: 10_000n, maxAmount: 100_000_000n, feePercent: 0, feeFixed: 0n, sortOrder: 6, instructions: "Anlik ve dusuk komisyonlu." },
];

const ACHIEVEMENTS = [
  { code: "FIRST_BET", name: "Ilk Bahis", description: "Ilk bahsini yerlestir", metric: "BETS", target: 1, rewardAmount: 10_00n, tier: "BRONZE" },
  { code: "HUNDRED_BETS", name: "Yuz Bahis", description: "100 bahis tamamla", metric: "BETS", target: 100, rewardAmount: 100_00n, tier: "SILVER" },
  { code: "BIG_WIN", name: "Buyuk Kazanc", description: "10x katsayi ile kazan", metric: "MULTIPLIER", target: 10, rewardAmount: 50_00n, tier: "SILVER" },
  { code: "CRASH_SURVIVOR", name: "Crash Ustasi", description: "Crash'te 5x nakde cek", metric: "MULTIPLIER", target: 5, rewardAmount: 75_00n, tier: "GOLD" },
  { code: "LOYAL_WEEK", name: "Haftalik Sadakat", description: "7 gun ustuste oyna", metric: "STREAK", target: 7, rewardAmount: 200_00n, tier: "GOLD" },
  { code: "HIGH_ROLLER", name: "Yuksek Bahisci", description: "Tek bahiste 1000 TL", metric: "STAKE", target: 100_000, rewardAmount: 500_00n, tier: "PLATINUM" },
];

const BONUSES = [
  {
    code: "WELCOME100",
    name: "Hos Geldin Bonusu",
    description: "Ilk yatiriminiza %100 bonus, 30x cevrim sarti ile.",
    type: "WELCOME",
    percent: 100,
    maxBonus: 5_000_00n,
    minDeposit: 100_00n,
    wageringMultiplier: 30,
    terms: "Bonus 30 gun gecerlidir. Slot katki %100, masa oyunlari %10.",
    contributionRates: { SLOTS: 100, INSTANT: 100, CRASH: 100, TABLE: 10, LIVE_CASINO: 10, LOTTERY: 50 },
    isAutoApply: true,
    newPlayersOnly: true,
  },
  {
    code: "RELOAD50",
    name: "Haftalik Reload",
    description: "Her hafta %50 bonus, 25x cevrim.",
    type: "RELOAD",
    percent: 50,
    maxBonus: 2_500_00n,
    minDeposit: 100_00n,
    wageringMultiplier: 25,
    newPlayersOnly: false,
    isAutoApply: false,
  },
  {
    code: "FREESPIN50",
    name: "50 Bedava Spin",
    description: "Aurora Fortune slotunda 50 bedava spin.",
    type: "FREE_SPINS",
    fixedAmount: 50_00n,
    wageringMultiplier: 20,
    newPlayersOnly: true,
    isAutoApply: false,
  },
  {
    code: "CRASH10",
    name: "Crash Cashback %10",
    description: "Crash kayiplarinizda %10 cashback.",
    type: "CASHBACK",
    percent: 10,
    wageringMultiplier: 5,
    newPlayersOnly: false,
    contributionRates: { CRASH: 100 },
  },
];

async function main(): Promise<void> {
  console.log("Seed basliyor...");

  // ── categories ────────────────────────────────────────────────────────
  for (const category of CATEGORIES) {
    await prisma.gameCategoryModel.upsert({
      where: { slug: category.slug },
      create: category,
      update: { name: category.name, sortOrder: category.sortOrder },
    });
  }
  console.log(`  ${CATEGORIES.length} kategori`);

  // ── providers ─────────────────────────────────────────────────────────
  const internalProvider = await prisma.gameProviderModel.upsert({
    where: { slug: INTERNAL_PROVIDER.slug },
    create: INTERNAL_PROVIDER,
    update: { name: INTERNAL_PROVIDER.name },
  });

  // ── internal games ────────────────────────────────────────────────────
  for (const entry of GAME_CATALOG) {
    const category = await prisma.gameCategoryModel.findUnique({ where: { slug: entry.category } });
    const meta = GAME_META[entry.slug];
    const game = await prisma.game.upsert({
      where: { slug: entry.slug },
      create: {
        slug: entry.slug,
        name: entry.name,
        description: meta?.description,
        categoryId: category?.id,
        providerId: internalProvider.id,
        embedType: "INTERNAL",
        themeColor: meta?.themeColor,
        volatility: meta?.volatility ?? "MEDIUM",
        rtp: entry.houseEdge,
        minBet: 1_00n,
        maxBet: 1_000_000_00n,
        isActive: true,
        isFeatured: meta?.featured ?? false,
        isNew: meta?.isNew ?? false,
        demoEnabled: true,
        realEnabled: true,
        isJackpot: false,
        tags: [entry.category.toLowerCase(), entry.slug],
        supportedCurrencies: ["TRY", "USD", "EUR"],
      },
      update: {
        name: entry.name,
        categoryId: category?.id,
        themeColor: meta?.themeColor,
        description: meta?.description,
      },
    });

    // A jackpot pool for the flagship slot, seeded so the ticker is alive.
    if (entry.slug === "slots") {
      await prisma.jackpot.upsert({
        where: { gameId: game.id },
        create: {
          gameId: game.id,
          name: `${entry.name} Jackpot`,
          currency: "TRY",
          currentAmount: 125_000_00n,
          seedAmount: 100_000_00n,
          contributionRate: 1,
        },
        update: {},
      });
    }
  }
  console.log(`  ${GAME_CATALOG.length} dahili oyun`);

  // ── VIP tiers ─────────────────────────────────────────────────────────
  for (const tier of VIP_TIERS) {
    await prisma.vipTierConfig.upsert({
      where: { tier: tier.tier },
      create: tier,
      update: { name: tier.name, minWagered: tier.minWagered, cashbackPercent: tier.cashbackPercent, benefits: tier.benefits, color: tier.color, rakebackPercent: tier.rakebackPercent },
    });
  }
  console.log(`  ${VIP_TIERS.length} VIP seviyesi`);

  // ── payment methods ───────────────────────────────────────────────────
  for (const method of PAYMENT_METHODS) {
    await prisma.paymentMethodConfig.upsert({
      where: { method: method.method },
      create: { ...method, enabled: true, currencies: ["TRY", "USD", "EUR"] },
      update: { displayName: method.displayName, minAmount: method.minAmount, maxAmount: method.maxAmount },
    });
  }
  console.log(`  ${PAYMENT_METHODS.length} odeme yontemi`);

  // ── achievements ──────────────────────────────────────────────────────
  for (const achievement of ACHIEVEMENTS) {
    await prisma.achievement.upsert({
      where: { code: achievement.code },
      create: achievement,
      update: { name: achievement.name, description: achievement.description, target: achievement.target, rewardAmount: achievement.rewardAmount },
    });
  }
  console.log(`  ${ACHIEVEMENTS.length} basarim`);

  // ── bonuses ───────────────────────────────────────────────────────────
  for (const bonus of BONUSES) {
    await prisma.bonus.upsert({
      where: { code: bonus.code },
      create: {
        ...bonus,
        status: "ACTIVE",
        currency: "TRY",
        perUserLimit: 1,
        displayOnHome: true,
        contributionRates: bonus.contributionRates as never,
      },
      update: { name: bonus.name, description: bonus.description, percent: bonus.percent, maxBonus: bonus.maxBonus },
    });
  }
  console.log(`  ${BONUSES.length} bonus`);

  // ── CMS pages ─────────────────────────────────────────────────────────
  const pages = [
    { slug: "hakkimizda", title: "Hakkimizda", content: "<h1>Hakkimizda</h1><p>Aurora, provably fair oyun motoru ve seffaf muhasebe altyapisiyla kurulmus modern bir oyun platformudur.</p>" },
    { slug: "kullanim-sartlari", title: "Kullanim Sartlari", content: "<h1>Kullanim Sartlari</h1><p>Platformu kullanarak 18 yasindan buyuk oldugunuzu ve yerel yasalara uydugunuzu kabul edersiniz.</p>" },
    { slug: "sorumlu-oyun", title: "Sorumlu Oyun", content: "<h1>Sorumlu Oyun</h1><p>Kontrol sizde: yatirim, kayip ve oturum limitleri ile kendini dislama araclari hesabinizda hazir.</p>" },
    { slug: "gizlilik", title: "Gizlilik Politikasi", content: "<h1>Gizlilik</h1><p>Kisisel verileriniz KVKK kapsaminda islenir ve ucuncu taraflarla paylasilmaz.</p>" },
    { slug: "provably-fair", title: "Provably Fair", content: "<h1>Provably Fair</h1><p>Her tur icin sunucu tohumunun SHA-256 ozeti onceden yayinlanir. Tur bittiginde tohum aciklanir ve sonucu bagimsiz olarak dogrulayabilirsiniz.</p>" },
    { slug: "sss", title: "Sikca Sorulan Sorular", content: "<h1>SSS</h1><p>Yatirim, cekim ve bonus sorularinizin yanitlari burada.</p>" },
  ];
  for (const page of pages) {
    await prisma.cmsPage.upsert({
      where: { slug: page.slug },
      create: { ...page, status: "PUBLISHED", locale: "tr", publishedAt: new Date() },
      update: { title: page.title, content: page.content, status: "PUBLISHED" },
    });
  }
  console.log(`  ${pages.length} CMS sayfasi`);

  // ── banners ───────────────────────────────────────────────────────────
  const existingBanners = await prisma.banner.count();
  if (existingBanners === 0) {
    await prisma.banner.createMany({
      data: [
        { title: "Hos Geldin: %100 Bonus", imageUrl: "/banners/welcome.svg", linkUrl: "/promotions", position: "HOME_HERO", sortOrder: 1, isActive: true },
        { title: "Crash Turnuvasi", imageUrl: "/banners/crash.svg", linkUrl: "/tournaments", position: "HOME_HERO", sortOrder: 2, isActive: true },
        { title: "VIP Black Avantajlari", imageUrl: "/banners/vip.svg", linkUrl: "/vip", position: "HOME_HERO", sortOrder: 3, isActive: true },
      ],
    });
  }

  // ── feature flags ─────────────────────────────────────────────────────
  const flags = [
    { key: "sportsbook", enabled: true, description: "Spor bahis modulu" },
    { key: "live_casino", enabled: true, description: "Canli casino bolumu" },
    { key: "tournaments", enabled: true, description: "Turnuvalar" },
    { key: "vip", enabled: true, description: "VIP programi" },
    { key: "affiliates", enabled: true, description: "Afiili sistemi" },
    { key: "crypto", enabled: true, description: "Kripto odemeler" },
    { key: "kyc", enabled: true, description: "Kimlik dogrulama" },
    { key: "crash_live", enabled: true, description: "Canli crash dongusu" },
  ];
  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      create: flag,
      update: { description: flag.description, enabled: flag.enabled },
    });
  }

  // ── email templates ───────────────────────────────────────────────────
  const templates = [
    { key: "welcome", subject: "Aurora'ya hos geldiniz", html: "<h2>Hos geldiniz!</h2><p>Hesabiniz olusturuldu. Demo bakiyenizle hemen oynamaya baslayabilirsiniz.</p>" },
    { key: "deposit_confirmed", subject: "Yatiriminiz onaylandi", html: "<p>Yatiriminiz hesabiniza eklendi.</p>" },
    { key: "withdrawal_approved", subject: "Cekiminiz onaylandi", html: "<p>Cekim talebiniz isleme alindi.</p>" },
    { key: "kyc_approved", subject: "Kimlik dogrulamaniz onaylandi", html: "<p>Hesabiniz dogrulandi. Cekim yapabilirsiniz.</p>" },
    { key: "bonus_granted", subject: "Bonusunuz hazir", html: "<p>Yeni bonusunuz hesabiniza tanimlandi.</p>" },
  ];
  for (const template of templates) {
    await prisma.emailTemplate.upsert({
      where: { key: template.key },
      create: { ...template, isActive: true },
      update: { subject: template.subject, html: template.html },
    });
  }

  // ── settings ──────────────────────────────────────────────────────────
  const settings = [
    { key: "brand.name", value: "Aurora", category: "brand" },
    { key: "brand.primaryColor", value: "#7c3aed", category: "brand" },
    { key: "brand.logoUrl", value: "/logo.svg", category: "brand" },
    { key: "support.email", value: "destek@aurora.local", category: "support" },
    { key: "support.liveChatUrl", value: "", category: "support" },
    { key: "limits.minWithdrawal", value: "100", category: "limits" },
    { key: "limits.maxWithdrawalPerDay", value: "50000", category: "limits" },
    { key: "limits.autoApproveBelow", value: "500", category: "limits" },
    { key: "limits.requireKycAbove", value: "1000", category: "limits" },
    { key: "jackpot.enabled", value: "true", category: "games" },
    { key: "chat.enabled", value: "true", category: "chat" },
    { key: "chat.slowModeSeconds", value: "3", category: "chat" },
  ];
  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      create: { key: setting.key, value: setting.value as never, category: setting.category },
      update: { category: setting.category },
    });
  }

  // ── admin user ────────────────────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@aurora.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "Admin!2345";
  const adminUsername = process.env.ADMIN_USERNAME ?? "superadmin";

  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      username: adminUsername,
      passwordHash,
      roles: ["SUPER_ADMIN"],
      status: "ACTIVE",
      currency: "TRY",
      emailVerifiedAt: new Date(),
    },
    update: { roles: ["SUPER_ADMIN"], status: "ACTIVE" },
  });

  for (const type of ["REAL", "BONUS", "DEMO"] as const) {
    await prisma.wallet.upsert({
      where: { userId_currency_type: { userId: admin.id, currency: "TRY", type } },
      create: { userId: admin.id, currency: "TRY", type, isPrimary: type === "REAL" },
      update: {},
    });
  }
  await prisma.vipProfile.upsert({ where: { userId: admin.id }, create: { userId: admin.id, tier: "VIP_BLACK", level: 6 }, update: {} });

  console.log(`  Yonetici: ${adminEmail} / ${adminPassword}`);

  // ── demo player accounts ──────────────────────────────────────────────
  const demoPlayers = [
    { username: "demo_player", email: "demo@aurora.local", balance: 10_000_00n },
    { username: "test_user", email: "test@aurora.local", balance: 1_000_00n },
  ];

  for (const player of demoPlayers) {
    const exists = await prisma.user.findUnique({ where: { email: player.email } });
    if (exists) continue;

    const user = await prisma.user.create({
      data: {
        email: player.email,
        username: player.username,
        passwordHash: await argon2.hash("Demo!2345", { type: argon2.argon2id }),
        roles: ["PLAYER"],
        status: "ACTIVE",
        currency: "TRY",
        emailVerifiedAt: new Date(),
      },
    });

    for (const type of ["REAL", "BONUS", "DEMO"] as const) {
      await prisma.wallet.create({
        data: {
          userId: user.id,
          currency: "TRY",
          type,
          balance: type === "REAL" ? player.balance : type === "DEMO" ? 1_000_00n : 0n,
          isPrimary: type === "REAL",
        },
      });
    }
    await prisma.vipProfile.create({ data: { userId: user.id, lifetimeWagered: player.balance * 3n, tier: "SILVER", level: 2 } });
    await prisma.affiliate.create({ data: { userId: user.id, code: player.username } });
  }
  console.log(`  ${demoPlayers.length} demo oyuncu`);

  console.log("Seed tamamlandi.");
}

main()
  .catch((error) => {
    console.error("Seed hatasi:", error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
