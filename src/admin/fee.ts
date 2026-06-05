import { Transaction } from "@mysten/sui/transactions";
import { getConf, sendCoinToAddressBalance } from "../index.js";

export async function collect_fee(
  lstInfo: string,
  lstCoinType: string,
  collectionFeeCap: string,
  address: string,
): Promise<Transaction | undefined> {
  const txb = new Transaction();

  const [sui] = txb.moveCall({
    target:
      getConf().STSUI_LATEST_PACKAGE_ID + "::liquid_staking::collect_fees",
    arguments: [
      txb.object(lstInfo),
      txb.object(getConf().SUI_SYSTEM_STATE_OBJECT_ID),
      txb.object(collectionFeeCap),
    ],
    typeArguments: [lstCoinType],
  });
  sendCoinToAddressBalance(txb, getConf().SUI_COIN_TYPE, address, sui);
  return txb;
}
export async function updateFee(
  lstInfo: string,
  adminCap: string,
  lstCoinType: string,
  mintFeeBps: number,
  redeemFeeBps: number,
  spreadFeeBps: number,
  redistributionFeeBps: number,
): Promise<Transaction | undefined> {
  const txb = new Transaction();
  const fee_config = createFeeConfig(
    mintFeeBps,
    redeemFeeBps,
    spreadFeeBps,
    redistributionFeeBps,
    txb,
  );
  txb.moveCall({
    target: getConf().STSUI_LATEST_PACKAGE_ID + "::liquid_staking::update_fees",
    arguments: [txb.object(lstInfo), txb.object(adminCap), fee_config],
    typeArguments: [lstCoinType],
  });
  return txb;
}

export function createFeeConfig(
  mintFeeBps: number,
  redeemFeeBps: number,
  spreadFeeBps: number,
  redistributionFeeBps: number,
  txb: Transaction,
): {
  $kind: "NestedResult";
  NestedResult: [number, number];
} {
  let [config_b] = txb.moveCall({
    target: getConf().STSUI_LATEST_PACKAGE_ID + "::fees::new_builder",
  });

  [config_b] = txb.moveCall({
    target: getConf().STSUI_LATEST_PACKAGE_ID + "::fees::set_sui_mint_fee_bps",
    arguments: [config_b, txb.pure.u64(mintFeeBps)],
  });

  [config_b] = txb.moveCall({
    target: getConf().STSUI_LATEST_PACKAGE_ID + "::fees::set_redeem_fee_bps",
    arguments: [config_b, txb.pure.u64(redeemFeeBps)],
  });

  [config_b] = txb.moveCall({
    target:
      getConf().STSUI_LATEST_PACKAGE_ID +
      "::fees::set_redeem_fee_distribution_component_bps",
    arguments: [config_b, txb.pure.u64(redistributionFeeBps)],
  });

  [config_b] = txb.moveCall({
    target: getConf().STSUI_LATEST_PACKAGE_ID + "::fees::set_spread_fee_bps",
    arguments: [config_b, txb.pure.u64(spreadFeeBps)],
  });

  const [fee_config] = txb.moveCall({
    target: getConf().STSUI_LATEST_PACKAGE_ID + "::fees::to_fee_config",
    arguments: [config_b],
  });

  return fee_config;
}
