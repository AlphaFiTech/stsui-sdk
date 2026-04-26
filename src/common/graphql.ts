/**
 * GraphQL client singleton for stsui-sdk.
 *
 * Mirrors the lazy-init / replaceable-singleton pattern of the legacy
 * SuiClient singleton in `client.ts`. All internal SDK reads route
 * through this. Public API consumers can override the URL via
 * `setGraphQLUrl()` if they want to point at a custom endpoint.
 */

import { SuiGraphQLClient } from "@mysten/sui/graphql";

const DEFAULT_GRAPHQL_URL = "https://graphql.mainnet.sui.io/graphql";

let graphqlClientInstance: SuiGraphQLClient | undefined = undefined;
let graphqlUrl: string | undefined = undefined;

/** Get the current GraphQL URL (defaults to mainnet). */
export function getGraphQLUrl(): string {
  return graphqlUrl ?? DEFAULT_GRAPHQL_URL;
}

/**
 * Get the SuiGraphQLClient singleton. If `url` is provided and differs
 * from the current URL, the singleton is replaced.
 */
export function getGraphQLClient(url?: string): SuiGraphQLClient {
  if (url && url !== graphqlUrl) {
    setGraphQLUrl(url);
  }
  if (!graphqlClientInstance) {
    graphqlClientInstance = new SuiGraphQLClient({
      url: getGraphQLUrl(),
    });
  }
  return graphqlClientInstance;
}

/** Replace the GraphQL URL and invalidate the singleton. */
export function setGraphQLUrl(url: string) {
  if (graphqlUrl !== url) {
    graphqlUrl = url;
    graphqlClientInstance = undefined;
  }
}
