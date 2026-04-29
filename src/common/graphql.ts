/**
 * GraphQL client singleton for stsui-sdk.
 *
 * Mirrors the lazy-init / replaceable-singleton pattern of the legacy
 * SuiClient singleton in `client.ts`. All internal SDK reads route
 * through this. Public API consumers can override the URL via
 * `setGraphQLUrl()` if they want to point at a custom endpoint.
 */

import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { getConfEnv } from "./ids.js";

const GRAPHQL_URLS = {
  production: "https://graphql.mainnet.sui.io/graphql",
  testing: "https://graphql.testnet.sui.io/graphql",
} as const;

let graphqlClientInstance: SuiGraphQLClient | undefined = undefined;
let graphqlUrl: string | undefined = undefined;
let activeClientUrl: string | undefined = undefined;

function getDefaultGraphQLUrl(): string {
  return GRAPHQL_URLS[getConfEnv()];
}

/** Get the current GraphQL URL (defaults to active conf network). */
export function getGraphQLUrl(): string {
  return graphqlUrl ?? getDefaultGraphQLUrl();
}

/**
 * Get the SuiGraphQLClient singleton. If `url` is provided and differs
 * from the current URL, the singleton is replaced.
 */
export function getGraphQLClient(url?: string): SuiGraphQLClient {
  if (url && url !== graphqlUrl) {
    setGraphQLUrl(url);
  }

  const resolvedUrl = getGraphQLUrl();
  if (!graphqlClientInstance || activeClientUrl !== resolvedUrl) {
    graphqlClientInstance = new SuiGraphQLClient({
      url: resolvedUrl,
    });
    activeClientUrl = resolvedUrl;
  }
  return graphqlClientInstance;
}

/** Replace the GraphQL URL and invalidate the singleton. */
export function setGraphQLUrl(url: string) {
  if (graphqlUrl !== url) {
    graphqlUrl = url;
    graphqlClientInstance = undefined;
    activeClientUrl = undefined;
  }
}
