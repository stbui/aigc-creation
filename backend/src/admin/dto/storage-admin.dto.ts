import { IsObject, IsOptional, MaxLength } from 'class-validator';

/**
 * 保存对象存储配置的请求体。
 *
 * values 的键由后端字段定义（STORAGE_CONFIG_FIELDS）为准，这里只做结构校验：
 * values 必须是对象；逐字段的值归一（String）+ 白名单过滤交由
 * StorageService.saveConfig 完成，未知键按字段定义忽略，不进库。
 */
export class SaveStorageConfigDto {
  @IsObject()
  values!: Record<string, string>;
}

/**
 * 用页面草稿做连通性测试的请求体。
 *
 * 与保存共用同一套字段定义；草稿测试不落库、不切换默认后端，只在内存里
 * 构造临时 provider 做一次真实读写。
 */
export class TestStorageDraftDto {
  @IsOptional()
  @IsObject()
  values?: Record<string, string>;
}
