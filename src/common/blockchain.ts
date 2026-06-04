/**
 * GraphQL read primitives for stsui-sdk.
 *
 * Free functions that wrap SuiGraphQLClient queries and return shapes
 * compatible with the legacy JSON-RPC equivalents. Internal SDK code in
 * `utils.ts`, `events.ts`, `balance.ts`, `coin/index.ts`, and
 * `stSui/redeem.ts` calls into these helpers instead of `SuiClient`.
 */

import type { CoinStruct, PaginatedCoins, SuiEvent } from "@mysten/sui/jsonRpc";
import { getGraphQLClient } from "./graphql.js";

// ---------------------------------------------------------------------------
// Shared response shapes (only the fields we read from each query). The
// SuiGraphQLClient query method is generic so each helper supplies its
// own typed Result.
// ---------------------------------------------------------------------------

type CoinBalance = {
  coinType: string;
  coinObjectCount: number;
  totalBalance: string;
  lockedBalance: Record<string, string>;
};

interface GqlConnection<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

// ---------------------------------------------------------------------------
// Cat 1: Object reads — flat shape (drop JSON-RPC `{type, fields}` wrap).
// ---------------------------------------------------------------------------

/** Flat object shape — GraphQL-native, no nested `{type, fields}` wrap. */
export interface FlatObject<T = Record<string, unknown>> {
  objectId: string;
  version: string;
  digest: string;
  type: string;
  fields: T;
}

/**
 * Fetch a single object's flat fields by id.
 *
 * Returns `undefined` if the object doesn't exist or isn't a Move object.
 */
export async function getObjectFlat<T = Record<string, unknown>>(
  id: string,
): Promise<FlatObject<T> | undefined> {
  const client = getGraphQLClient();
  const res = await client.query<{
    object: {
      address: string;
      version: number | string;
      digest: string;
      asMoveObject: {
        contents: { type: { repr: string }; json: unknown };
      } | null;
    } | null;
  }>({
    query: /* GraphQL */ `
      query getObjectFlat($id: SuiAddress!) {
        object(address: $id) {
          address
          version
          digest
          asMoveObject {
            contents {
              type {
                repr
              }
              json
            }
          }
        }
      }
    `,
    variables: { id },
  });

  const obj = res.data?.object;
  if (!obj || !obj.asMoveObject) return undefined;
  return {
    objectId: obj.address,
    version: String(obj.version),
    digest: obj.digest,
    type: obj.asMoveObject.contents.type.repr,
    fields: obj.asMoveObject.contents.json as T,
  };
}

/**
 * Fetch many objects' flat fields by id. Preserves the order of input ids;
 * objects that don't exist or aren't Move objects appear as `null`.
 */
export async function multiGetObjectsGraphql(
  ids: string[],
): Promise<(FlatObject | null)[]> {
  if (ids.length === 0) return [];
  const client = getGraphQLClient();
  const res = await client.query<{
    multiGetObjects: Array<{
      address: string;
      version: number | string;
      digest: string;
      asMoveObject: {
        contents: { type: { repr: string }; json: unknown };
      } | null;
    } | null>;
  }>({
    query: /* GraphQL */ `
      query multiGetObjectsGraphql($keys: [ObjectKey!]!) {
        multiGetObjects(keys: $keys) {
          address
          version
          digest
          asMoveObject {
            contents {
              type {
                repr
              }
              json
            }
          }
        }
      }
    `,
    variables: { keys: ids.map((id) => ({ address: id })) },
  });

  // multiGetObjects preserves input order with nulls for missing.
  return (res.data?.multiGetObjects ?? []).map((node) => {
    if (!node || !node.asMoveObject) return null;
    return {
      objectId: node.address,
      version: String(node.version),
      digest: node.digest,
      type: node.asMoveObject.contents.type.repr,
      fields: node.asMoveObject.contents.json as Record<string, unknown>,
    };
  });
}

// ---------------------------------------------------------------------------
// Cat 3: Balances — direct field rename.
// ---------------------------------------------------------------------------

/**
 * Get all coin balances for an address (one row per coin type).
 */
export async function getAllBalancesForOwner(
  owner: string,
): Promise<CoinBalance[]> {
  const client = getGraphQLClient();
  const out: CoinBalance[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const variables: { owner: string; cursor: string | null } = {
      owner,
      cursor,
    };
    const res = await client.query<{
      address: {
        balances: GqlConnection<{
          coinType: { repr: string };
          coinObjectCount: number;
          totalBalance: string | null;
        }>;
      } | null;
    }>({
      query: /* GraphQL */ `
        query getAllBalances($owner: SuiAddress!, $cursor: String) {
          address(address: $owner) {
            balances(after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                coinType {
                  repr
                }
                coinObjectCount
                totalBalance
              }
            }
          }
        }
      `,
      variables,
    });
    const conn = res.data?.address?.balances;
    for (const node of conn?.nodes ?? []) {
      out.push({
        coinType: node.coinType.repr,
        coinObjectCount: node.coinObjectCount,
        totalBalance: node.totalBalance ?? "0",
        // GraphQL doesn't expose lockedBalance; preserve the JSON-RPC
        // shape with an empty record.
        lockedBalance: {},
      });
    }
    if (conn?.pageInfo?.hasNextPage && conn.pageInfo.endCursor) {
      cursor = conn.pageInfo.endCursor;
    } else {
      hasMore = false;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cat 4: Coins — reconstruct CoinStruct from `0x2::coin::Coin<T>` objects.
// ---------------------------------------------------------------------------

interface RawCoinNode {
  address: string;
  version: number | string;
  digest: string;
  contents: { type: { repr: string }; json: unknown };
  previousTransaction: { digest: string } | null;
}

function buildCoinStruct(
  node: RawCoinNode,
  fallbackCoinType?: string,
): CoinStruct {
  const json = (node.contents.json ?? {}) as { balance?: string };
  // Move type "0x2::coin::Coin<INNER>" — extract INNER for `coinType`.
  let coinType = fallbackCoinType ?? "";
  if (!coinType) {
    const t = node.contents.type.repr;
    const open = t.indexOf("<");
    const close = t.lastIndexOf(">");
    if (open >= 0 && close > open) {
      coinType = t.slice(open + 1, close);
    } else {
      coinType = t;
    }
  }
  return {
    balance: json.balance ?? "0",
    coinObjectId: node.address,
    coinType,
    digest: node.digest,
    previousTransaction: node.previousTransaction?.digest ?? "",
    version: String(node.version),
  };
}

/**
 * Fetch coins of a specific type owned by an address (one page).
 */
export async function getCoinsOfType(
  owner: string,
  coinType: string,
  cursor: string | null = null,
): Promise<PaginatedCoins> {
  const client = getGraphQLClient();
  const wrapped = `0x2::coin::Coin<${coinType}>`;
  const res = await client.query<{
    address: {
      objects: GqlConnection<RawCoinNode>;
    } | null;
  }>({
    query: /* GraphQL */ `
      query getCoinsOfType(
        $owner: SuiAddress!
        $type: String!
        $cursor: String
      ) {
        address(address: $owner) {
          objects(filter: { type: $type }, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              address
              version
              digest
              contents {
                type {
                  repr
                }
                json
              }
              previousTransaction {
                digest
              }
            }
          }
        }
      }
    `,
    variables: { owner, type: wrapped, cursor },
  });
  const conn = res.data?.address?.objects;
  const data: CoinStruct[] = (conn?.nodes ?? []).map((n) =>
    buildCoinStruct(n, coinType),
  );
  return {
    data,
    hasNextPage: conn?.pageInfo?.hasNextPage ?? false,
    nextCursor: conn?.pageInfo?.endCursor ?? null,
  };
}

/**
 * Fetch ALL coins owned by an address across coin types.
 * (Single page — the legacy `getAllCoins` is also paginated; callers
 * that need full coverage can iterate with `cursor`.)
 */
export async function getAllCoinsForOwner(
  owner: string,
  cursor: string | null = null,
): Promise<PaginatedCoins> {
  const client = getGraphQLClient();
  // Filter by `0x2::coin::Coin` (the prefix without generic args) so we
  // catch every Coin variant in a single query.
  const res = await client.query<{
    address: {
      objects: GqlConnection<RawCoinNode>;
    } | null;
  }>({
    query: /* GraphQL */ `
      query getAllCoins($owner: SuiAddress!, $cursor: String) {
        address(address: $owner) {
          objects(filter: { type: "0x2::coin::Coin" }, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              address
              version
              digest
              contents {
                type {
                  repr
                }
                json
              }
              previousTransaction {
                digest
              }
            }
          }
        }
      }
    `,
    variables: { owner, cursor },
  });
  const conn = res.data?.address?.objects;
  const data: CoinStruct[] = (conn?.nodes ?? []).map((n) => buildCoinStruct(n));
  return {
    data,
    hasNextPage: conn?.pageInfo?.hasNextPage ?? false,
    nextCursor: conn?.pageInfo?.endCursor ?? null,
  };
}

// ---------------------------------------------------------------------------
// Cat 5: Epoch — current epoch as a string.
// ---------------------------------------------------------------------------

/** Get the current epoch number as a string (matches JSON-RPC). */
export async function getCurrentEpoch(): Promise<string> {
  const client = getGraphQLClient();
  const res = await client.query<{
    epoch: { epochId: number | string } | null;
  }>({
    query: /* GraphQL */ `
      query getCurrentEpoch {
        epoch {
          epochId
        }
      }
    `,
    variables: {},
  });
  const id = res.data?.epoch?.epochId;
  if (id === undefined || id === null) {
    throw new Error("epoch.epochId not returned by GraphQL");
  }
  return String(id);
}

// ---------------------------------------------------------------------------
// Cat 2: Events — paginated query by Move event type. Returns a
// PaginatedEvents-shaped result so the existing Events.getEvents loop
// in `events.ts` doesn't need to change.
// ---------------------------------------------------------------------------

export interface PaginatedMoveEvents {
  data: SuiEvent[];
  hasNextPage: boolean;
  nextCursor: string | null;
}

/**
 * Query one page of events filtered by Move event type
 * (e.g. `<pkg>::events::Event<<pkg>::liquid_staking::MintEvent>`).
 *
 * GraphQL cursors are opaque strings, so pagination here stays purely in
 * GraphQL cursor-space instead of trying to map cursors to EventId.
 */
export async function queryMoveEvents(
  eventType: string,
  cursor: string | null = null,
): Promise<PaginatedMoveEvents> {
  const client = getGraphQLClient();

  const res = await client.query<{
    events: {
      pageInfo: { hasPreviousPage: boolean; startCursor: string | null };
      nodes: Array<{
        sender: { address: string } | null;
        timestamp: string | null;
        sequenceNumber: number | string;
        transaction: { digest: string | null } | null;
        contents: { type: { repr: string }; json: unknown };
      }>;
    };
  }>({
    query: /* GraphQL */ `
      query queryMoveEvents($type: String!, $before: String) {
        events(filter: { type: $type }, last: 50, before: $before) {
          pageInfo {
            hasPreviousPage
            startCursor
          }
          nodes {
            sender {
              address
            }
            timestamp
            sequenceNumber
            transaction {
              digest
            }
            contents {
              type {
                repr
              }
              json
            }
          }
        }
      }
    `,
    variables: { type: eventType, before: cursor },
  });
  if (res.errors?.length) {
    throw new Error(
      `queryMoveEvents failed: ${res.errors.map((e) => e.message).join("; ")}`,
    );
  }

  const conn = res.data?.events;
  // Relay backward pagination (`last/before`) typically yields nodes in
  // forward order within each page, so reverse to keep legacy
  // JSON-RPC-compatible descending order (newest first).
  const data: SuiEvent[] = (conn?.nodes ?? [])
    .map((node) => {
      const ts = node.timestamp ? Date.parse(node.timestamp) : NaN;
      const evt = {
        id: {
          txDigest: node.transaction?.digest ?? "",
          eventSeq: String(node.sequenceNumber),
        },
        // packageId/transactionModule aren't used by stsui-sdk consumers,
        // but we fill them best-effort from the type string for shape-parity.
        packageId: node.contents.type.repr.split("::")[0] ?? "",
        transactionModule: node.contents.type.repr.split("::")[1] ?? "",
        sender: node.sender?.address ?? "",
        type: node.contents.type.repr,
        parsedJson: node.contents.json,
        bcs: "",
        bcsEncoding: "base64",
        timestampMs: Number.isFinite(ts) ? String(ts) : null,
      } as SuiEvent;
      return evt;
    })
    .reverse();
  return {
    data,
    hasNextPage: conn?.pageInfo?.hasPreviousPage ?? false,
    nextCursor: conn?.pageInfo?.startCursor ?? null,
  };
}
