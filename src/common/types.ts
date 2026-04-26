/**
 * Flat representation of the on-chain `LiquidStakingInfo<LST>` object.
 *
 * **Note (v0.1.x GraphQL migration):** earlier versions of this SDK
 * returned the legacy JSON-RPC `getObject({showContent: true})` shape,
 * which wraps every nested Move struct in `{ type, fields }`. After the
 * migration we return GraphQL's natural flat shape — the deep `.content
 * .fields.X.fields.Y.fields.Z` chains collapse to `.fields.X.Y.Z`.
 */
export type LiquidStakingInfo = {
  objectId: string;
  version: string;
  digest: string;
  type: string;
  fields: {
    accrued_spread_fees: string;
    fees: string;
    fee_config: { element: FeeConfig };
    lst_treasury_cap: { total_supply: { value: string } };
    storage: {
      last_refresh_epoch: string;
      total_sui_supply: string;
      total_weight: string;
    };
  };
};

export type FeeConfig = {
  custom_redeem_fee_bps: string;
  flash_stake_fee_bps: string;
  redeem_fee_bps: string;
  redeem_fee_distribution_component_bps: string;
  spread_fee_bps: string;
  staked_sui_mint_fee_bps: string;
  staked_sui_redeem_fee_bps: string;
  sui_mint_fee_bps: string;
};

export type CommonEventParams = {
  startTime?: number;
  endTime?: number;
  typeName: string;
};

export type EpochChangedEvent = {
  event: {
    typename: {
      name: string;
    };
    old_sui_supply: string;
    new_sui_supply: string;
    lst_supply: string;
    spread_fee: string;
  };
  sender: string;
  timestamp: string;
  type: string;
  txDigest: string;
  eventSeq: string;
};

export type MintEvent = {
  event: {
    typename: {
      name: string;
    };
    sui_amount_in: string;
    lst_amount_out: string;
    fee_amount: string;
  };
  sender: string;
  timestamp: string;
  type: string;
  txDigest: string;
  eventSeq: string;
};

export type RedeemEvent = {
  event: {
    typename: {
      name: string;
    };
    lst_amount_in: string;
    sui_amount_out: string;
    fee_amount: string;
    fee_distributed: string;
  };
  sender: string;
  timestamp: string;
  type: string;
  txDigest: string;
  eventSeq: string;
};

export type FlashStakeEvent = {
  event: {
    typename: {
      name: string;
    };
    sui_amount_in: string;
    lst_amount_out: string;
    fee_amount: string;
  };
  sender: string;
  timestamp: string;
  type: string;
  txDigest: string;
  eventSeq: string;
};
export type EventName =
  | "MintEvent"
  | "RedeemEvent"
  | "FlashStakeEvent"
  | "EpochChangedEvent";
export type EventType =
  | MintEvent
  | RedeemEvent
  | FlashStakeEvent
  | EpochChangedEvent;
/**
 * Flat representation of the on-chain Meta object. Same v0.1.x shape
 * change as `LiquidStakingInfo` — no `content.fields.*.fields.*` wrap.
 */
export type Meta = {
  objectId: string;
  version: string;
  digest: string;
  type: string;
  fields: {
    last_update_event_timestamp: string;
    stakers: {
      id: string;
      size: string;
    };
  };
};
/**
 * your lst data.
 * fields need to be populated based on the function call.
 * note: admin cap and collection fee cap will be given upon creating the lst.
 */
export type LstParams = {
  /**
   * object id of your lstInfo object
   */
  lstInfo?: string;
  /**
   * coin type of the lst
   */
  lstCointype?: string;
  /**
   * object id of your admin cap
   */
  adminCap?: string;
  /**
   * object id of your collection fee cap
   */
  collectionFeeCap?: string;
  /**
   * object if of your lst's treasury cap
   */
  treasuryCap?: string;
};
