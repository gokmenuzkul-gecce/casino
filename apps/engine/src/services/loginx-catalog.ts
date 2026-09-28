/**
 * Imports the loginxgamesapi catalogue into the game tables.
 *
 * Shared by the `sync:loginx` script and the admin panel button so both behave
 * identically. Every row is written INACTIVE on purpose: the vendor has not
 * exposed a launch endpoint, so an active row would appear in the lobby and fail
 * on click. Keeping them inactive lets an operator review the content now, and a
 * later run flips them on without a code change.
 *
 * The import is idempotent — keyed on the deterministic slug — so re-running
 * refreshes metadata and never touches player data, favourites or bets.
 *
 * See docs/providers/loginx-games-api.md for what the API does and does not do.
 */
import type { PrismaClient } from "@prisma/client";
import { LoginxGamesAggregator, loginxVendorsFromEnv } from "../providers/loginx.js";

export interface LoginxImportResult {
  created: number;
  updated: number;
  total: number;
  vendors: string[];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function buildLoginxAggregator(currency: string): LoginxGamesAggregator {
  return new LoginxGamesAggregator({
    vendors: loginxVendorsFromEnv((key) => process.env[key] ?? ""),
    currency,
  });
}

export async function importLoginxCatalog(
  prisma: PrismaClient,
  adapter: LoginxGamesAggregator,
  currency: string,
): Promise<LoginxImportResult> {
  const games = await adapter.listGames();
  const category = await prisma.gameCategoryModel.findUnique({ where: { slug: "SLOTS" } });

  let created = 0;
  let updated = 0;

  for (const game of games) {
    // One provider row per vendor, prefixed so the panel and the home page can
    // select this whole API with a single prefix filter.
    const providerSlug = `loginx-${slugify(game.provider)}`;
    const provider = await prisma.gameProviderModel.upsert({
      where: { slug: providerSlug },
      create: { slug: providerSlug, name: game.provider, type: "EXTERNAL" },
      update: { name: game.provider },
    });

    const slug = `${providerSlug}-${slugify(game.name)}-${game.externalId}`.slice(0, 80);
    const data = {
      name: game.name,
      thumbnailUrl: game.thumbnailUrl,
      categoryId: category?.id,
      providerId: provider.id,
      providerGameId: game.externalId,
      embedType: "EXTERNAL" as const,
      config: { source: "loginx" },
      rtp: 96,
      volatility: "MEDIUM" as const,
      minBet: game.minBet !== undefined ? BigInt(Math.round(Number(game.minBet) * 100)) : 1_00n,
      maxBet: 10_000_000_00n,
      isActive: false,
      demoEnabled: false,
      realEnabled: false,
      tags: game.tags ?? [],
      supportedCurrencies: game.currencies ?? [currency],
      releasedAt: game.releasedAt ? new Date(game.releasedAt) : undefined,
    };

    const existing = await prisma.game.findUnique({ where: { slug }, select: { id: true } });
    if (existing) {
      await prisma.game.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.game.create({ data: { slug, ...data } });
      created++;
    }
  }

  return {
    created,
    updated,
    total: games.length,
    vendors: adapter.vendors.map((vendor) => vendor.vendor),
  };
}
