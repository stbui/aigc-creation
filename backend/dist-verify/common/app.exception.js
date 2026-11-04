"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
const common_1 = require("@nestjs/common");
// 统一业务异常: 携带业务错误码 code (如 40101 / 40001 / 42201 / 50001)
class AppError extends common_1.HttpException {
    constructor(code, message, httpStatus = common_1.HttpStatus.BAD_REQUEST) {
        super({ code, message }, httpStatus);
        this.code = code;
    }
}
exports.AppError = AppError;
//# sourceMappingURL=app.exception.js.map