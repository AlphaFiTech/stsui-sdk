/**
 * Recovers the 1513.878129304 SUI mistakenly transferred to the stSUI CollectionFeeCap.
 *
 * The coin is owned by AddressOwner(<cap id>), so it can only be pulled out by
 * `liquid_staking::receive_stray` — added in AlphaFiTech/alpha#bugfix/lst-receive-stray. Until
 * that upgrade is live the script reports and stops; it checks the function exists before
 * building anything.
 *
 *   npx tsx scripts/receiveStray.ts                # dry run
 *   npx tsx scripts/receiveStray.ts --execute      # sign and submit
 *   RECIPIENT=0x… npx tsx scripts/receiveStray.ts  # send somewhere other than the signer
 *
 * The cap is address-owned, so PK_B64 must be the cap owner's key regardless of RECIPIENT.
 */
import { Transaction } from "@mysten/sui/transactions";
import { getConf } from "../src/index.ts";
import {
  dryRunTransactionBlock,
  executeTransactionBlock,
  getExecStuff,
  getGrpcClient,
} from "./utils.ts";

const MODULE = "liquid_staking";
const FUNCTION = "receive_stray";

const CAP = "0x019466989adf3cf8320f8e7ab45a44c6f8ce9688125852b60c82475d2d2f9849";
const STRAY_COIN =
  "0xb2bedbc05a022505fb1c8564e39c9f8f19e176f20563197f8abe2c9cc9fc99aa";
const STRAY_TYPE = "0x2::coin::Coin<0x2::sui::SUI>";

/**
 * Builds a PTB that receives `stray` out of `collectionFeeCap` and transfers it to `address`.
 *
 * `receive_stray` returns the object rather than transferring it, so the destination is decided
 * here instead of being baked into the package.
 */
export function buildReceiveStrayTx(
  packageId: string,
  collectionFeeCap: string,
  lstCoinType: string,
  stray: { objectId: string; version: string; digest: string; type: string },
  address: string,
): Transaction {
  const txb = new Transaction();

  const [received] = txb.moveCall({
    target: `${packageId}::${MODULE}::${FUNCTION}`,
    typeArguments: [lstCoinType, stray.type],
    arguments: [
      txb.object(collectionFeeCap),
      txb.receivingRef({
        objectId: stray.objectId,
        version: stray.version,
        digest: stray.digest,
      }),
    ],
  });

  txb.transferObjects([received], address);
  return txb;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const packageId = process.env.PACKAGE_ID ?? getConf().STSUI_LATEST_PACKAGE_ID;
  const { address: signer } = getExecStuff();
  const recipient = process.env.RECIPIENT ?? signer;
  const client = getGrpcClient();

  // Fetched, never hardcoded: receivingRef needs the object's current version and digest.
  const { objects } = await client.core.getObjects({
    objectIds: [CAP, STRAY_COIN],
    include: { json: true },
  });
  const [cap, coin] = objects;
  if (cap instanceof Error) throw new Error(`cap: ${cap.message}`);
  if (coin instanceof Error) throw new Error(`stray coin: ${coin.message}`);

  const owner =
    cap.owner.$kind === "AddressOwner" ? cap.owner.AddressOwner : undefined;
  const coinOwner =
    coin.owner.$kind === "AddressOwner" ? coin.owner.AddressOwner : undefined;
  if (coinOwner !== CAP) {
    console.log(`already recovered — ${STRAY_COIN} is now owned by ${coinOwner}`);
    return;
  }

  const lstCoinType = cap.type.slice(
    cap.type.indexOf("<") + 1,
    cap.type.lastIndexOf(">"),
  );

  console.log(`package  : ${packageId}`);
  console.log(`cap      : ${CAP}  (owner ${owner})`);
  console.log(`stray    : ${STRAY_COIN} v${coin.version}`);
  console.log(`amount   : ${(coin.json as { balance: string }).balance} MIST`);
  console.log(`type arg : ${lstCoinType}`);
  console.log(`signer   : ${signer}`);
  console.log(`recipient: ${recipient}`);

  try {
    await client.core.getMoveFunction({
      packageId,
      moduleName: MODULE,
      name: FUNCTION,
    });
  } catch {
    console.log(
      `\nNOT RECOVERABLE YET — ${packageId} has no ${MODULE}::${FUNCTION}. ` +
        `Land the package upgrade, then bump STSUI_LATEST_PACKAGE_ID in src/common/ids.ts.`,
    );
    return;
  }

  if (owner !== signer) {
    console.log(
      `\nWRONG SIGNER — the cap is owned by ${owner}, PK_B64 resolves to ${signer}.`,
    );
    return;
  }

  const txb = buildReceiveStrayTx(
    packageId,
    CAP,
    lstCoinType,
    {
      objectId: STRAY_COIN,
      version: coin.version,
      digest: coin.digest,
      type: STRAY_TYPE,
    },
    recipient,
  );

  if (execute) {
    console.log("\nexecuting…");
    await executeTransactionBlock(txb);
  } else {
    console.log("\ndry run (pass --execute to submit):");
    await dryRunTransactionBlock(txb, signer);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
