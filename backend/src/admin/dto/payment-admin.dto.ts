import { Type } from 'class-transformer';
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
} from 'class-validator';
import { PageQueryDto } from './page-query.dto';
import { PAYMENT_PROVIDER_IDS, PaymentProviderId } from '../../payments/adapters/types';

/** 需要填写变更原因的高危写操作（审计落 reason 列） */
class ReasonedDto {
  @IsString({ message: '请填写变更原因' })
  @MinLength(2, { message: '变更原因至少 2 个字符' })
  @MaxLength(200, { message: '变更原因最多 200 个字符' })
  reason!: string;
}

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

export class PaymentSettingsUpdateDto extends ReasonedDto {
  @IsIn(['CNY', 'USD'], { message: '币种只支持 CNY / USD' })
  defaultCurrency!: 'CNY' | 'USD';
}

export class PaymentProductSaveDto extends ReasonedDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(['credits'], { message: '目前只支持积分商品' })
  kind!: 'credits';

  @IsIn(['CNY', 'USD'], { message: '币种只支持 CNY / USD' })
  currency!: 'CNY' | 'USD';

  /** 售价，整数分 */
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: '售价最低 1 分' })
  priceCents!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  originalPriceCents?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: '积分最低 1' })
  credits!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  creditsValidDays?: number;

  @IsOptional()
  @IsIn(['immediate', 'manual'])
  grantType?: 'immediate' | 'manual';

  @IsIn(['active', 'offline'])
  status!: 'active' | 'offline';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsIn(['unlimited', 'periodic', 'inventory', 'timed'])
  saleStrategy!: 'unlimited' | 'periodic' | 'inventory' | 'timed';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  periodDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  periodPurchaseLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockTotal?: number;

  /** ISO 时间或 `YYYY-MM-DD HH:mm`（按 Asia/Shanghai 解释） */
  @IsOptional()
  @IsString()
  saleStartAt?: string | null;

  @IsOptional()
  @IsString()
  saleEndAt?: string | null;
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
  @IsIn(['created', 'paid', 'credited'])
  timeField?: 'created' | 'paid' | 'credited';

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class PaymentOrderActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class ReconciliationRunDto extends ReasonedDto {
  @IsIn(PAYMENT_PROVIDER_IDS, { message: '渠道非法' })
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

export class ReconciliationImportDto extends ReasonedDto {
  @IsIn(PAYMENT_PROVIDER_IDS, { message: '渠道非法' })
  providerId!: PaymentProviderId;

  @IsString()
  billDate!: string;
}
