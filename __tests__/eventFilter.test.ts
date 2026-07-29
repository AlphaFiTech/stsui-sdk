/**
 * Regression guard for the event `typename` filter.
 *
 * GraphQL's `contents.json` renders Move's `TypeName` as a plain string, while
 * the JSON-RPC era rendered it as `{ name }`. Reading `.typename.name` under
 * GraphQL yielded `undefined`, so `Events.getEvents` silently dropped *every*
 * event — `fetchStSuiAPR`/`fetchStSuiAPY` returned "0" and `getMintEvents`
 * found nothing, all while the suite stayed green (the live tests only assert
 * `toBeDefined()`, and the callers swallow the empty result as "0").
 *
 * These tests pin the filter contract without touching the network: the
 * GraphQL layer is mocked, so a regression in the `typename` shape fails here
 * instead of quietly zeroing out APR in production.
 */
import { jest } from "@jest/globals";
import type { PaginatedMoveEvents } from "../dist/esm/common/blockchain.js";

const STSUI = "0xd1b7...::stsui::STSUI";
const OTHER_LST = "0xdead...::other::OTHER";

/** Build one GraphQL-shaped event node as `queryMoveEvents` returns it. */
function makeEvent(typename: string, timestampMs: number) {
  return {
    id: { txDigest: "0xdigest", eventSeq: "0" },
    packageId: "0xpkg",
    transactionModule: "liquid_staking",
    sender: "0xsender",
    type: "0xpkg::events::Event<0xpkg::liquid_staking::MintEvent>",
    // `typename` carries no 0x prefix on-chain — the filter re-adds it.
    parsedJson: {
      event: {
        typename: typename.replace(/^0x/, ""),
        sui_amount_in: "1000",
        lst_amount_out: "990",
        fee_amount: "10",
      },
    },
    bcs: "",
    bcsEncoding: "base64",
    timestampMs: String(timestampMs),
  };
}

const queryMoveEvents = jest.fn<() => Promise<PaginatedMoveEvents>>();

jest.unstable_mockModule("../dist/esm/common/blockchain.js", () => ({
  queryMoveEvents,
}));

// Imported after the mock is registered — ESM bindings resolve at import time.
const { Events } = await import("../dist/esm/common/events.js");

beforeEach(() => {
  queryMoveEvents.mockReset();
});

/** One page, no continuation. */
function singlePage(
  nodes: ReturnType<typeof makeEvent>[],
): PaginatedMoveEvents {
  return {
    data: nodes,
    hasNextPage: false,
    nextCursor: null,
  } as unknown as PaginatedMoveEvents;
}

describe("Events.getEvents typename filter", () => {
  it("keeps events whose typename matches the requested coin type", async () => {
    const now = Date.now();
    queryMoveEvents.mockResolvedValue(
      singlePage([makeEvent(STSUI, now - 1000), makeEvent(STSUI, now - 2000)]),
    );

    const events = await Events.getMintEvents({
      startTime: now - 86400000,
      endTime: now,
      typeName: STSUI,
    });

    // The bug this pins: a shape change here silently yields [] instead of failing.
    expect(events).toHaveLength(2);
    expect(events[0].sender).toBe("0xsender");
  });

  it("drops events of a different coin type", async () => {
    const now = Date.now();
    queryMoveEvents.mockResolvedValue(
      singlePage([
        makeEvent(OTHER_LST, now - 1000),
        makeEvent(STSUI, now - 2000),
      ]),
    );

    const events = await Events.getMintEvents({
      startTime: now - 86400000,
      endTime: now,
      typeName: STSUI,
    });

    expect(events).toHaveLength(1);
    expect(events[0].event.typename).toBe(STSUI.replace(/^0x/, ""));
  });

  it("drops every event when typename is the legacy JSON-RPC {name} shape", async () => {
    const now = Date.now();
    const legacy = makeEvent(STSUI, now - 1000);
    // The pre-fix rendering — proves the filter compares the string form and
    // is not accidentally matching on some other field.
    (legacy.parsedJson.event as unknown as { typename: unknown }).typename = {
      name: STSUI.replace(/^0x/, ""),
    };
    queryMoveEvents.mockResolvedValue(singlePage([legacy]));

    const events = await Events.getMintEvents({
      startTime: now - 86400000,
      endTime: now,
      typeName: STSUI,
    });

    expect(events).toHaveLength(0);
  });
});
