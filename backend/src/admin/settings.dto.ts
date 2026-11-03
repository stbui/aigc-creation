import { IsArray, IsObject, IsOptional } from "class-validator";

/**
 * 写入系统设置（kv 结构）。
 *
 * ⚠️ 这里**不再逐字段声明校验装饰器** —— 那是「加一项设置要改 4 处」的根源
 * （`SETTING_DEFS` + DTO 装饰器 + 驼峰↔点号映射表 + 前端手写联合类型），
 * 任一处漏改就静默漂移。
 *
 * ⚠️ DTO 必须用值导入 (不能用 `import type`)。
 * `import type` 会在编译期抹掉类的运行时值, 使 design:paramtypes 退化成 Function,
 * ValidationPipe 因此无法识别类型 —— @Body 拿到的是未校验的原始 body,
 * 结果是「请求 200 但 DTO 上一个字段都没生效」, 比直接报错更难排查。
 *
 * 白名单与类型校验在 service 层按 `SETTING_DEFS` 做 —— **未知键直接 400**。
 * 这比此前「白名单静默剥离 → 再报 400 没有需要更新的设置项」的两段式失败更直接：
 * 运营改错键名时会立刻看到是哪个键不认识。
 */
export class UpdateSettingsDto {
  /**
   * 要设置的键值对。键为 `SETTING_DEFS` 的键（如 `upload.maxSizeMb`）。
   *
   * 用 `@IsObject()` 而不是逐字段 —— 值的合法性由 service 按定义校验，
   * 这里只挡「不是一个对象」这一种结构性错误。
   */
  @IsObject()
  settings!: Record<string, unknown>;

  /**
   * 要恢复默认的键。删除 SystemSetting 行即回落代码默认值。
   *
   * 独立于 `settings` 而不是复用它传 undefined —— 「设置为默认值」与
   * 「取消覆盖」在审计上是两件事（前者改了值，后者删了覆盖），
   * 混在一个字段里会让审计的 before/after 语义含糊。
   */
  @IsOptional()
  @IsArray()
  clears?: string[];
}
