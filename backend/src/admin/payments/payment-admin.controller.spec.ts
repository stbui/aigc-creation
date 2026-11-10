import { describe, expect, it, vi } from "vitest";

import { PERMISSION_KEY } from "../admin.decorator";
import { PERMISSIONS } from "../permissions";
import {
  AdminPaymentConfigController,
  AdminPaymentExceptionsController,
  AdminPaymentOrdersController,
} from "./payment-admin.controller";

describe("AdminPaymentConfigController 支付设置保存", () => {
  it("只写入请求实际提交的字段，避免覆盖未提交的来源", async () => {
    const settings = {
      updateAll: vi.fn().mockResolvedValue({ updated: [], cleared: [] }),
    };
    const admin = {
      settingsView: vi.fn().mockResolvedValue({ defaultCurrency: "USD" }),
    };
    const controller = new AdminPaymentConfigController(
      admin as never,
      {} as never,
      settings as never,
    );

    await controller.saveSettings(
      { defaultCurrency: "USD" },
      { id: "admin-1" } as never,
    );

    expect(settings.updateAll).toHaveBeenCalledWith(
      { "payment.defaultCurrency": "USD" },
      [],
      "admin-1",
    );
    expect(admin.settingsView).toHaveBeenCalledOnce();
  });
});

describe("AdminPaymentOrdersController 权限口径", () => {
  it("支付订单列表、详情与导出统一使用支付域读权限", () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        AdminPaymentOrdersController.prototype.list,
      ),
    ).toBe(PERMISSIONS.paymentRead);
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        AdminPaymentOrdersController.prototype.detail,
      ),
    ).toBe(PERMISSIONS.paymentRead);
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        AdminPaymentOrdersController.prototype.export,
      ),
    ).toEqual([PERMISSIONS.paymentRead, PERMISSIONS.dataExport]);
  });

  it("查单与关单均使用支付操作权限", () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        AdminPaymentOrdersController.prototype.query,
      ),
    ).toBe(PERMISSIONS.paymentOperate);
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        AdminPaymentOrdersController.prototype.close,
      ),
    ).toBe(PERMISSIONS.paymentOperate);
  });
});

describe("AdminPaymentExceptionsController 权限口径", () => {
  it("异常单读取与资金处置分离权限", () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        AdminPaymentExceptionsController.prototype.list,
      ),
    ).toBe(PERMISSIONS.paymentRead);
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        AdminPaymentExceptionsController.prototype.detail,
      ),
    ).toBe(PERMISSIONS.paymentRead);
    for (const action of [
      "claim",
      "retryRefund",
      "confirmRefund",
      "close",
    ] as const) {
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY,
          AdminPaymentExceptionsController.prototype[action],
        ),
      ).toBe(PERMISSIONS.financeReconcile);
    }
  });
});
