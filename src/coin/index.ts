import type { Coin } from "./types.js";
import { coins } from "./constants.js";
import { getAllCoinsForOwner } from "../common/blockchain.js";

export * from "./types.js";
export * from "./constants.js";

/**
 * List every Coin owned by `owner` that has a known entry in this SDK's
 * coin constants table.
 *
 * Note: pre-migration this function had a bug — it accumulated coin
 * type strings into a local `coinTypes[]` variable but never populated
 * the returned `coins[]` array, so callers always got `[]`. The
 * GraphQL migration fixed that as a drive-by.
 */
export async function getWalletCoins(owner: string): Promise<Coin[]> {
  const out: Coin[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const page = await getAllCoinsForOwner(owner, cursor);
    for (const c of page.data) {
      if (seen.has(c.coinType)) continue;
      seen.add(c.coinType);
      const known = (Object.values(coins) as Coin[]).find(
        (k) => k.type.toLowerCase() === c.coinType.toLowerCase(),
      );
      if (known) {
        out.push(known);
      }
    }
    if (page.hasNextPage && page.nextCursor) {
      cursor = page.nextCursor;
    } else {
      hasMore = false;
    }
  }
  return out;
}
