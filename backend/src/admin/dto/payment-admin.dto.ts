import { Transform, Type } from "class-transformer";
import {
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
}

export class PaymentSettingsUpdateDto {
  @IsIn(["CNY", "USD"], { message: "币种只支持 CNY / USD" })
  defaultCurrency!: "CNY" | "USD";
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


export class ReconciliationRunDto {
  @IsIn(PAYMENT_PROVIDER_IDS, { message: "渠道非法" })
  providerId!: PaymentProviderId;

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
  billDate!: string;
}
