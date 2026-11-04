"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.JwtService = void 0;
const jwt = __importStar(require("jsonwebtoken"));
// JWT 工具: 使用 HS256, secret 取自环境变量, 缺失时回退 dev 常量。
// 以静态方法暴露, 便于守卫与服务层直接调用, 不依赖 DI。
const JWT_SECRET = process.env.JWT_SECRET || 'dev-ecom-vision-secret-2024-do-not-use-in-prod';
// 本地 MVP 无 refresh token 机制, 15m 会导致演示中频繁掉登录;
// 演示环境放宽到 7 天 (生产应恢复短 TTL + refresh 机制)。
const ACCESS_TOKEN_TTL = process.env.JWT_TTL || '7d';
class JwtService {
    static sign(payload) {
        return jwt.sign({ sub: payload.sub, email: payload.email, tv: payload.tv ?? 0 }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL, algorithm: 'HS256' });
    }
    static verify(token) {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const tv = decoded.tv == null ? 0 : Number(decoded.tv);
        return { sub: String(decoded.sub), email: String(decoded.email), tv: Number.isFinite(tv) ? tv : 0 };
    }
}
exports.JwtService = JwtService;
//# sourceMappingURL=jwt.service.js.map