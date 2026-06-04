import {
  Transaction,
  TransactionObjectArgument,
} from "@mysten/sui/transactions";
import { getConf, stSuiExchangeRate } from "../index.js";
import { CoinStruct } from "@mysten/sui/jsonRpc";
import { Decimal } from "decimal.js";
import { getCoinsOfType } from "../common/blockchain.js";

async function fetchAllCoinsOfType(
  owner: string,
  coinType: string,
): Promise<CoinStruct[]> {
  const all: CoinStruct[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const page = await getCoinsOfType(owner, coinType, cursor);
    all.push(...page.data);
    if (page.hasNextPage && page.nextCursor) {
      cursor = page.nextCursor;
    } else {
      hasMore = false;
    }
  }
  return all;
}

export async function redeem(
  lstInfo: string,
  lstCoinType: string,
  stSuiAmount: string,
  address: string,
): Promise<Transaction> {
  const txb = new Transaction();

  const coins = await fetchAllCoinsOfType(address, lstCoinType);

  if (coins.length == 0) {
    throw new Error("No coin");
  }
  const [coin] = txb.splitCoins(txb.object(coins[0].coinObjectId), [0]);
  txb.mergeCoins(
    coin,
    coins.map((c) => c.coinObjectId),
  );
  const [stSuiCoin] = txb.splitCoins(coin, [stSuiAmount]);

  const [sui] = txb.moveCall({
    target: getConf().STSUI_LATEST_PACKAGE_ID + "::liquid_staking::redeem",
    arguments: [
      txb.object(lstInfo),
      stSuiCoin,
      txb.object(getConf().SUI_SYSTEM_STATE_OBJECT_ID),
    ],
    typeArguments: [lstCoinType],
  });
  txb.transferObjects([sui, coin], address);
  txb.setSender(address);
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

  const coins = await fetchAllCoinsOfType(
    options.address,
    getConf().STSUI_COIN_TYPE,
  );

  if (coins.length == 0) {
    throw new Error("No coin");
  }
  const [coin] = txb.splitCoins(txb.object(coins[0].coinObjectId), [0]);
  txb.mergeCoins(
    coin,
    coins.map((c) => c.coinObjectId),
  );
  const [stSuiCoin] = txb.splitCoins(coin, [stSuiAmount]);

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
    tx: txb,
    coinOut: sui,
    remainingLSTCoin: coin,
    amountOut: amountOut.toString(),
  };
}
