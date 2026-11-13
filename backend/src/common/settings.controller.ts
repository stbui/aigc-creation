import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

/**
 * C 端读取上传限制。只返回上传域，不转发通用设置集合，避免 payment.* 等
 * 后台配置因为标了 public 就意外出现在公开响应里。
 */
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async read() {
    return { upload: await this.settings.uploadLimits() };
  }
}
