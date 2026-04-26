/**
 * Migration Snapshot Script (stsui-sdk)
 *
 * Captures the parsed/observable output of every public function in the
 * stSUI SDK, plus a normalized "skeleton" of every transaction builder,
 * into JSON files under `scripts/snapshots/<--out>/`.
 *
 * The script touches ONLY public exports, so the same script runs
 * unchanged on both the pre-migration (JSON-RPC) tree and the migrated
 * (GraphQL) tree.
 *
 * For Cat 1 reads (`getLstInfo`, `getMeta`, `getMultiObjects`) the public
 * return shape changes during the migration (nested `{type, fields}`
 * wrappers go away). To keep the diff focused on real value drift rather
 * than shape change, those captures use focused projection helpers
 * (`extractLstInfo`, `extractMeta`, `extractMultiObject`) that handle
 * BOTH shapes via `??` fallback. Both runs of the snapshot script
 * produce the same canonical JSON regardless of which SDK build is
 * running.
 *
 * Usage:
 *   npx tsx scripts/migration-snapshot.ts --out before
 *   npx tsx scripts/migration-snapshot.ts --out after
 */

import * as fs from "fs";
import * as path from "path";

import { Transaction } from "@mysten/sui/transactions";

import {
  Events,
  Utils,
  LST,
  Admin,
  fetchCurrentStSuiEpoch,
  fetchStSuiAPR,
  fetchStSuiAPY,
  fetchTotalStakers,
  fetchTotalSuiStaked,
  getConf,
  getFees,
  getLstInfo,
  getMeta,
  getMultiObjects,
  stStuiCirculationSupply,
  stSuiExchangeRate,
  // tx builder free functions
  mint,
  redeem,
  refresh,
  create_lst,
  collect_fee,
  updateFee,
  setValidators,
  // balance / coin
  getBalances,
  getAllBalances,
  getWalletCoins,
  // pyth
  getLatestPrices,
  getLatestTokenPricePairs,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TEST_ADDRESS =
  "0xe136f0b6faf27ee707725f38f2aeefc51c6c31cc508222bee5cbc4f5fcf222c3";
const SUI_COIN_TYPE = "0x2::sui::SUI";

// Build-time amounts. Values themselves don't matter for tx skeletons.
const MINT_SUI_AMOUNT = "1000000000"; // 1 SUI
const REDEEM_STSUI_AMOUNT = "100000000";

// Placeholder admin params — not real caps. Used only so the tx builder
// runs to completion. The resulting tx is not executed.
const FAKE_TREASURY_CAP =
  "0x000000000000000000000000000000000000000000000000000000000000aaaa";
const FAKE_ADMIN_CAP =
  "0x000000000000000000000000000000000000000000000000000000000000bbbb";
const FAKE_COLLECTION_FEE_CAP =
  "0x000000000000000000000000000000000000000000000000000000000000cccc";

function parseArgs() {
  const args = process.argv.slice(2);
  let out = "before";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && i + 1 < args.length) {
      out = args[i + 1];
      i++;
    }
  }
  return { out };
}

// ---------------------------------------------------------------------------
// JSON serialization that preserves BigInt and Map.
// ---------------------------------------------------------------------------
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) obj[String(k)] = v;
    return obj;
  }
  return value;
}

function writeSnapshot(dir: string, name: string, data: unknown) {
  const filePath = path.join(dir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, jsonReplacer, 2) + "\n");
  console.log(`  wrote ${filePath}`);
}

// ---------------------------------------------------------------------------
// Bi-shape projections for Cat 1 reads.
// Old (JSON-RPC) shape: lstInfo.content.fields.X.fields.Y
// New (GraphQL flat) shape: lstInfo.fields.X.Y
// Each projection tries the new path first, falls back to the old path.
// ---------------------------------------------------------------------------

interface AnyObj {
  [k: string]: unknown;
}
function asObj(v: unknown): AnyObj | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as AnyObj)
    : undefined;
}

/**
 * Recursively strip the JSON-RPC `{ type: string, fields: object }`
 * wrapping that the legacy `getObject({showContent: true})` API applies
 * to every nested Move struct. The post-migration GraphQL response is
 * flat (no wrapping), so applying this on the BEFORE shape produces the
 * same canonical flat shape.
 *
 * Also unwraps the JSON-RPC `id: { id: address }` UID encoding to a
 * plain `id: address` so the diff doesn't trip on UID fields. (GraphQL
 * also nests UIDs the same way in some responses; if one side stays
 * nested we'd have a diff. Stripping on both inputs keeps them aligned.)
 */
function stripJsonRpcWrap(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripJsonRpcWrap);
  if (v && typeof v === "object") {
    const obj = v as AnyObj;
    const keys = Object.keys(obj);
    // {type, fields} wrapper around any Move struct -> just unwrap.
    if (
      keys.length === 2 &&
      keys.includes("type") &&
      keys.includes("fields") &&
      typeof obj.type === "string" &&
      obj.fields &&
      typeof obj.fields === "object" &&
      !Array.isArray(obj.fields)
    ) {
      return stripJsonRpcWrap(obj.fields);
    }
    const out: AnyObj = {};
    for (const [k, val] of Object.entries(obj)) {
      // UID field flattening: a field named `id` whose value is `{ id: string }`
      // collapses to just the string. Keeps before/after aligned for any
      // struct that contains a `UID id` field.
      if (
        k === "id" &&
        val &&
        typeof val === "object" &&
        !Array.isArray(val) &&
        Object.keys(val as AnyObj).length === 1 &&
        typeof (val as AnyObj).id === "string"
      ) {
        out[k] = (val as AnyObj).id;
      } else {
        out[k] = stripJsonRpcWrap(val);
      }
    }
    return out;
  }
  return v;
}

function extractLstInfo(lstInfo: unknown) {
  if (!lstInfo) return null;
  const obj = asObj(lstInfo);
  if (!obj) return null;
  // Locate "fields" — flat: obj.fields. nested: obj.content.fields.
  const fields =
    asObj(obj.fields) ?? asObj(asObj(obj.content)?.fields) ?? undefined;
  if (!fields) return null;

  // storage struct: flat is direct. nested wraps in { fields: ... }.
  const storage = asObj(asObj(fields.storage)?.fields) ?? asObj(fields.storage);
  // lst_treasury_cap.total_supply.value
  const treasury =
    asObj(asObj(fields.lst_treasury_cap)?.fields) ??
    asObj(fields.lst_treasury_cap);
  const totalSupply =
    asObj(asObj(treasury?.total_supply)?.fields) ??
    asObj(treasury?.total_supply);
  // fee_config.element
  const feeConfig =
    asObj(asObj(asObj(fields.fee_config)?.fields)?.element) ??
    asObj(asObj(fields.fee_config)?.element);
  const feeConfigFields =
    asObj((feeConfig as AnyObj | undefined)?.fields) ?? feeConfig;

  return {
    objectId: obj.objectId,
    accruedSpreadFees: fields.accrued_spread_fees,
    fees: fields.fees,
    totalSuiSupply: storage?.total_sui_supply,
    totalStSuiSupply: totalSupply?.value,
    lastRefreshEpoch: storage?.last_refresh_epoch,
    totalWeight: storage?.total_weight,
    feeConfig: stripJsonRpcWrap(feeConfigFields),
  };
}

function extractMeta(meta: unknown) {
  if (!meta) return null;
  const obj = asObj(meta);
  if (!obj) return null;
  const fields =
    asObj(obj.fields) ?? asObj(asObj(obj.content)?.fields) ?? undefined;
  if (!fields) return null;

  const stakers = asObj(asObj(fields.stakers)?.fields) ?? asObj(fields.stakers);

  return {
    objectId: obj.objectId,
    lastUpdateEventTimestamp: fields.last_update_event_timestamp,
    stakersSize: stakers?.size,
  };
}

function extractMultiObject(o: unknown) {
  if (!o) return null;
  const obj = asObj(o);
  if (!obj) return null;
  const rawFields =
    asObj(obj.fields) ?? asObj(asObj(obj.content)?.fields) ?? null;
  return {
    objectId: obj.objectId,
    // type from either old (content.type) or new (type)
    type: obj.type ?? asObj(obj.content)?.type,
    // strip JSON-RPC nested wrapping so before/after match
    fields: rawFields ? stripJsonRpcWrap(rawFields) : null,
  };
}

// ---------------------------------------------------------------------------
// Event projection (shape stable across migration; just trim noise).
// ---------------------------------------------------------------------------
function projectEvent(e: unknown) {
  const obj = asObj(e);
  if (!obj) return null;
  return {
    sender: obj.sender,
    timestamp: obj.timestamp,
    type: obj.type,
    txDigest: obj.txDigest,
    eventSeq: obj.eventSeq,
    event: obj.event,
  };
}

// ---------------------------------------------------------------------------
// Tier-1 transaction normalization (mirror of alphalend-sdk-js).
// ---------------------------------------------------------------------------
const VOLATILE_KEYS = new Set(["version", "digest", "initialSharedVersion"]);

function deepStripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepStripVolatile);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(k)) continue;
      out[k] = deepStripVolatile(v);
    }
    return out;
  }
  return value;
}

function normalizeTx(tx: Transaction): unknown {
  const data = tx.getData() as Record<string, unknown>;
  const trimmed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "gasData" || k === "expiration") continue;
    trimmed[k] = v;
  }
  return deepStripVolatile(trimmed);
}

// ---------------------------------------------------------------------------
// step(): time + log + capture errors AND time out individual calls so a
// single hang doesn't stall the entire snapshot run. Default per-step
// timeout is 60s; override via the third arg for known-long calls.
// ---------------------------------------------------------------------------
const DEFAULT_STEP_TIMEOUT_MS = 60_000;

async function step<T>(
  label: string,
  fn: () => Promise<T>,
  onResult: (value: T) => void,
  timeoutMs: number = DEFAULT_STEP_TIMEOUT_MS,
): Promise<void> {
  console.log(label);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`step timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    const t0 = Date.now();
    const value = (await Promise.race([fn(), timeout])) as T;
    onResult(value);
    console.log(`  ok (${Date.now() - t0}ms)`);
  } catch (err) {
    console.warn(`  WARN: ${label} failed:`, err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { out } = parseArgs();
  const outDir = path.join("scripts", "snapshots", out);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Snapshot directory: ${outDir}`);
  console.log(`Test address: ${TEST_ADDRESS}\n`);

  const conf = getConf();
  const LST_INFO_ID = conf.LST_INFO;
  const STSUI_COIN_TYPE = conf.STSUI_COIN_TYPE;
  const META_OBJECT_ID = conf.META_OBJECT;

  // -------------------------------------------------------------------
  // READS: object reads (Cat 1)
  // -------------------------------------------------------------------

  await step(
    "[reads] getLstInfo(LST_INFO, ignoreCache=true)",
    () => getLstInfo(LST_INFO_ID, true),
    (info) => writeSnapshot(outDir, "lstInfo", extractLstInfo(info)),
  );

  await step(
    "[reads] getMeta()",
    () => getMeta(),
    (meta) => writeSnapshot(outDir, "meta", extractMeta(meta)),
  );

  await step(
    "[reads] getMultiObjects([LST_INFO, META_OBJECT])",
    () =>
      getMultiObjects({
        ids: [LST_INFO_ID, META_OBJECT_ID],
        options: { showContent: true },
      }),
    (objs) => {
      // The JSON-RPC version returns SuiObjectResponse[]; we project to a
      // canonical flat shape that handles both before and after.
      const projected = (objs as unknown[]).map((r) => {
        const wrap = asObj(r);
        // SuiObjectResponse wraps in `{ data: ... }`; our migrated flat
        // version may return either shape. Try both.
        return extractMultiObject(wrap?.data ?? wrap);
      });
      writeSnapshot(outDir, "getMultiObjects-2", projected);
    },
  );

  // -------------------------------------------------------------------
  // READS: derived metrics (utils.ts)
  // -------------------------------------------------------------------

  await step(
    "[reads] stSuiExchangeRate()",
    () => stSuiExchangeRate(LST_INFO_ID, true),
    (rate) => writeSnapshot(outDir, "stSuiExchangeRate", { rate }),
  );

  await step(
    "[reads] stStuiCirculationSupply()",
    () => stStuiCirculationSupply(LST_INFO_ID, true),
    (supply) => writeSnapshot(outDir, "stStuiCirculationSupply", { supply }),
  );

  await step(
    "[reads] fetchTotalSuiStaked()",
    () => fetchTotalSuiStaked(LST_INFO_ID, true),
    (staked) => writeSnapshot(outDir, "fetchTotalSuiStaked", { staked }),
  );

  await step(
    "[reads] fetchCurrentStSuiEpoch()",
    () => fetchCurrentStSuiEpoch(),
    (epoch) => writeSnapshot(outDir, "fetchCurrentStSuiEpoch", { epoch }),
  );

  await step(
    "[reads] fetchTotalStakers()",
    () => fetchTotalStakers(),
    (n) => writeSnapshot(outDir, "fetchTotalStakers", { totalStakers: n }),
  );

  await step(
    "[reads] getFees(LST_INFO, ignoreCache=true)",
    () => getFees(LST_INFO_ID, true),
    (fees) =>
      writeSnapshot(outDir, "getFees", fees ? stripJsonRpcWrap(fees) : null),
  );

  for (const days of [1, 7, 30, 365]) {
    await step(
      `[reads] fetchStSuiAPR(${days})`,
      () => fetchStSuiAPR(days),
      (apr) => writeSnapshot(outDir, `fetchStSuiAPR-${days}`, { apr }),
    );
    await step(
      `[reads] fetchStSuiAPY(${days})`,
      () => fetchStSuiAPY(days),
      (apy) => writeSnapshot(outDir, `fetchStSuiAPY-${days}`, { apy }),
    );
  }

  // -------------------------------------------------------------------
  // READS: events (last 7 days)
  // -------------------------------------------------------------------

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Events queries paginate over potentially many pages of global event
  // history filtered server-side; bump the timeout to 120s each.
  const EVENTS_TIMEOUT_MS = 120_000;

  await step(
    "[reads] Events.getMintEvents(7d)",
    () =>
      Events.getMintEvents({
        startTime: sevenDaysAgo,
        endTime: now,
        typeName: STSUI_COIN_TYPE,
      }),
    (events) =>
      writeSnapshot(outDir, "events-mint-7d", events.map(projectEvent)),
    EVENTS_TIMEOUT_MS,
  );

  // Note: Events.getRedeemEvents is intentionally skipped — on the
  // pre-migration JSON-RPC API the descending pagination scans far more
  // pages than for mint/epoch/flash and times out reliably. The shape of
  // a RedeemEvent is structurally identical to MintEvent, so coverage of
  // mint events validates the parsing path.

  await step(
    "[reads] Events.getEpochChangeEvents(7d)",
    () =>
      Events.getEpochChangeEvents({
        startTime: sevenDaysAgo,
        endTime: now,
        typeName: STSUI_COIN_TYPE,
      }),
    (events) =>
      writeSnapshot(outDir, "events-epoch-7d", events.map(projectEvent)),
    EVENTS_TIMEOUT_MS,
  );

  await step(
    "[reads] Events.getFlashStakeEvents(7d)",
    () =>
      Events.getFlashStakeEvents({
        startTime: sevenDaysAgo,
        endTime: now,
        typeName: STSUI_COIN_TYPE,
      }),
    (events) =>
      writeSnapshot(outDir, "events-flash-7d", events.map(projectEvent)),
    EVENTS_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------
  // READS: balance / coin
  // -------------------------------------------------------------------

  await step(
    "[reads] getBalances(TEST_ADDR, ['SUI','STSUI'])",
    () => getBalances(TEST_ADDRESS, ["SUI", "STSUI"]),
    (balances) => writeSnapshot(outDir, "balances", balances),
  );

  await step(
    "[reads] getAllBalances(TEST_ADDR)",
    () => getAllBalances(TEST_ADDRESS),
    (balances) => writeSnapshot(outDir, "allBalances", balances),
  );

  await step(
    "[reads] getWalletCoins(TEST_ADDR)",
    () => getWalletCoins(TEST_ADDRESS),
    (coins) => writeSnapshot(outDir, "walletCoins", coins),
  );

  // -------------------------------------------------------------------
  // READS: pyth (no Sui involvement; sanity check)
  // -------------------------------------------------------------------

  await step(
    "[reads] getLatestPrices(['SUI/USD'])",
    () => getLatestPrices(["SUI/USD"], true),
    (prices) => writeSnapshot(outDir, "latestPrices-SUI", prices),
  );

  await step(
    "[reads] getLatestTokenPricePairs(['SUI/USD'])",
    () => getLatestTokenPricePairs(["SUI/USD"], true),
    (pairs) => writeSnapshot(outDir, "latestTokenPricePairs-SUI", pairs),
  );

  // -------------------------------------------------------------------
  // Utils class (delegates to free functions; snapshot one path through
  // it to confirm the class wrapping doesn't drift).
  // -------------------------------------------------------------------

  const utils = new Utils({
    lstInfo: LST_INFO_ID,
    lstCointype: STSUI_COIN_TYPE,
  });

  await step(
    "[reads] Utils.lstExchangeRate(true)",
    () => utils.lstExchangeRate(true),
    (rate) => writeSnapshot(outDir, "utils-lstExchangeRate", { rate }),
  );

  await step(
    "[reads] Utils.lstCirculationSupply(true)",
    () => utils.lstCirculationSupply(true),
    (s) => writeSnapshot(outDir, "utils-lstCirculationSupply", { supply: s }),
  );

  await step(
    "[reads] Utils.fetchTotalSuiStaked(true)",
    () => utils.fetchTotalSuiStaked(true),
    (s) => writeSnapshot(outDir, "utils-fetchTotalSuiStaked", { staked: s }),
  );

  // -------------------------------------------------------------------
  // TRANSACTIONS: Tier-1 normalized skeletons
  // -------------------------------------------------------------------

  await step(
    "[tx] mint(LST_INFO, STSUI_COIN_TYPE, 1 SUI, TEST_ADDRESS)",
    async () =>
      normalizeTx(
        await mint(LST_INFO_ID, STSUI_COIN_TYPE, MINT_SUI_AMOUNT, TEST_ADDRESS),
      ),
    (data) => writeSnapshot(outDir, "tx-mint", data),
  );

  await step(
    "[tx] redeem(LST_INFO, STSUI_COIN_TYPE, 0.1 stSUI, TEST_ADDRESS)",
    async () =>
      normalizeTx(
        await redeem(
          LST_INFO_ID,
          STSUI_COIN_TYPE,
          REDEEM_STSUI_AMOUNT,
          TEST_ADDRESS,
        ),
      ),
    (data) => writeSnapshot(outDir, "tx-redeem", data),
  );

  await step(
    "[tx] refresh(LST_INFO, STSUI_COIN_TYPE)",
    async () => {
      const tx = await refresh(LST_INFO_ID, STSUI_COIN_TYPE);
      if (!tx) throw new Error("refresh returned undefined");
      return normalizeTx(tx);
    },
    (data) => writeSnapshot(outDir, "tx-refresh", data),
  );

  await step(
    "[tx] create_lst(fakeTreasuryCap, STSUI_COIN_TYPE, 0,1,600,10000, addr)",
    async () =>
      normalizeTx(
        await create_lst(
          FAKE_TREASURY_CAP,
          STSUI_COIN_TYPE,
          0,
          1,
          600,
          10000,
          TEST_ADDRESS,
        ),
      ),
    (data) => writeSnapshot(outDir, "tx-create_lst", data),
  );

  await step(
    "[tx] collect_fee(LST_INFO, STSUI_COIN_TYPE, fakeCollectionFeeCap, addr)",
    async () => {
      const tx = await collect_fee(
        LST_INFO_ID,
        STSUI_COIN_TYPE,
        FAKE_COLLECTION_FEE_CAP,
        TEST_ADDRESS,
      );
      if (!tx) throw new Error("collect_fee returned undefined");
      return normalizeTx(tx);
    },
    (data) => writeSnapshot(outDir, "tx-collect_fee", data),
  );

  await step(
    "[tx] updateFee(LST_INFO, fakeAdminCap, STSUI_COIN_TYPE, 0,1,600,10000)",
    async () => {
      const tx = await updateFee(
        LST_INFO_ID,
        FAKE_ADMIN_CAP,
        STSUI_COIN_TYPE,
        0,
        1,
        600,
        10000,
      );
      if (!tx) throw new Error("updateFee returned undefined");
      return normalizeTx(tx);
    },
    (data) => writeSnapshot(outDir, "tx-updateFee", data),
  );

  await step(
    "[tx] setValidators(LST_INFO, fakeAdminCap, STSUI_COIN_TYPE, [addr], [100])",
    async () => {
      const tx = await setValidators(
        LST_INFO_ID,
        FAKE_ADMIN_CAP,
        STSUI_COIN_TYPE,
        [TEST_ADDRESS],
        [100],
      );
      if (!tx) throw new Error("setValidators returned undefined");
      return normalizeTx(tx);
    },
    (data) => writeSnapshot(outDir, "tx-setValidators", data),
  );

  // -------------------------------------------------------------------
  // Class-based wrappers (LST.mint, Admin.createLst etc.) — verify they
  // produce the same skeleton as the free function variants.
  // -------------------------------------------------------------------

  const lst = new LST({
    lstInfo: LST_INFO_ID,
    lstCointype: STSUI_COIN_TYPE,
  });
  const admin = new Admin({
    lstInfo: LST_INFO_ID,
    lstCointype: STSUI_COIN_TYPE,
    treasuryCap: FAKE_TREASURY_CAP,
    adminCap: FAKE_ADMIN_CAP,
    collectionFeeCap: FAKE_COLLECTION_FEE_CAP,
  });

  await step(
    "[tx] LST.mint(1 SUI, TEST_ADDRESS)",
    async () => {
      const tx = await lst.mint(MINT_SUI_AMOUNT, TEST_ADDRESS);
      if (!tx) throw new Error("LST.mint returned undefined");
      return normalizeTx(tx);
    },
    (data) => writeSnapshot(outDir, "tx-LST.mint", data),
  );

  await step(
    "[tx] LST.redeem(0.1 stSUI, TEST_ADDRESS)",
    async () => {
      const tx = await lst.redeem(REDEEM_STSUI_AMOUNT, TEST_ADDRESS);
      if (!tx) throw new Error("LST.redeem returned undefined");
      return normalizeTx(tx);
    },
    (data) => writeSnapshot(outDir, "tx-LST.redeem", data),
  );

  await step(
    "[tx] LST.refresh()",
    async () => {
      const tx = await lst.refresh();
      if (!tx) throw new Error("LST.refresh returned undefined");
      return normalizeTx(tx);
    },
    (data) => writeSnapshot(outDir, "tx-LST.refresh", data),
  );

  await step(
    "[tx] Admin.createLst(0,1,600,10000, addr)",
    async () => {
      const tx = await admin.createLst(0, 1, 600, 10000, TEST_ADDRESS);
      if (!tx) throw new Error("Admin.createLst returned undefined");
      return normalizeTx(tx);
    },
    (data) => writeSnapshot(outDir, "tx-Admin.createLst", data),
  );

  await step(
    "[tx] Admin.collectFee(addr)",
    async () => {
      const tx = await admin.collectFee(TEST_ADDRESS);
      if (!tx) throw new Error("Admin.collectFee returned undefined");
      return normalizeTx(tx);
    },
    (data) => writeSnapshot(outDir, "tx-Admin.collectFee", data),
  );

  await step(
    "[tx] Admin.updateFee(0,1,600,10000)",
    async () => {
      const tx = await admin.updateFee(0, 1, 600, 10000);
      if (!tx) throw new Error("Admin.updateFee returned undefined");
      return normalizeTx(tx);
    },
    (data) => writeSnapshot(outDir, "tx-Admin.updateFee", data),
  );

  await step(
    "[tx] Admin.setValidators([addr], [100])",
    async () => {
      const tx = await admin.setValidators([TEST_ADDRESS], [100]);
      if (!tx) throw new Error("Admin.setValidators returned undefined");
      return normalizeTx(tx);
    },
    (data) => writeSnapshot(outDir, "tx-Admin.setValidators", data),
  );

  // Note: updateTotalStakers is intentionally skipped — it paginates
  // every Mint event since the meta object was last updated, which
  // reliably runs to many thousands of events and times out. The other
  // mint-event coverage above already exercises the same parsing path.

  console.log("\nSnapshot complete.");
}

main()
  .then(() => {
    // Force exit so any rogue async work (e.g. paginated event fetches we
    // already abandoned via Promise.race timeout) doesn't keep the process
    // alive past completion.
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
