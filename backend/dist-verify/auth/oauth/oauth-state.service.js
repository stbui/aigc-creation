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
exports.OAuthStateService = void 0;
const jwt = __importStar(require("jsonwebtoken"));
/**
 * OAuth state 与回调后的短时登录票。
 *
 * state 是浏览器跳转期间防 CSRF 的一次性凭据；登录票是「provider 回调 →
 * 前端登录完成页」之间的短时接力凭据，避免把 7 天的 accessToken 放进 URL。
 */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-ecom-vision-secret-2024-do-not-use-in-prod';
const STATE_TTL = '10m';
const TICKET_TTL = '60s';
class OAuthStateService {
    signState(payload) {
        return jwt.sign(payload, JWT_SECRET, { expiresIn: STATE_TTL, algorithm: 'HS256' });
    }
    verifyState(token, provider) {
        let payload;
        try {
            payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        }
        catch {
            throw new Error('OAuth state 无效或已过期，请重新发起登录');
        }
        const decoded = payload;
        if (!decoded.provider || decoded.provider !== provider) {
            throw new Error('OAuth state 与 provider 不匹配，请重新发起登录');
        }
        return {
            provider: String(decoded.provider),
            returnTo: decoded.returnTo ? String(decoded.returnTo) : undefined,
        };
    }
    signTicket(payload) {
        return jwt.sign(payload, JWT_SECRET, { expiresIn: TICKET_TTL, algorithm: 'HS256' });
    }
    verifyTicket(token) {
        let payload;
        try {
            payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        }
        catch {
            throw new Error('OAuth 登录票无效或已过期，请重新登录');
        }
        const decoded = payload;
        if (!decoded.sub)
            throw new Error('OAuth 登录票缺少用户标识');
        return { sub: String(decoded.sub), provider: String(decoded.provider ?? '') };
    }
}
exports.OAuthStateService = OAuthStateService;
//# sourceMappingURL=oauth-state.service.js.map