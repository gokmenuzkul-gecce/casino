/**
 * Imports the live BetSkilla catalogue into our game tables.
 *
 * Run with: npm run sync:games --workspace @aurora/engine
 * Options (env):
 *   SYNC_LIMIT   games per type to scan (default all)
 *   SYNC_TYPE    slot | live | both (default both)
 *   SYNC_PROBE   set to 0 to publish without a playability check (default on)
 *   SYNC_CONCURRENCY  parallel launch probes (default 8)
 *   SYNC_MAX_SCAN     safety cap on games scanned per type (default 20000)
 *
 * Every game is probed with a throwaway demo launch first: the catalogue
 * advertises entries whose upstream session endpoint answers 404, and shipping
 * those gives players tiles that always fail. Unplayable rows are kept but
 * marked inactive, so they drop out of listings yet still resolve if linked.
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

/** Runs `worker` over `items` with a bounded number of concurrent tasks. */
async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
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

  const probe = process.env.SYNC_PROBE !== "0";
  const concurrency = Math.max(1, Number(process.env.SYNC_CONCURRENCY ?? 8));
  const maxScan = Math.max(1, Number(process.env.SYNC_MAX_SCAN ?? 20000));
  const types = (process.env.SYNC_TYPE ?? "both").toLowerCase();
  const categories = types === "both" ? ["slot", "live"] : [types];

  let imported = 0;
  let skipped = 0;

  for (const category of categories) {
    const wanted = Number(process.env.SYNC_LIMIT ?? 0);
    const pageSize = wanted > 0 ? Math.min(wanted, 200) : 200;

    // Page through the catalogue first so probing can run at full concurrency.
    const catalogue = [];
    for (let page = 1; ; page++) {
      const games = await adapter.listGames({ category, page, pageSize });
      if (!games.length) break;
      catalogue.push(...games);
      console.log(`  ${category}: ${catalogue.length} oyun okundu (sayfa ${page})`);
      if (games.length < pageSize) break;
      if (wanted > 0 && catalogue.length >= wanted) break;
      if (catalogue.length >= maxScan) break;
    }
    if (wanted > 0) catalogue.splice(wanted);

    let playable = catalogue.map(() => true);
    if (probe) {
      console.log(`  ${category}: ${catalogue.length} oyun oynanabilirlik icin test ediliyor...`);
      playable = await mapPool(catalogue, concurrency, async (game) => {
        const ok = await adapter.isPlayable(game.launchRouter ?? "");
        return ok;
      });
      const okCount = playable.filter(Boolean).length;
      console.log(`  ${category}: ${okCount}/${catalogue.length} oyun oynanabilir`);
    }

    for (let i = 0; i < catalogue.length; i++) {
      const game = catalogue[i];
      const isPlayable = playable[i];
      if (!isPlayable) skipped++;

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
          config: game.launchRouter ? { launchRouter: game.launchRouter } : undefined,
          rtp: 96,
          volatility: "MEDIUM",
          minBet: 1_00n,
          maxBet: 10_000_000_00n,
          isActive: isPlayable,
          demoEnabled: isPlayable && (game.demoSupported ?? false),
          realEnabled: isPlayable,
          tags: game.tags ?? [],
          supportedCurrencies: game.currencies ?? [env.betskilla.currency],
        },
        update: {
          name: game.name,
          categoryId: categoryRow?.id,
          providerId: providerRow.id,
          providerGameId: game.externalId,
          thumbnailUrl: game.thumbnailUrl,
          config: game.launchRouter ? { launchRouter: game.launchRouter } : undefined,
          isActive: isPlayable,
          demoEnabled: isPlayable && (game.demoSupported ?? false),
          realEnabled: isPlayable,
        },
      });
      imported++;
    }
  }

  // Retire duplicate rows left by the earlier aggregator importer. Its games
  // carry no config.launchRouter, so launching them fell back to a slow (and
  // usually failing) catalogue scan. A duplicate is only retired when the same
  // providerGameId also exists under a betsKilla-managed provider, which is the
  // live one; anything without a counterpart is left untouched so no game is
  // lost.
  const managedProviders = await prisma.gameProviderModel.findMany({
    where: { games: { some: { embedType: "EXTERNAL" } } },
    select: { id: true, name: true, slug: true, type: true },
  });
  const managedExternalIds = new Set(
    (
      await prisma.game.findMany({
        where: { embedType: "EXTERNAL", providerId: { in: managedProviders.filter((p) => p.slug.startsWith("betskilla-")).map((p) => p.id) } },
        select: { providerGameId: true },
      })
    )
      .map((g) => g.providerGameId)
      .filter((id): id is string => Boolean(id)),
  );

  const legacyProviders = managedProviders.filter((p) => p.type === "AGGREGATOR");
  let retired = 0;
  let kept = 0;
  for (const provider of legacyProviders) {
    const legacyGames = await prisma.game.findMany({
      where: { providerId: provider.id, embedType: "EXTERNAL", isActive: true },
      select: { id: true, providerGameId: true },
    });
    const duplicates = legacyGames.filter((g) => g.providerGameId && managedExternalIds.has(g.providerGameId));
    const orphans = legacyGames.length - duplicates.length;
    kept += orphans;
    if (duplicates.length > 0) {
      await prisma.game.updateMany({
        where: { id: { in: duplicates.map((g) => g.id) } },
        data: { isActive: false },
      });
      retired += duplicates.length;
      console.log(`  Emekliye ayrildi: ${provider.name} (${duplicates.length} yinelenen, ${orphans} benzersiz korundu)`);
    }
  }

  const total = await prisma.game.count();
  const external = await prisma.game.count({ where: { embedType: "EXTERNAL" } });
  const activeExternal = await prisma.game.count({ where: { embedType: "EXTERNAL", isActive: true } });
  console.log(
    `\nTamamlandi. ${imported} oyun islendi, ${skipped} oyun oynanabilir olmadigi icin pasif, ${retired} yinelenen emekliye ayrildi, ${kept} benzersiz eski kayit korundu.`,
  );
  console.log(`Veritabani: toplam ${total} oyun, ${external} harici, ${activeExternal} aktif harici.`);
}

main()
  .catch((error) => {
    console.error("Senkronizasyon hatasi:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
