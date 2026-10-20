import { HttpException, HttpStatus } from '@nestjs/common';

// 统一业务异常: 携带业务错误码 code (如 40101 / 40001 / 42201 / 50001)
export class AppError extends HttpException {
  public readonly code: number;

  constructor(code: number, message: string, httpStatus: number = HttpStatus.BAD_REQUEST) {
    super({ code, message }, httpStatus);
    this.code = code;
  }
}
