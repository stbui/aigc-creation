/**
 * 用户自定义渠道的两个接口。
 *
 * · `ANY /api/v1/ai/custom` —— 用户自带上游地址与密钥的中转，本系统只转发；
 * · `POST /api/v1/ai/models` —— 用用户自己的地址与密钥拉一次上游模型清单，
 *   供「自定义渠道」表单的模型下拉使用。
 *
 * 为什么 `ai/custom` 要把请求体当原始字节读：多模态请求动辄数 MB（base64
 * 内嵌参考图），全局 JSON body-parser 的 100KB 上限会在业务代码之前就 413。
 * `main.ts` 用 `isProxyRequestPath` 让中转路径跳过全局解析，由这里按
 * `MODEL_PROXY_CUSTOM_REQUEST_MB` 自行读取。
 *
 * `ai/models` 是**普通业务接口**（请求体只有几百字节，走 DTO 校验），
 * 因此被 `isProxyRequestPath` 显式排除在跳过解析的名单之外。
 */

import { All, Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Allow, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { RateLimit } from '../../common/rate-limit.guard';
import { ModelDomainError } from '../domain/json';
import { normalizeOutboundHeaders, OutboundError, type OutboundHeader } from '../infra/outbound';
import { CUSTOM_RELAY_FORMAT_HEADER, CUSTOM_RELAY_HEADERS_HEADER, CUSTOM_RELAY_KEY_HEADER, CUSTOM_RELAY_URL_HEADER } from './proxy.constants';
import { readProxyLimits } from './proxy.config';
import { ProxyBodyTooLargeError, readProxyBody, writeProxyError } from './proxy.http';
import { CustomRelayService } from './custom-relay.service';

/** 自定义中转限流（`MODEL_PROXY_CUSTOM_RATE_LIMIT` 可覆盖） */
const CUSTOM_RATE_LIMIT = { limit: 60, windowSec: 60 };

/** 拉取上游模型目录：目录很小，30 次/分足够人工点击与脚本试错 */
const MODELS_RATE_LIMIT = { limit: 30, windowSec: 60 };

/** 用自定义地址拉取上游模型目录的入参 */
export class CustomCatalogDto {
  /** 上游 Base URL（不含 `/models`） */
  @IsString() @MaxLength(2048) baseUrl: string;
  /** 上游密钥（只在本次请求内使用，不落库、不写日志） */
  @IsString() @MaxLength(512) apiKey: string;
  /** 目录形态：openai = `GET {base}/models`；gemini = `GET {base}/v1beta/models` */
  @IsOptional() @IsIn(['openai', 'gemini']) apiFormat?: string;
  /** 附加出站头（与渠道配置同构：`[{name,value}]`） */
  @IsOptional() @Allow() headers?: unknown;
}

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class CustomRelayController {
  constructor(
    private readonly config: ConfigService,
    private readonly relay: CustomRelayService,
  ) {}

  /** 自定义渠道中转 */
  @All('custom')
  @RateLimit({
    scope: 'user',
    name: 'proxy-custom',
    limitEnv: 'MODEL_PROXY_CUSTOM_RATE_LIMIT',
    ...CUSTOM_RATE_LIMIT,
  })
  async proxy(@Req() req: Request & { user?: { id: string } }, @Res() res: Response): Promise<void> {
    const limits = readProxyLimits(this.config);
    let body: Buffer;
    try {
      body = await readProxyBody(req, limits.customRequestBytes);
    } catch (error) {
      if (error instanceof ProxyBodyTooLargeError) {
        writeProxyError(res, 413, 40001, `请求体超过自定义渠道上限（${Math.round(limits.customRequestBytes / 1024 / 1024)}MB）`);
        req.resume();
        return;
      }
      writeProxyError(res, 400, 40001, messageOf(error) || '请求体读取失败');
      return;
    }

    await this.relay.relay({
      userId: String(req.user?.id ?? ''),
      method: String(req.method ?? ''),
      headers: req.headers as Record<string, string | undefined>,
      query: new URLSearchParams(String(req.originalUrl ?? '').split('?')[1] ?? ''),
      contentType: headerText(req.headers['content-type']),
      accept: headerText(req.headers['accept']),
      body,
      res,
    });
  }

  /** 拉取自定义渠道的上游模型目录（不落库，仅回显供表单选型） */
  @Post('models')
  @HttpCode(200)
  @RateLimit({ scope: 'user', name: 'proxy-custom-models', ...MODELS_RATE_LIMIT })
  async models(@Body() body: CustomCatalogDto) {
    const models = await this.relay.listModels({
      baseUrl: String(body?.baseUrl ?? ''),
      apiKey: String(body?.apiKey ?? ''),
      apiFormat: String(body?.apiFormat ?? 'openai'),
      headers: toHeaders(body?.headers),
    });
    return { models };
  }
}

/** 附加出站头走统一规范化（拒绝 `host` / `x-forwarded-*` / `x-canvas-*` 等） */
function toHeaders(raw: unknown): OutboundHeader[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ModelDomainError('headers 必须是 [{name,value}] 数组');
  try {
    return normalizeOutboundHeaders(
      raw.map((item: any) => ({ name: String(item?.name ?? ''), value: String(item?.value ?? '') })),
    );
  } catch (error) {
    throw new ModelDomainError(error instanceof OutboundError ? error.message : '附加请求头无效');
  }
}

function headerText(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}
