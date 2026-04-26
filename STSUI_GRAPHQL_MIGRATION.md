# stSUI SDK GraphQL migration

`v0.1.x` of `@alphafi/stsui-sdk` migrates every internal Sui read from
JSON-RPC to GraphQL. The public function/class signatures are unchanged
except for **two breaking type-shape changes** documented below.

## What changed

### Internal: JSON-RPC → GraphQL

The SDK no longer issues `SuiClient.getObject`, `getCoins`,
`getAllCoins`, `getAllBalances`, `queryEvents`, or
`getLatestSuiSystemState` calls. All reads now go through a
`SuiGraphQLClient` singleton in [`src/common/graphql.ts`](src/common/graphql.ts).
Typed read primitives live in [`src/common/blockchain.ts`](src/common/blockchain.ts).

The legacy `SuiClient` accessors (`getSuiClient`, `setSuiNodeUrl`,
`setSuiClient`, `setCustomSuiClient`) are kept for backward compatibility
but marked `@deprecated`. The internal SuiClient is still used for
`Transaction.build()` resolution; consumers can also still grab a
SuiClient if they want to sign/execute transactions themselves.

A new pair of singletons is added for the GraphQL endpoint:

```ts
import { getGraphQLClient, setGraphQLUrl } from "@alphafi/stsui-sdk";
setGraphQLUrl("https://my-graphql-proxy.example.com/graphql");
```

### Breaking: `LiquidStakingInfo` and `Meta` are now flat

The legacy JSON-RPC `getObject({showContent: true})` shape wrapped every
nested Move struct in `{ type, fields }`. The new flat shape drops those
wrappers (and the JSON-RPC `id: { id: string }` UID encoding):

| Old (`v0.0.x`)                                                               | New (`v0.1.x`)                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| `lstInfo.content.fields.storage.fields.total_sui_supply`                     | `lstInfo.fields.storage.total_sui_supply`              |
| `lstInfo.content.fields.lst_treasury_cap.fields.total_supply.fields.value`   | `lstInfo.fields.lst_treasury_cap.total_supply.value`   |
| `lstInfo.content.fields.accrued_spread_fees`                                 | `lstInfo.fields.accrued_spread_fees`                   |
| `lstInfo.content.fields.fee_config.fields.element.fields.<FeeConfig fields>` | `lstInfo.fields.fee_config.element.<FeeConfig fields>` |
| `meta.content.fields.stakers.fields.size`                                    | `meta.fields.stakers.size`                             |
| `meta.content.fields.last_update_event_timestamp`                            | `meta.fields.last_update_event_timestamp`              |

The top-level `objectId / version / digest` fields are unchanged. A new
`type: string` field is exposed at the top level (the Move type that was
previously at `content.type`).

If you imported `LiquidStakingInfo` or `Meta` directly and navigated
those fields, you'll need to drop the `.content` and intermediate
`.fields` segments.

### Breaking: `getMultiObjects` returns flat objects

`getMultiObjects({ ids })` previously returned `SuiObjectResponse[]`
(JSON-RPC shape). It now returns `(FlatObject | null)[]` where
`FlatObject` is `{ objectId, version, digest, type, fields }`. The
`options` parameter is preserved for source compatibility but ignored —
GraphQL always includes contents.

### Fixed: `getWalletCoins` was returning `[]`

The pre-migration implementation of `getWalletCoins(owner)` accumulated
coin types into a local variable but never populated the returned
`coins[]` array — it always returned `[]`. The GraphQL rewrite returns
the actual coin list (one entry per unique coin type owned).

## What didn't change

- `LST.mint / redeem / refresh`, `Admin.createLst / collectFee /
updateFee / setValidators`, `Utils.*`, and all free transaction
  builders take the same arguments and return the same `Transaction`.
- `Events.getMintEvents / getRedeemEvents / getEpochChangeEvents /
getFlashStakeEvents` keep the same parameter and return shapes.
- `getBalances / getAllBalances` keep returning `{ tokenName, balance }[]`.
- `stSuiExchangeRate / stStuiCirculationSupply / fetchTotalSuiStaked /
fetchCurrentStSuiEpoch / fetchStSuiAPR / fetchStSuiAPY /
fetchTotalStakers / getFees` return the same primitive types they did
  before.

## Validation

The migration was validated end-to-end with a snapshot harness
(`scripts/migration-snapshot.ts` + `scripts/migration-diff.ts`). After
classifying noise (accruing chain accumulators, oracle prices, event
timestamps) and the one expected fix (`getWalletCoins`), the diff
between pre- and post-migration captures shows **0 signal differences**
across 42 captures covering every public read and transaction builder.

## Endpoints

The default GraphQL URL is `https://graphql.mainnet.sui.io/graphql`.
Override with `setGraphQLUrl(url)` if you point at a private proxy or a
non-mainnet network.
