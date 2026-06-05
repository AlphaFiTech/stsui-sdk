import {
  Transaction,
  TransactionObjectArgument,
} from "@mysten/sui/transactions";
import {
  getConf,
  stSuiExchangeRate,
  sendCoinToAddressBalance,
} from "../index.js";
import { Decimal } from "decimal.js";

export async function mint(
  lstInfo: string,
  lstCoinType: string,
  sui_amount: string,
  address: string,
): Promise<Transaction> {
  const txb = new Transaction();

  const suiToStake = txb.splitCoins(txb.gas, [sui_amount]);

  const [coin] = txb.moveCall({
    target: getConf().STSUI_LATEST_PACKAGE_ID + "::liquid_staking::mint",
    arguments: [
      txb.object(lstInfo),
      txb.object(getConf().SUI_SYSTEM_STATE_OBJECT_ID),
      suiToStake,
    ],
    typeArguments: [lstCoinType],
  });
  sendCoinToAddressBalance(txb, lstCoinType, address, coin);
  txb.setSender(address);
  return txb;
}

export async function mintTx(
  sui_amount: string,
  txb: Transaction | undefined = undefined,
): Promise<{
  tx: Transaction;
  coinOut: TransactionObjectArgument | undefined;
  amountOut: string;
}> {
  if (!txb) txb = new Transaction();

  const suiToStake = txb.splitCoins(txb.gas, [sui_amount]);

  const [coin] = txb.moveCall({
    target: getConf().STSUI_LATEST_PACKAGE_ID + "::liquid_staking::mint",
    arguments: [
      txb.object(getConf().LST_INFO),
      txb.object(getConf().SUI_SYSTEM_STATE_OBJECT_ID),
      suiToStake,
    ],
    typeArguments: [getConf().STSUI_COIN_TYPE],
  });
  const exchangeRate = new Decimal(
    await stSuiExchangeRate(getConf().LST_INFO, false),
  );
  const sui_amount_decimal = new Decimal(sui_amount);
  const amountOut = sui_amount_decimal.div(exchangeRate);

  return {
    tx: txb,
    coinOut: coin,
    amountOut: amountOut.toString(),
  };
}
