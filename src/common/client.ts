// src/common/client.ts

/* Sui client helpers.
 *
 * The SDK's reads go through GraphQL (see `src/common/graphql.ts` and
 * `src/common/blockchain.ts`). The legacy JSON-RPC `SuiClient` singleton and
 * its accessors (`getSuiClient`, `setSuiClient`, `setSuiNodeUrl`,
 * `setCustomSuiClient`, `getSuiNodeUrl`) have been removed — the SDK no longer
 * constructs a JSON-RPC client. `getMultiObjects` now delegates to the
 * GraphQL-native `multiGetObjectsGraphql`.
 */

import { multiGetObjectsGraphql, type FlatObject } from "./blockchain.js";

export { multiGetObjectsGraphql, type FlatObject };

/**
 * Batch-fetch objects by id.
 *
 * @deprecated Prefer `multiGetObjectsGraphql(ids)`. This wrapper delegates to
 *   it (GraphQL) and returns the flat object shape
 *   `{ objectId, version, digest, type, fields }` — not the old JSON-RPC
 *   `SuiObjectResponse` shape.
 */
export function getMultiObjects(input: {
  ids: string[];
}): Promise<(FlatObject | null)[]> {
  return multiGetObjectsGraphql(input.ids);
}
