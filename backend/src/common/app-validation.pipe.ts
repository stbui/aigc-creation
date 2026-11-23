import { Injectable, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { AppError } from './app.exception';

/**
 * 返回用户可读的第一条校验消息。
 *
 * class-validator 的嵌套错误保留在 children 中，DTO 上的字段名和内部类型不应
 * 直接进入响应文案。异常工厂只取约束中的中文消息，找不到时使用稳定兜底文案。
 */
function firstConstraintMessage(errors: readonly ValidationError[]): string | undefined {
  for (const error of errors) {
    const message = Object.values(error.constraints ?? {})[0];
    if (message) return message;

    if (error.children?.length) {
      const nested = firstConstraintMessage(error.children);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function firstValidationMessage(errors: readonly ValidationError[]): string {
  return firstConstraintMessage(errors) ?? '参数校验失败';
}

/** 应用级 DTO 校验管道；通过 AppModule 的 APP_PIPE 注册。 */
@Injectable()
export class AppValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      exceptionFactory: (errors) =>
        new AppError(40001, firstValidationMessage(errors), 400),
    });
  }
}
