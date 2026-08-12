import { fromBase64 } from "@mysten/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";

import * as dotenv from "dotenv";
import { Transaction } from "@mysten/sui/transactions";

dotenv.config();

const GRPC_URLS: Record<string, string> = {
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
  localnet: "http://127.0.0.1:9000",
};

/**
 * gRPC client. Public fullnodes no longer serve JSON-RPC, so reads, simulation
 * and execution all go through gRPC. Override the endpoint with SUI_GRPC_URL.
 */
export function getGrpcClient(
  network: string = process.env.NETWORK ?? "mainnet",
) {
  const baseUrl = process.env.SUI_GRPC_URL ?? GRPC_URLS[network];
  if (!baseUrl) {
    throw new Error(`no gRPC url for network '${network}'`);
  }

  return new SuiGrpcClient({
    network: network as "mainnet" | "testnet" | "devnet" | "localnet",
    baseUrl,
  });
}

export function getExecStuff() {
  if (!process.env.PK_B64) {
    throw new Error("env var PK_B64 not configured");
  }

  const b64PrivateKey = process.env.PK_B64 as string;
  const keypair = Ed25519Keypair.fromSecretKey(
    fromBase64(b64PrivateKey).slice(1),
  );
  const address = `${keypair.getPublicKey().toSuiAddress()}`;

  if (!process.env.NETWORK) {
    throw new Error("env var NETWORK not configured");
  }

  return { address, keypair, client: getGrpcClient(process.env.NETWORK) };
}

/**
 * Signs and submits. Returns false if the transaction threw or executed with a failure.
 *
 * A MoveAbort does not throw — it comes back as `$kind: "FailedTransaction"` — so checking only
 * for exceptions would report a failed run as a success.
 */
export async function executeTransactionBlock(
  txb: Transaction,
): Promise<boolean> {
  const { keypair, client, address } = getExecStuff();
  txb.setSenderIfNotSet(address);

  try {
    const bytes = await txb.build({ client });
    const { signature } = await keypair.signTransaction(bytes);
    const res = await client.core.executeTransaction({
      transaction: bytes,
      signatures: [signature],
      include: { effects: true, balanceChanges: true },
    });
    console.log(JSON.stringify(res, null, 2));

    if (res.$kind === "FailedTransaction") {
      console.error(
        `transaction failed: ${JSON.stringify(res.FailedTransaction.status)}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

/** Simulates. Returns false if the simulation threw or the transaction would fail. */
export async function dryRunTransactionBlock(
  txb: Transaction,
  sender?: string,
): Promise<boolean> {
  const { client, address } = getExecStuff();
  txb.setSender(sender ?? address);

  try {
    const res = await client.core.simulateTransaction({
      transaction: txb,
      include: { effects: true, balanceChanges: true },
    });
    const tx =
      res.$kind === "Transaction" ? res.Transaction : res.FailedTransaction;
    console.log(tx?.status, tx?.balanceChanges);

    if (res.$kind === "FailedTransaction") {
      console.error(
        `simulation failed: ${JSON.stringify(res.FailedTransaction.status)}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}
