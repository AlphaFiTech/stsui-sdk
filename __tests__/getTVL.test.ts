import { getConf, stStuiCirculationSupply } from "..";

describe("stStuiCirculationSupply", () => {
  it("should return the correct value", async () => {
    return stStuiCirculationSupply(getConf().LST_INFO, true).then((tvl) => {
      expect(tvl).toBeDefined();
    });
  });
});
