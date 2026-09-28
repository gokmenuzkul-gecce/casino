/**
 * Imports the loginxgamesapi (GitSlotPark) catalogue into the game tables.
 *
 * Shared by the `sync:loginx` script and the admin panel button so both behave
 * identically.
 *
 * Rows are written INACTIVE on purpose. Launch and the wallet callbacks are
 * implemented, but a game still must not appear in the lobby until the operator
 * has confirmed the vendor credentials and taken the platform live — an active
 * row on a half-configured platform fails the moment a player clicks it.
 * Activating from the admin panel is the deliberate go-live step.
 *
 * The import is idempotent — keyed on the deterministic slug — so re-running
 * refreshes metadata and never touches player data, favourites or bets.
 *
 * See docs/providers/loginx-games-api.md for the contract.
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
      // The launch call needs to know which vendor host to authenticate against.
      config: { source: "loginx", launchRouter: game.launchRouter },
      rtp: 96,
      volatility: "MEDIUM" as const,
      minBet: game.minBet !== undefined ? BigInt(Math.round(Number(game.minBet) * 100)) : 1_00n,
      maxBet: 10_000_000_00n,
      isActive: false,
      demoEnabled: false,
      realEnabled: true,
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
