// src/sui-sdk/client.ts

/* This file contains the setup for the Sui Client, implemented as a singleton.
 *
 * v0.1.x GraphQL migration: the SDK's internal reads now go through
 * `src/common/graphql.ts` (`getGraphQLClient`). The legacy SuiClient
 * accessors below remain for backward compatibility — most importantly
 * for `Transaction.build()` resolution and for callers that need a
 * SuiClient for their own purposes — but are marked `@deprecated`.
 */

import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { multiGetObjectsFlat, type FlatObject } from "./blockchain.js";

// Lazy initialization for the SuiClient instance
let suiClientInstance: SuiClient | undefined = undefined;
let suiNodeUrl: string | undefined = undefined;

/**
 * Get the current Sui node URL.
 * If no URL has been set, it defaults to the mainnet full node URL.
 *
 * @deprecated The SDK no longer uses JSON-RPC for reads. Use the
 *   GraphQL singleton via `getGraphQLClient()` / `setGraphQLUrl()` for
 *   new code; this accessor is kept for legacy callers.
 */
export function getSuiNodeUrl(): string {
  suiNodeUrl = suiNodeUrl ? suiNodeUrl : getFullnodeUrl("mainnet");
  return suiNodeUrl;
}

/**
 * Get the SuiClient instance.
 * If a new URL has been set via setSuiNodeUrl, it will create a new instance with the updated URL.
 *
 * Still useful internally for `Transaction.build()` and externally for
 * callers that want to sign/execute transactions; the SDK's read paths
 * no longer go through this client.
 */
export function getSuiClient(rpcNodeUrl?: string): SuiClient {
  if (rpcNodeUrl) {
    setSuiNodeUrl(rpcNodeUrl);
  }
  if (!suiClientInstance) {
    const nodeUrl = getSuiNodeUrl();
    suiClientInstance = new SuiClient({
      url: nodeUrl,
    });
  }
  return suiClientInstance;
}

/**
 * Set a new Sui node URL.
 * This will invalidate the current SuiClient instance, ensuring that
 * the next call to getSuiClient returns a new instance with the updated URL.
 *
 * @deprecated GraphQL reads use a separate URL — see `setGraphQLUrl()`.
 *   This setter only affects the legacy SuiClient used for transaction
 *   signing/building.
 *
 * @param rpcNodeUrl - The new RPC URL for the Sui client.
 */
export function setSuiNodeUrl(rpcNodeUrl: string) {
  if (suiNodeUrl !== rpcNodeUrl) {
    suiNodeUrl = rpcNodeUrl;
    suiClientInstance = undefined; // Invalidate the current instance to allow creating a new one
  }
}

/**
 * Set a new SuiClient instance with the specified RPC node URL.
 *
 * @deprecated See `setSuiNodeUrl` — this setter only affects the legacy
 *   SuiClient used for transaction signing/building. Use
 *   `setGraphQLUrl()` for read endpoints.
 */
export function setSuiClient(rpcNodeUrl: string) {
  if (suiNodeUrl !== rpcNodeUrl) {
    suiNodeUrl = rpcNodeUrl;
    suiClientInstance = new SuiClient({
      url: rpcNodeUrl,
    });
  }
}

/**
 * Set a custom SuiClient instance.
 *
 * @deprecated See `setSuiNodeUrl` — only the legacy SuiClient is
 *   replaced. Use `setGraphQLUrl()` to point reads at a custom endpoint.
 */
export const setCustomSuiClient = (suiClient: SuiClient) => {
  suiClientInstance = suiClient;
};

/**
 * Batch fetch flat shapes for the given object ids.
 *
 * v0.1.x note: previously returned `SuiObjectResponse[]` (the JSON-RPC
 * shape). Now returns `(FlatObject | null)[]` — flat fields with
 * `objectId / version / digest / type / fields`. See
 * STSUI_GRAPHQL_MIGRATION.md for the field-by-field mapping.
 *
 * The `options` parameter is preserved for source-compat with the old
 * `MultiGetObjectsParams` signature but is ignored — GraphQL always
 * includes contents.
 */
export async function getMultiObjects(input: {
  ids: string[];
  options?: unknown;
}): Promise<(FlatObject | null)[]> {
  return multiGetObjectsFlat(input.ids);
}
