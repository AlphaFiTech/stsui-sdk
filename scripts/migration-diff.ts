/**
 * Migration Diff (stsui-sdk)
 *
 * Compares the JSON snapshots under
 *   scripts/snapshots/before/   (captured pre-migration)
 *   scripts/snapshots/after/    (captured post-migration)
 *
 * Reports semantic differences in three buckets:
 *   - signal    -> potential regression
 *   - expected  -> intentional shape change documented in the migration
 *   - noise     -> values that legitimately drift between two runs of the
 *                  same code (timestamps, accruing balances, oracle prices)
 *
 * Usage:
 *   npx tsx scripts/migration-diff.ts            # report
 *   npx tsx scripts/migration-diff.ts --strict   # show ALL diffs incl. noise
 *   npx tsx scripts/migration-diff.ts --file lstInfo.json   # focus one file
 */

import * as fs from "fs";
import * as path from "path";

const BEFORE_DIR = path.join("scripts", "snapshots", "before");
const AFTER_DIR = path.join("scripts", "snapshots", "after");

interface Diff {
  path: string;
  before: unknown;
  after: unknown;
}

// ---------------------------------------------------------------------------
// Noise classification — accruing accumulators, chain time, oracle prices.
// ---------------------------------------------------------------------------
const NOISE_SUFFIXES = new Set<string>([
  // accumulating chain accumulators inside lstInfo
  "accruedSpreadFees",
  "accrued_spread_fees",
  "totalSuiSupply",
  "total_sui_supply",
  "total_sui_amount",
  "sui_pool",
  "totalStSuiSupply",
  "totalWeight",
  "total_weight",
  "lastRefreshEpoch",
  "last_refresh_epoch",
  "value", // total_supply.value — tracks live stSUI supply
  // chain time
  "epoch",
  "lastUpdateEventTimestamp",
  "last_update_event_timestamp",
  // derived metric values
  "rate", // stSuiExchangeRate.rate
  "supply", // stStuiCirculationSupply.supply, getMultiObjects total_supply
  "staked", // fetchTotalSuiStaked.staked
  "totalStakers",
  "apr",
  "apy",
  "totalBalance",
  "balance",
  "coinObjectCount",
  // pyth (live oracle)
  "price",
  // event-window noise
  "timestamp",
  "txDigest",
  "eventSeq",
]);

// Per-file extra noise patterns.
function extraNoiseForFile(file: string): (path: string) => boolean {
  if (file.startsWith("events-")) {
    // Events come and go between runs; everything inside the array is volatile.
    return () => true;
  }
  if (file === "balances.json" || file === "allBalances.json") {
    // Per-balance numeric drift fully expected.
    return () => true;
  }
  if (
    file === "latestPrices-SUI.json" ||
    file === "latestTokenPricePairs-SUI.json"
  ) {
    return () => true;
  }
  return () => false;
}

function isNoise(diffPath: string, file: string): boolean {
  const segs = diffPath.split(".");
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i].replace(/\[\d+\]$/, "");
    if (NOISE_SUFFIXES.has(seg)) return true;
    // walk past array-index segments
    if (!/^\d+$/.test(seg)) break;
  }
  if (extraNoiseForFile(file)(diffPath)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Expected (intentional) deltas, classified separately from signal.
// ---------------------------------------------------------------------------

interface ExpectedFix {
  match(file: string, diffPath: string): boolean;
  reason: string;
}

const EXPECTED_FIXES: ExpectedFix[] = [
  {
    match: (file) => file === "walletCoins.json",
    reason:
      "Pre-migration getWalletCoins always returned []; the GraphQL rewrite returns the actual coin list.",
  },
];

function expectedReason(diffPath: string, file: string): string | undefined {
  for (const fix of EXPECTED_FIXES) {
    if (fix.match(file, diffPath)) return fix.reason;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Generic deep diff.
// ---------------------------------------------------------------------------
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function diffValues(a: unknown, b: unknown, p: string, diffs: Diff[]) {
  if (a === b) return;
  if (typeof a !== typeof b) {
    diffs.push({ path: p, before: a, after: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push({ path: `${p}.length`, before: a.length, after: b.length });
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      diffValues(a[i], b[i], `${p}[${i}]`, diffs);
    }
    return;
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a)) {
        diffs.push({ path: `${p}.${k}`, before: undefined, after: b[k] });
        continue;
      }
      if (!(k in b)) {
        diffs.push({ path: `${p}.${k}`, before: a[k], after: undefined });
        continue;
      }
      diffValues(a[k], b[k], `${p}.${k}`, diffs);
    }
    return;
  }
  if (a !== b) diffs.push({ path: p, before: a, after: b });
}

function listSnapshots(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function fmtVal(v: unknown): string {
  const s = JSON.stringify(v);
  if (s === undefined) return "<undef>";
  if (s.length > 120) return s.slice(0, 117) + "...";
  return s;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  let strict = false;
  let onlyFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--strict") strict = true;
    else if (args[i] === "--file" && i + 1 < args.length) {
      onlyFile = args[i + 1];
      i++;
    }
  }
  return { strict, onlyFile };
}

function main() {
  const { strict, onlyFile } = parseArgs();

  const beforeFiles = new Set(listSnapshots(BEFORE_DIR));
  const afterFiles = new Set(listSnapshots(AFTER_DIR));

  if (beforeFiles.size === 0) {
    console.error(`No snapshots in ${BEFORE_DIR}. Capture --out before first.`);
    process.exit(1);
  }
  if (afterFiles.size === 0) {
    console.error(`No snapshots in ${AFTER_DIR}. Capture --out after first.`);
    process.exit(1);
  }

  const onlyBefore = [...beforeFiles].filter((f) => !afterFiles.has(f));
  const onlyAfter = [...afterFiles].filter((f) => !beforeFiles.has(f));

  if (onlyBefore.length || onlyAfter.length) {
    console.log("File set differences:");
    for (const f of onlyBefore) console.log(`  -- only in before: ${f}`);
    for (const f of onlyAfter) console.log(`  ++ only in after:  ${f}`);
    console.log("");
  }

  let shared = [...beforeFiles].filter((f) => afterFiles.has(f));
  if (onlyFile) {
    shared = shared.filter((f) => f === onlyFile);
    if (shared.length === 0) {
      console.error(`No shared snapshot named ${onlyFile}.`);
      process.exit(1);
    }
  }

  let totalDiffs = 0;
  let totalSignal = 0;
  let totalExpected = 0;
  let totalNoise = 0;
  const filesWithSignal: {
    file: string;
    signal: Diff[];
    expected: Diff[];
    noise: Diff[];
  }[] = [];
  const expectedTally = new Map<string, number>();

  for (const f of shared) {
    const a = readJson(path.join(BEFORE_DIR, f));
    const b = readJson(path.join(AFTER_DIR, f));
    const diffs: Diff[] = [];
    diffValues(a, b, "$", diffs);
    totalDiffs += diffs.length;
    if (diffs.length === 0) continue;

    const signal: Diff[] = [];
    const expected: Diff[] = [];
    const noise: Diff[] = [];
    for (const d of diffs) {
      const reason = expectedReason(d.path, f);
      if (reason) {
        expected.push(d);
        expectedTally.set(reason, (expectedTally.get(reason) ?? 0) + 1);
      } else if (isNoise(d.path, f)) {
        noise.push(d);
      } else {
        signal.push(d);
      }
    }
    totalSignal += signal.length;
    totalExpected += expected.length;
    totalNoise += noise.length;
    if (signal.length > 0 || strict) {
      filesWithSignal.push({ file: f, signal, expected, noise });
    }
  }

  console.log(
    `Compared ${shared.length} snapshot(s). ${totalDiffs} raw diffs ` +
      `(${totalSignal} signal, ${totalExpected} expected-fix, ${totalNoise} noise).\n`,
  );

  if (totalExpected > 0) {
    console.log("Expected (intentional) migration deltas:");
    for (const [reason, n] of expectedTally.entries()) {
      console.log(`  x${n}  ${reason}`);
    }
    console.log("");
  }

  if (totalSignal === 0) {
    console.log(
      "All shared snapshots are semantically identical (after filtering " +
        "known time-drift noise and intentional migration deltas).",
    );
    return;
  }

  for (const { file, signal, expected, noise } of filesWithSignal) {
    const total = signal.length + expected.length + noise.length;
    console.log(`-- ${file}  (${signal.length} signal / ${total} total)`);
    const toShow = strict ? [...signal, ...expected, ...noise] : signal;
    for (const d of toShow.slice(0, 30)) {
      let tag = "[SIGNAL]";
      if (expectedReason(d.path, file)) tag = "[expected]";
      else if (isNoise(d.path, file)) tag = "[noise]";
      console.log(`   ${tag} ${d.path}`);
      console.log(`           - ${fmtVal(d.before)}`);
      console.log(`           + ${fmtVal(d.after)}`);
    }
    if (toShow.length > 30) {
      console.log(`   ... ${toShow.length - 30} more`);
    }
    console.log("");
  }

  if (totalSignal > 0) process.exitCode = 1;
}

main();
