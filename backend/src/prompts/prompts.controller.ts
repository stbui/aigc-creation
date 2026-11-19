import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { diskStorage } from 'multer';

import { RequirePermission } from '../admin/admin.decorator';
import { PERMISSIONS } from '../admin/permissions';
import { deploymentUploadMaxBytes } from '../common/image-formats';
import { CreatePromptDto, PROMPT_IMAGES_MAX, PromptListQueryDto, UpdatePromptDto } from './dto';
import { PromptsService } from './prompts.service';

/**
 * 配图上传的临时目录。
 *
 * multer 的 `destination` 是装饰器参数，必须在模块加载期确定；这里与手机上传
 * 一样落到系统临时目录，而不是内存 —— 9 张 × 部署硬上限（100MB）同时留在内存
 * 会顶穿单进程。
 */
const PROMPT_UPLOAD_TMP_DIR = join(tmpdir(), 'huojue-prompt-upload');
mkdirSync(PROMPT_UPLOAD_TMP_DIR, { recursive: true });

/**
 * 后台提示词库。
 *
 * 增删改查四件事各自一个端点；列表带分页、关键词、分类、模态与启用状态筛选。
 * 删除为物理删除 —— 提示词没有下游业务引用（C 端尚未接入），
 * 将来接入生成侧后若要保留历史引用，应改为软删除而不是在这里加特例。
 */
@Controller('admin/prompts')
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.promptRead)
  list(@Query() query: PromptListQueryDto) {
    return this.prompts.list(query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.promptRead)
  detail(@Param('id') id: string) {
    return this.prompts.get(id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.promptWrite)
  create(@Body() dto: CreatePromptDto) {
    return this.prompts.create(dto);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.promptWrite)
  update(@Param('id') id: string, @Body() dto: UpdatePromptDto) {
    return this.prompts.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.promptWrite)
  remove(@Param('id') id: string) {
    return this.prompts.remove(id);
  }

  /**
   * 批量上传配图（multipart，字段名 `files`，最多 9 张）。
   *
   * 与 `PATCH /:id` 同权限；返回稳定引用与预览地址，由前端随条目保存时一起提交。
   */
  @Post('upload')
  @RequirePermission(PERMISSIONS.promptWrite)
  @UseInterceptors(
    FilesInterceptor('files', PROMPT_IMAGES_MAX, {
      storage: diskStorage({
        destination: PROMPT_UPLOAD_TMP_DIR,
        filename: (_req, _file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
      }),
      // multer 只挡部署硬上限；站点配置的动态上限由 service 校验。
      limits: { fileSize: deploymentUploadMaxBytes(), files: PROMPT_IMAGES_MAX },
    }),
  )
  async upload(
    @UploadedFiles() files: Array<{ path?: string; originalname?: string }> | undefined,
  ) {
    try {
      return await this.prompts.uploadImages(files);
    } finally {
      // 无论校验成功与否，请求结束即清理临时文件。
      await Promise.all(
        (files ?? []).map((file) => (file.path ? unlink(file.path).catch(() => undefined) : null)),
      );
    }
  }
}
