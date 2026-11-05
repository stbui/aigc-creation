import { describe, expect, it } from "vitest";

import {
  AUDIT_ACTION_KEY,
  PERMISSION_KEY,
} from "../admin.decorator";
import { PERMISSIONS } from "../permissions";
import {
  AdminPaymentExceptionsController,
  AdminPaymentOrdersController,
} from "./payment-admin.controller";

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
    expect(
      Reflect.getMetadata(
        AUDIT_ACTION_KEY,
        AdminPaymentOrdersController.prototype.export,
      ),
    ).toBe("data.export");
  });

  it("查单与关单均使用支付操作权限并写入审计", () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        AdminPaymentOrdersController.prototype.query,
      ),
    ).toBe(PERMISSIONS.paymentOperate);
    expect(
      Reflect.getMetadata(
        AUDIT_ACTION_KEY,
        AdminPaymentOrdersController.prototype.query,
      ),
    ).toBe("payment.order_query");
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        AdminPaymentOrdersController.prototype.close,
      ),
    ).toBe(PERMISSIONS.paymentOperate);
    expect(
      Reflect.getMetadata(
        AUDIT_ACTION_KEY,
        AdminPaymentOrdersController.prototype.close,
      ),
    ).toBe("payment.order_close");
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
    for (const action of ["claim", "retryRefund", "close"] as const) {
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY,
          AdminPaymentExceptionsController.prototype[action],
        ),
      ).toBe(PERMISSIONS.financeReconcile);
      expect(
        Reflect.getMetadata(
          AUDIT_ACTION_KEY,
          AdminPaymentExceptionsController.prototype[action],
        ),
      ).toMatch(/^payment\.exception_/);
    }
  });
});
