/**
 * Imports the live BetSkilla catalogue into our game tables.
 *
 * Run with: npm run sync:games --workspace @aurora/engine
 * Options (env): SYNC_LIMIT (games per type, default all), SYNC_TYPE (slot|live|both)
 *
 * Idempotent: games are upserted on their numeric provider id, so re-running
 * refreshes metadata without touching player data or favourites.
 */
import { PrismaClient } from "@prisma/client";
import { BetSkillaAggregator } from "../src/providers/betskilla.js";
import { env } from "../src/lib/env.js";

const prisma = new PrismaClient();

const CATEGORY_BY_TYPE: Record<string, string> = { SLOTS: "SLOTS", LIVE: "LIVE_CASINO" };

function slugify(input: string, suffix: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base}-${suffix}`.slice(0, 80);
}

async function main(): Promise<void> {
  const adapter = new BetSkillaAggregator({
    baseUrl: env.betskilla.baseUrl,
    login: env.betskilla.login,
    password: env.betskilla.password,
    currency: env.betskilla.currency,
  });

  if (!adapter.isConfigured) {
    throw new Error("BETSKILLA_BASE_URL / LOGIN / PASSWORD eksik. .env dosyasini doldurun.");
  }

  const health = await adapter.healthCheck();
  console.log(`Saglayici: ${health.provider} (${health.mode}) reachable=${health.reachable}`);
  console.log(`  ${health.detail}`);

  const types = (process.env.SYNC_TYPE ?? "both").toLowerCase();
  const categories = types === "both" ? ["slot", "live"] : [types];
  let imported = 0;

  for (const category of categories) {
    const wanted = Number(process.env.SYNC_LIMIT ?? 0);
    const pageSize = wanted > 0 ? Math.min(wanted, 200) : 200;
    let page = 1;
    let fetched = 0;

    for (;;) {
      const games = await adapter.listGames({ category, page, pageSize });
      if (!games.length) break;

      for (const game of games) {
        const categorySlug = CATEGORY_BY_TYPE[game.category] ?? "SLOTS";
        const categoryRow = await prisma.gameCategoryModel.findUnique({ where: { slug: categorySlug } });
        const providerRow = await prisma.gameProviderModel.upsert({
          where: { slug: `betskilla-${game.provider.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` },
          create: {
            slug: `betskilla-${game.provider.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            name: game.provider,
            type: "EXTERNAL",
          },
          update: { name: game.provider },
        });

        const slug = slugify(game.name, `bs${game.externalId}`);
        await prisma.game.upsert({
          where: { slug },
          create: {
            slug,
            name: game.name,
            categoryId: categoryRow?.id,
            providerId: providerRow.id,
            providerGameId: game.externalId,
            thumbnailUrl: game.thumbnailUrl,
            embedType: "EXTERNAL",
            rtp: 96,
            volatility: "MEDIUM",
            minBet: 1_00n,
            maxBet: 10_000_000_00n,
            isActive: true,
            demoEnabled: game.demoSupported ?? false,
            realEnabled: true,
            tags: game.tags ?? [],
            supportedCurrencies: game.currencies ?? [env.betskilla.currency],
          },
          update: {
            name: game.name,
            categoryId: categoryRow?.id,
            providerId: providerRow.id,
            providerGameId: game.externalId,
            thumbnailUrl: game.thumbnailUrl,
            themeColor: game.themeColor,
            isActive: true,
          },
        });
        imported++;
      }

      fetched += games.length;
      console.log(`  ${category}: ${fetched} oyun islendi (sayfa ${page})`);
      if (games.length < pageSize) break;
      if (wanted > 0 && fetched >= wanted) break;
      if (fetched >= 4000) break;
      page++;
    }
  }

  const total = await prisma.game.count();
  const external = await prisma.game.count({ where: { embedType: "EXTERNAL" } });
  console.log(`\nTamamlandi. Bu calismada ${imported} oyun islendi.`);
  console.log(`Veritabani: toplam ${total} oyun, ${external} harici oyun.`);
}

main()
  .catch((error) => {
    console.error("Senkronizasyon hatasi:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
