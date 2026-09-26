import { prisma } from "@aurora/db";
import {
  BonusStatus,
  Errors,
  LedgerAccountType,
  LedgerDirection,
  TxType,
  WalletType,
  applyMultiplier,
  fromMinor,
  percentOf,
} from "@aurora/shared";
import { ledger } from "./ledger.js";
import { audit } from "./audit.js";
import { AuditAction } from "@aurora/shared";

export interface GrantBonusInput {
  userId: string;
  code: string;
  depositAmount: bigint;
  currency: string;
  triggerTxId?: string;
  actorId?: string;
}

/**
 * Bonus lifecycle: eligibility -> grant -> wagering -> completion or forfeit.
 *
 * A granted bonus is credited to the BONUS wallet and simultaneously creates a
 * wagering requirement expressed in minor units. Every real-money bet on a
 * contributing game reduces the requirement; once it reaches zero the remaining
 * bonus balance is released to the real wallet. Expiry is enforced by a
 * scheduled job that forfeits lapsed bonuses.
 */
export class BonusService {
  /** Evaluate every active, auto-apply bonus and grant the best eligible one. */
  async autoApplyDepositBonus(params: { userId: string; depositAmount: bigint; currency: string; triggerTxId?: string }) {
    const candidates = await prisma.bonus.findMany({
      where: {
        status: "ACTIVE",
        isAutoApply: true,
        type: { in: ["WELCOME", "DEPOSIT_MATCH", "RELOAD"] },
        currency: params.currency,
        OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
      },
      orderBy: { percent: "desc" },
    });

    for (const bonus of candidates) {
      const eligible = await this.checkEligibility(bonus.id, params.userId, params.depositAmount);
      if (eligible.ok) {
        return this.grant({ ...params, code: bonus.code });
      }
    }
    return null;
  }

  async grantByCode(input: GrantBonusInput) {
    const bonus = await prisma.bonus.findUnique({ where: { code: input.code.toUpperCase() } });
    if (!bonus) throw Errors.validation("Bonus kodu bulunamadi");

    const eligible = await this.checkEligibility(bonus.id, input.userId, input.depositAmount);
    if (!eligible.ok) throw Errors.validation(eligible.reason ?? "Bu bonus icin uygun degilsiniz");

    return this.grant(input);
  }

  async checkEligibility(
    bonusId: string,
    userId: string,
    depositAmount: bigint,
  ): Promise<{ ok: boolean; reason?: string }> {
    const bonus = await prisma.bonus.findUnique({ where: { id: bonusId } });
    if (!bonus) return { ok: false, reason: "Bonus bulunamadi" };
    if (bonus.status !== "ACTIVE") return { ok: false, reason: "Bonus aktif degil" };

    const now = new Date();
    if (bonus.validFrom && bonus.validFrom > now) return { ok: false, reason: "Bonus henuz baslamadi" };
    if (bonus.validUntil && bonus.validUntil < now) return { ok: false, reason: "Bonusun suresi doldu" };
    if (bonus.minDeposit && depositAmount < bonus.minDeposit) {
      return { ok: false, reason: `Minimum yatirim ${fromMinor(bonus.minDeposit, bonus.currency as never)}` };
    }
    if (bonus.totalBudget && bonus.usedBudget >= bonus.totalBudget) {
      return { ok: false, reason: "Bonus butcesi tukendi" };
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { kyc: true, vip: true, _count: { select: { transactions: true } } } });
    if (!user) return { ok: false, reason: "Kullanici bulunamadi" };

    if (bonus.newPlayersOnly) {
      const priorDeposits = await prisma.paymentIntent.count({
        where: { userId, direction: "DEPOSIT", status: "COMPLETED" },
      });
      // The current deposit is already recorded, so a new player has exactly one.
      if (priorDeposits > 1) return { ok: false, reason: "Bu bonus sadece yeni oyuncular icin" };
    }

    if (bonus.minKycLevel > 0 && (user.kyc?.level ?? 0) < bonus.minKycLevel) {
      return { ok: false, reason: "KYC seviyeniz yetersiz" };
    }

    if (bonus.vipTiers.length > 0 && !bonus.vipTiers.includes(user.vip?.tier ?? "BRONZE")) {
      return { ok: false, reason: "VIP seviyeniz bu bonus icin uygun degil" };
    }

    const used = await prisma.userBonus.count({ where: { userId, bonusId, status: { not: "CANCELLED" } } });
    if (used >= bonus.perUserLimit) return { ok: false, reason: "Bu bonustan zaten yararlandiniz" };

    if (!bonus.isStackable) {
      const active = await prisma.userBonus.count({
        where: { userId, status: "ACTIVE", wageringRemaining: { gt: 0n } },
      });
      if (active > 0) return { ok: false, reason: "Aktif bonusunuz varken yeni bonus alamazsiniz" };
    }

    return { ok: true };
  }

  async grant(input: GrantBonusInput) {
    const bonus = await prisma.bonus.findUnique({ where: { code: input.code.toUpperCase() } });
    if (!bonus) throw Errors.validation("Bonus kodu bulunamadi");

    let grantAmount = 0n;
    if (bonus.fixedAmount) grantAmount = bonus.fixedAmount;
    if (bonus.percent) {
      const matched = percentOf(input.depositAmount, bonus.percent.toString(), bonus.currency as never);
      grantAmount = grantAmount > 0n ? grantAmount + matched : matched;
    }
    if (bonus.maxBonus && grantAmount > bonus.maxBonus) grantAmount = bonus.maxBonus;
    if (grantAmount <= 0n) throw Errors.validation("Bonus tutari hesaplanamadi");

    const wageringRequired = applyMultiplier(grantAmount, bonus.wageringMultiplier.toString(), bonus.currency as never);

    const result = await prisma.$transaction(async (tx) => {
      const userBonus = await tx.userBonus.create({
        data: {
          userId: input.userId,
          bonusId: bonus.id,
          status: "ACTIVE",
          currency: bonus.currency,
          grantedAmount: grantAmount,
          remainingAmount: grantAmount,
          wageringRequired,
          wageringProgress: 0n,
          wageringRemaining: wageringRequired,
          maxWin: bonus.maxBonus ? bonus.maxBonus * 10n : null,
          maxBet: bonus.maxBetWithBonus,
          expiresAt: bonus.validUntil ?? new Date(Date.now() + 30 * 24 * 3600 * 1000),
          triggerTxId: input.triggerTxId,
          freeSpinsLeft: bonus.type === "FREE_SPINS" ? 50 : 0,
          freeSpinValue: bonus.type === "FREE_SPINS" ? 100n : null,
          freeSpinGameId: bonus.gameId,
        },
      });

      await tx.bonus.update({
        where: { id: bonus.id },
        data: { usedBudget: { increment: grantAmount } },
      });

      await tx.bonusHistory.create({
        data: {
          userId: input.userId,
          bonusId: bonus.id,
          userBonusId: userBonus.id,
          action: "GRANTED",
          amount: grantAmount,
          detail: `${bonus.name} verildi`,
        },
      });

      return userBonus;
    });

    // Credit the bonus wallet through the ledger so it is auditable.
    await ledger.post({
      userId: input.userId,
      type: TxType.BONUS_CREDIT,
      amount: grantAmount,
      currency: bonus.currency,
      walletType: WalletType.BONUS,
      legs: [
        { accountType: LedgerAccountType.PLAYER_BONUS, direction: LedgerDirection.CREDIT, amount: grantAmount },
        { accountType: LedgerAccountType.BONUS_POOL, direction: LedgerDirection.DEBIT, amount: grantAmount },
      ],
      relatedBonusId: result.id,
      description: `${bonus.name} bonusu`,
      metadata: { bonusCode: bonus.code, wageringRequired: wageringRequired.toString() },
    });

    await audit.log({
      action: AuditAction.BONUS_CREATED,
      entityType: "UserBonus",
      entityId: result.id,
      after: { userId: input.userId, code: bonus.code, amount: fromMinor(grantAmount, bonus.currency as never) },
    });

    return {
      id: result.id,
      code: bonus.code,
      amount: fromMinor(grantAmount, bonus.currency as never),
      currency: bonus.currency,
      wageringRequired: fromMinor(wageringRequired, bonus.currency as never),
      expiresAt: result.expiresAt,
    };
  }

  /**
   * Apply a settled bet against any active bonus. Contribution depends on the
   * game/category rates configured on the bonus; excluded games contribute zero.
   */
  async applyWagering(params: {
    userId: string;
    gameSlug: string;
    categorySlug: string;
    stake: bigint;
    currency: string;
    betId: string;
  }) {
    const activeBonuses = await prisma.userBonus.findMany({
      where: { userId: params.userId, status: "ACTIVE", wageringRemaining: { gt: 0n }, currency: params.currency },
      include: { bonus: true },
    });
    if (activeBonuses.length === 0) return null;

    for (const userBonus of activeBonuses) {
      const bonus = userBonus.bonus;
      if (bonus.excludedGames.includes(params.gameSlug)) continue;
      if (bonus.allowedGames.length > 0 && !bonus.allowedGames.includes(params.gameSlug)) continue;
      if (bonus.allowedCategories.length > 0 && !bonus.allowedCategories.includes(params.categorySlug)) continue;

      const rates = (bonus.contributionRates ?? {}) as Record<string, number>;
      const rate = rates[params.categorySlug] ?? rates[params.gameSlug] ?? rates.default ?? 100;
      if (rate <= 0) continue;

      const contribution = percentOf(params.stake, rate, params.currency as never);
      const remaining = userBonus.wageringRemaining - contribution;
      const progress = userBonus.wageringProgress + contribution;
      const completed = remaining <= 0n;

      await prisma.$transaction(async (tx) => {
        await tx.userBonus.update({
          where: { id: userBonus.id },
          data: {
            wageringProgress: progress,
            wageringRemaining: remaining < 0n ? 0n : remaining,
            status: completed ? "COMPLETED" : "ACTIVE",
            completedAt: completed ? new Date() : null,
          },
        });
        await tx.bonusHistory.create({
          data: {
            userId: params.userId,
            bonusId: bonus.id,
            userBonusId: userBonus.id,
            action: "WAGERED",
            wageringDelta: contribution,
            detail: `${params.gameSlug} katki %${rate}`,
          },
        });
      });

      if (completed) {
        await this.releaseBonus(userBonus.id).catch((error) =>
          console.error("[bonus] serbest birakma hatasi", error),
        );
      }
    }
    return true;
  }

  /** Move the remaining bonus balance into the real wallet on completion. */
  async releaseBonus(userBonusId: string) {
    const userBonus = await prisma.userBonus.findUnique({ where: { id: userBonusId }, include: { bonus: true } });
    if (!userBonus || userBonus.status !== "COMPLETED") return;
    if (userBonus.remainingAmount <= 0n) return;

    const released = userBonus.maxWin && userBonus.remainingAmount > userBonus.maxWin ? userBonus.maxWin : userBonus.remainingAmount;

    // Debit the bonus wallet, credit the real wallet: one balanced transaction.
    await ledger.post({
      userId: userBonus.userId,
      type: TxType.BONUS_CREDIT,
      amount: released,
      currency: userBonus.currency,
      walletType: WalletType.BONUS,
      legs: [
        { accountType: LedgerAccountType.PLAYER_BONUS, direction: LedgerDirection.DEBIT, amount: released },
        { accountType: LedgerAccountType.BONUS_POOL, direction: LedgerDirection.CREDIT, amount: released },
      ],
      relatedBonusId: userBonus.id,
      description: "Bonus tamamlandi, bonus bakiyesi dusuldu",
    });

    await ledger.post({
      userId: userBonus.userId,
      type: TxType.WIN,
      amount: released,
      currency: userBonus.currency,
      walletType: WalletType.REAL,
      legs: [
        { accountType: LedgerAccountType.PLAYER_REAL, direction: LedgerDirection.CREDIT, amount: released },
        { accountType: LedgerAccountType.BONUS_POOL, direction: LedgerDirection.DEBIT, amount: released },
      ],
      relatedBonusId: userBonus.id,
      description: "Bonus kazanci gercek bakiyeye aktarildi",
    });

    await prisma.$transaction(async (tx) => {
      await tx.userBonus.update({
        where: { id: userBonus.id },
        data: { remainingAmount: 0n, status: "COMPLETED" },
      });
      await tx.bonusHistory.create({
        data: {
          userId: userBonus.userId,
          bonusId: userBonus.bonusId,
          userBonusId: userBonus.id,
          action: "RELEASED",
          amount: released,
          detail: "Bonus bakiyesi gercek bakiyeye aktarildi",
        },
      });
    });

    return { released: fromMinor(released, userBonus.currency as never) };
  }

  /** Forfeit a lapsed bonus and pull the remaining bonus balance. */
  async expireBonus(userBonusId: string, reason = "SURE_DOLDU") {
    const userBonus = await prisma.userBonus.findUnique({ where: { id: userBonusId } });
    if (!userBonus || userBonus.status !== "ACTIVE") return;

    if (userBonus.remainingAmount > 0n) {
      await ledger.post({
        userId: userBonus.userId,
        type: TxType.BONUS_FORFEIT,
        amount: userBonus.remainingAmount,
        currency: userBonus.currency,
        walletType: WalletType.BONUS,
        legs: [
          { accountType: LedgerAccountType.PLAYER_BONUS, direction: LedgerDirection.DEBIT, amount: userBonus.remainingAmount },
          { accountType: LedgerAccountType.BONUS_POOL, direction: LedgerDirection.CREDIT, amount: userBonus.remainingAmount },
        ],
        relatedBonusId: userBonus.id,
        description: `Bonus iptal: ${reason}`,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.userBonus.update({
        where: { id: userBonus.id },
        data: { status: "EXPIRED", remainingAmount: 0n, forfeitedAt: new Date(), forfeitReason: reason },
      });
      await tx.bonusHistory.create({
        data: {
          userId: userBonus.userId,
          bonusId: userBonus.bonusId,
          userBonusId: userBonus.id,
          action: "EXPIRED",
          amount: userBonus.remainingAmount,
          detail: reason,
        },
      });
    });
  }

  async listUserBonuses(userId: string) {
    const rows = await prisma.userBonus.findMany({
      where: { userId },
      include: { bonus: { select: { name: true, code: true, type: true, description: true } } },
      orderBy: { activatedAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.bonus.name,
      code: row.bonus.code,
      type: row.bonus.type,
      status: row.status,
      amount: fromMinor(row.grantedAmount, row.currency as never),
      remaining: fromMinor(row.remainingAmount, row.currency as never),
      wageringRequired: fromMinor(row.wageringRequired, row.currency as never),
      wageringProgress: fromMinor(row.wageringProgress, row.currency as never),
      wageringRemaining: fromMinor(row.wageringRemaining, row.currency as never),
      progressPercent: row.wageringRequired > 0n
        ? Math.min(100, Number((row.wageringProgress * 100n) / row.wageringRequired))
        : 100,
      currency: row.currency,
      expiresAt: row.expiresAt,
      freeSpinsLeft: row.freeSpinsLeft,
    }));
  }

  /** Public catalogue for the promotions page. */
  async listAvailable(userId?: string, currency = "TRY") {
    const now = new Date();
    const rows = await prisma.bonus.findMany({
      where: {
        status: "ACTIVE",
        displayOnHome: true,
        currency,
        OR: [{ validUntil: null }, { validUntil: { gte: now } }],
        AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: now } }] }],
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    const claimed = userId
      ? new Set(
          (
            await prisma.userBonus.findMany({ where: { userId, status: { not: "CANCELLED" } }, select: { bonusId: true } })
          ).map((r) => r.bonusId),
        )
      : new Set<string>();

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      description: row.description,
      percent: row.percent?.toString() ?? null,
      fixedAmount: row.fixedAmount ? fromMinor(row.fixedAmount, row.currency as never) : null,
      maxBonus: row.maxBonus ? fromMinor(row.maxBonus, row.currency as never) : null,
      minDeposit: row.minDeposit ? fromMinor(row.minDeposit, row.currency as never) : null,
      wageringMultiplier: row.wageringMultiplier.toString(),
      terms: row.terms,
      bannerUrl: row.bannerUrl,
      validUntil: row.validUntil,
      claimed: claimed.has(row.id),
    }));
  }
}

export const bonusService = new BonusService();
export { BonusStatus };
