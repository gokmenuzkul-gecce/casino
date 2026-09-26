import { SeedPair } from "@aurora/shared";
import { GameDefinition, GameOutcome, round4 } from "../types.js";
import { FairRandom } from "../random.js";

export interface BlackjackParams {
  /** Player action sequence, e.g. ["HIT","HIT","STAND"]. */
  actions: ("HIT" | "STAND" | "DOUBLE" | "SPLIT")[];
}

type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["S", "H", "D", "C"] as const;

export interface Card {
  rank: Rank;
  suit: (typeof SUITS)[number];
}

function handValue(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === "A") {
      aces++;
      total += 11;
    } else if (["J", "Q", "K"].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

/**
 * Blackjack with a 6-deck shoe shuffled from the provably-fair seed. Dealer
 * stands on soft 17. Natural blackjack pays 3:2, a win pays 1:1, a push
 * returns the stake (multiplier 1). The 0.5% house edge is inherent to the
 * rule set, so no extra margin is applied.
 */
export const blackjack: GameDefinition<BlackjackParams> = {
  slug: "blackjack",
  name: "Blackjack",
  houseEdgePercent: 0.5,

  parseParams(raw) {
    const actionsRaw = raw.actions;
    if (!Array.isArray(actionsRaw)) throw new Error("'actions' bir dizi olmali");
    const allowed = ["HIT", "STAND", "DOUBLE", "SPLIT"];
    const actions = actionsRaw.map((a) => {
      const value = String(a).toUpperCase();
      if (!allowed.includes(value)) throw new Error(`Gecersiz aksiyon: ${a}`);
      return value as BlackjackParams["actions"][number];
    });
    if (actions.length > 20) throw new Error("Cok fazla aksiyon");
    return { actions };
  },

  validateStake() {
    /* global bounds */
  },

  resolve(seed, _stake, params) {
    const rng = new FairRandom(seed);
    const shoe: Card[] = [];
    for (let deck = 0; deck < 6; deck++) {
      for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit });
    }
    rng.shuffle(shoe);

    let cursor = 0;
    const draw = (): Card => shoe[cursor++]!;

    const player: Card[] = [draw(), draw()];
    const dealer: Card[] = [draw(), draw()];

    let doubled = false;
    let busted = false;

    if (isBlackjack(player)) {
      const dealerBJ = isBlackjack(dealer);
      const multiplier = dealerBJ ? "1.0000" : "2.5000";
      return {
        multiplier,
        detail: { player, dealer, playerValue: 21, dealerValue: handValue(dealer), natural: true, push: dealerBJ },
      } satisfies GameOutcome;
    }

    for (const action of params.actions) {
      const value = handValue(player);
      if (value >= 21) break;
      if (action === "HIT") {
        player.push(draw());
        if (handValue(player) > 21) {
          busted = true;
          break;
        }
      } else if (action === "DOUBLE") {
        player.push(draw());
        doubled = true;
        break;
      } else if (action === "STAND") {
        break;
      }
      // SPLIT is resolved as a simple hit in this simplified ruleset.
    }

    if (busted || handValue(player) > 21) {
      return {
        multiplier: "0.0000",
        detail: { player, dealer, playerValue: handValue(player), dealerValue: handValue(dealer), busted: true, doubled },
      } satisfies GameOutcome;
    }

    while (handValue(dealer) < 17) dealer.push(draw());

    const pv = handValue(player);
    const dv = handValue(dealer);
    let multiplier = 1;
    if (dv > 21 || pv > dv) multiplier = doubled ? 4 : 2;
    else if (pv < dv) multiplier = 0;

    return {
      multiplier: round4(multiplier),
      detail: {
        player,
        dealer,
        playerValue: pv,
        dealerValue: dv,
        busted: false,
        doubled,
        push: pv === dv && dv <= 21,
        dealerBusted: dv > 21,
      },
    } satisfies GameOutcome;
  },
};

export function blackjackHandValue(cards: Card[]): number {
  return handValue(cards);
}
