/**
 * Imports the loginxgamesapi / GitSlotPark catalogue into our game tables.
 *
 * Run with: npm run sync:loginx --workspace @aurora/engine
 *
 * Reads the four vendor catalogues through the LoginxGamesAggregator and stores
 * every game as INACTIVE. Launch (userAuth) and the five wallet callbacks are
 * implemented, but a row must not appear in the lobby until the operator has
 * confirmed the vendor credentials — an active row on a half-configured
 * platform fails the moment a player clicks it. Activating from the admin panel
 * is the deliberate go-live step.
 *
 * Idempotent: games are upserted on (provider, providerGameId), so re-running
 * refreshes metadata without touching player data, favourites or bets.
 *
 * Detail on the API and its contract: docs/providers/loginx-games-api.md
 */
import { PrismaClient } from "@prisma/client";
import { env } from "../src/lib/env.js";
import { buildLoginxAggregator, importLoginxCatalog } from "../src/services/loginx-catalog.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const adapter = buildLoginxAggregator(env.loginx.currency);

  if (!adapter.isConfigured) {
    throw new Error(
      "loginx vendor kimligi yok. Admin > Entegrasyon ekranindan LOGINX_*_APITOKEN degerlerini girin " +
        "veya .env dosyasina ekleyin.",
    );
  }

  const health = await adapter.healthCheck();
  console.log(`Saglayici: ${health.provider} (${health.mode}) reachable=${health.reachable}`);
  console.log(`  ${health.detail}`);

  const result = await importLoginxCatalog(prisma, adapter, env.loginx.currency);
  console.log(`Toplam ${result.total} oyun okundu (${result.vendors.join(", ")}).`);
  console.log(`Ice aktarildi: ${result.created} yeni, ${result.updated} guncellenen.`);
  console.log("Tum satirlar PASIF (isActive=false): launch ucu gelene kadar yayinlanmaz.");
}

main()
  .catch((error) => {
    console.error("sync:loginx basarisiz:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
