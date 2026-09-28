/**
 * Imports the loginxgamesapi catalogue into our game tables.
 *
 * Run with: npm run sync:loginx --workspace @aurora/engine
 *
 * Reads the four vendor catalogues through the LoginxGamesAggregator and stores
 * every game as INACTIVE. That is deliberate: the vendor has not exposed a
 * launch endpoint, so a published row would show up in the lobby and fail the
 * moment a player clicked it. Storing them inactive lets the content be
 * reviewed and edited from the admin panel while the launch call is still being
 * negotiated, and a later sync flips them on with no code change.
 *
 * Idempotent: games are upserted on (provider, providerGameId), so re-running
 * refreshes metadata without touching player data, favourites or bets.
 *
 * Detail on the API and its current limits: docs/providers/loginx-games-api.md
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
