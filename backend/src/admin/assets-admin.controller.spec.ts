import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";

import { AssetBatchStatusDto } from "./assets-admin.controller";

async function validateBatchStatus(body: unknown) {
  return validate(plainToInstance(AssetBatchStatusDto, body));
}

describe("AssetBatchStatusDto", () => {
  it("接受不超过 100 条的素材 id", async () => {
    await expect(
      validateBatchStatus({
        ids: Array.from({ length: 100 }, (_, index) => `asset-${index}`),
        status: "hidden",
      }),
    ).resolves.toHaveLength(0);
  });

  it("拒绝非数组 ids", async () => {
    const errors = await validateBatchStatus({
      ids: "asset-1",
      status: "hidden",
    });

    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: "ids" })]),
    );
  });

  it("拒绝超过 100 条或含非字符串元素的 ids", async () => {
    const tooMany = await validateBatchStatus({
      ids: Array.from({ length: 101 }, (_, index) => `asset-${index}`),
      status: "hidden",
    });
    const wrongElement = await validateBatchStatus({
      ids: ["asset-1", 2],
      status: "hidden",
    });

    expect(tooMany).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: "ids" })]),
    );
    expect(wrongElement).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: "ids" })]),
    );
  });
});
