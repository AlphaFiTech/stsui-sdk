import {
  Transaction,
  TransactionObjectArgument,
} from "@mysten/sui/transactions";
import { getConf, stSuiExchangeRate } from "../index.js";
import { Decimal } from "decimal.js";

export async function redeem(
  lstInfo: string,
  lstCoinType: string,
  stSuiAmount: string,
  address: string,
): Promise<Transaction> {
  const txb = new Transaction();
  txb.setSender(address);

  // Source the exact stSUI amount from address balance + coin objects. Resolved
  // at build time via @mysten/sui's coinWithBalance intent, so the tx must be
  // built with a v2 client (`.core` available) — our SuiJsonRpcClient and the
  // wallet's dapp-kit client both qualify.
  const stSuiCoin = txb.coin({
    type: lstCoinType,
    balance: BigInt(stSuiAmount),
  });

  const [sui] = txb.moveCall({
    target: getConf().STSUI_LATEST_PACKAGE_ID + "::liquid_staking::redeem",
    arguments: [
      txb.object(lstInfo),
      stSuiCoin,
      txb.object(getConf().SUI_SYSTEM_STATE_OBJECT_ID),
    ],
    typeArguments: [lstCoinType],
  });
  txb.transferObjects([sui], address);
  return txb;
}

export async function redeemTx(
  stSuiAmount: string,
  txb: Transaction | undefined = undefined,
  options: { address: string },
): Promise<{
  tx: Transaction;
  coinOut: TransactionObjectArgument | undefined;
  remainingLSTCoin: TransactionObjectArgument | undefined;
  amountOut: string;
}> {
  if (!txb) txb = new Transaction();
  // coinWithBalance (below) resolves against the tx sender at build time.
  txb.setSenderIfNotSet(options.address);

  // Source the exact stSUI amount from address balance + coin objects.
  const stSuiCoin = txb.coin({
    type: getConf().STSUI_COIN_TYPE,
    balance: BigInt(stSuiAmount),
  });

  const [sui] = txb.moveCall({
    target: getConf().STSUI_LATEST_PACKAGE_ID + "::liquid_staking::redeem",
    arguments: [
      txb.object(getConf().LST_INFO),
      stSuiCoin,
      txb.object(getConf().SUI_SYSTEM_STATE_OBJECT_ID),
    ],
    typeArguments: [getConf().STSUI_COIN_TYPE],
  });

  const exchangeRate = new Decimal(
    await stSuiExchangeRate(getConf().LST_INFO, false),
  );
  const amount_decimal = new Decimal(stSuiAmount);
  const amountOut = amount_decimal.mul(exchangeRate);
  return {
    // No leftover stSUI coin: coinWithBalance sources the exact amount, so any
    // unused balance stays in the user's address balance / coin objects.
    tx: txb,
    coinOut: sui,
    remainingLSTCoin: undefined,
    amountOut: amountOut.toString(),
  };
}
