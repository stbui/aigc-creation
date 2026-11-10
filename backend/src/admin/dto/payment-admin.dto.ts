import { Transform, Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { PageQueryDto } from "./page-query.dto";
import {
  PAYMENT_PROVIDER_IDS,
  PAYMENT_SOURCES,
  PaymentProviderId,
} from "../../payments/adapters/types";

export class PaymentProviderConfigUpdateDto {
  @IsBoolean()
  enabled!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  closeAfterMinutes!: number;

  @IsObject()
  values!: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === "" ? null : Number(value)))
  @IsInt()
  @Min(0)
  minAmountCents?: number | null;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === "" ? null : Number(value)))
  @IsInt()
  @Min(0)
  maxAmountCents?: number | null;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === "" ? null : Number(value)))
  @IsInt()
  @Min(0)
  dailyLimitCents?: number | null;

  @IsOptional()
  @IsBoolean()
  refundEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(["alipay", "wechat"], { each: true })
  paymentMethods?: Array<"alipay" | "wechat">;
}

export class PaymentProviderInstanceCreateDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string | null;

  @IsOptional()
  @IsObject()
  values?: Record<string, string>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  closeAfterMinutes?: number;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === "" ? null : Number(value)))
  @IsInt()
  @Min(0)
  minAmountCents?: number | null;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === "" ? null : Number(value)))
  @IsInt()
  @Min(0)
  maxAmountCents?: number | null;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === "" ? null : Number(value)))
  @IsInt()
  @Min(0)
  dailyLimitCents?: number | null;

  @IsOptional()
  @IsBoolean()
  refundEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(["alipay", "wechat"], { each: true })
  paymentMethods?: Array<"alipay" | "wechat">;
}

export class PaymentProviderInstanceOrderDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  instanceIds!: string[];
}

export class PaymentSettingsUpdateDto {
  @IsOptional()
  @IsIn(["CNY", "USD"], { message: "币种只支持 CNY / USD" })
  defaultCurrency?: "CNY" | "USD";

  @IsOptional()
  @IsIn(PAYMENT_SOURCES, { message: "支付宝来源只支持 unset / official / epay" })
  alipaySource?: "unset" | "official" | "epay";

  @IsOptional()
  @IsIn(PAYMENT_SOURCES, { message: "微信来源只支持 unset / official / epay" })
  wechatSource?: "unset" | "official" | "epay";
}

export class PaymentOrderListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsIn(["created", "paid", "credited"])
  timeField?: "created" | "paid" | "credited";

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class PaymentExceptionListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(["open", "auto_refund_pending", "refunded", "manual_review", "closed", "all"])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  providerId?: string;

  @IsOptional()
  @IsIn(["urgent", "normal"])
  priority?: "urgent" | "normal";

  @IsOptional()
  @Transform(({ value }) => value === true || value === "true" || value === "1")
  @IsBoolean()
  overdue?: boolean;
}

export class PaymentExceptionCloseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  resolution!: string;
}

export class PaymentExceptionConfirmRefundDto {
  @IsIn(["succeeded", "failed"], { message: "核销结果只支持 succeeded / failed" })
  outcome!: "succeeded" | "failed";

  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerRefundId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}


export class ReconciliationRunDto {
  @IsIn(PAYMENT_PROVIDER_IDS, { message: "渠道非法" })
  providerId!: PaymentProviderId;

  @IsString()
  @MinLength(1)
  providerInstanceId!: string;

  @IsString()
  billDate!: string;

  @IsOptional()
  @IsBoolean()
  retryFailed?: boolean;
}

export class ReconciliationListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  providerInstanceId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class ReconciliationItemsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  result?: string;
}

export class ReconciliationImportDto {
  @IsIn(PAYMENT_PROVIDER_IDS, { message: "渠道非法" })
  providerId!: PaymentProviderId;

  @IsString()
  @MinLength(1)
  providerInstanceId!: string;

  @IsString()
  billDate!: string;
}
