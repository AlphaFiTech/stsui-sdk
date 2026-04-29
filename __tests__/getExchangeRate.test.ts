import { getConf, stSuiExchangeRate } from "..";

describe("stSuiExchangeRate", () => {
  it("should return the correct value", async () => {
    return stSuiExchangeRate(getConf().LST_INFO, true).then((exchangeRate) => {
      expect(exchangeRate).toBeDefined();
    });
  });
});
