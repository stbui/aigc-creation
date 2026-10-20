import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import {
  SETTING_DEFS,
  SETTING_GROUP_LABELS,
  findSettingDef,
  type SettingDef,
} from './settings.dto';

/**
 * 系统设置。
 *
 * 优先级链 (与通道配置同构):
 *   代码默认值 (本文件)  →  DB 运行时覆盖 (SystemSetting 表)
 * 后台写入的是 DB 覆盖值, 重启后仍生效; 若将来改为环境变量控制,
 * 需在界面明示「环境变量优先级更高」—— 目前本项目尚无对应环境变量。
 */
@Injectable()
export class AdminSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 分组读取全部设置项 + 当前生效值 */
  async readAll() {
    const rows = await this.prisma.systemSetting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    const groups: Record<
      string,
      { key: string; label: string; items: Array<SettingDef & { value: string | number | boolean; overridden: boolean }> }
    > = {};

    for (const def of SETTING_DEFS) {
      const raw = byKey.get(def.key);
      const overridden = raw !== undefined;
      const group = (groups[def.key.split('.')[0]] ??= {
        key: def.key.split('.')[0],
        label: SETTING_GROUP_LABELS[def.group],
        items: [],
      });
      group.items.push({
        ...def,
        value: overridden ? this.parseValue(raw as string, def) : def.default,
        overridden,
      });
    }

    return { groups: Object.values(groups) };
  }

  /**
   * 批量写入。
   *
   * 逐项按 SettingDef 校验后写入, **不是直接接收任意 kv** ——
   * 否则运营可以写进一个代码里根本不认识的键, 或写入超出取值范围的值,
   * 后续读取时静默出错。
   */
  async updateAll(
    settings: Record<string, unknown>,
    reason?: string,
  ): Promise<{ updated: string[] }> {
    const entries = Object.entries(settings ?? {});
    if (entries.length === 0) {
      throw new AppError(40001, '没有需要更新的设置项', 400);
    }

    // 先全部校验再落库: 部分成功会让运营误以为整批生效
    const normalized = entries.map(([key, value]) => {
      const def = findSettingDef(key);
      if (!def) throw new AppError(40001, `未知设置项: ${key}`, 400);
      if (def.readOnly) throw new AppError(40001, `${def.label} 为只读项, 不可修改`, 400);
      return { key, value: this.validate(def, value) };
    });

    const actorNote = reason ? ` | ${reason}` : '';
    for (const { key, value } of normalized) {
      const existing = await this.prisma.systemSetting.findUnique({ where: { key } });
      if (existing) {
        await this.prisma.systemSetting.update({
          where: { key },
          data: { value: String(value), updatedBy: 'admin' },
        });
      } else {
        await this.prisma.systemSetting.create({
          data: { key, value: String(value), updatedBy: 'admin' },
        });
      }
    }

    return { updated: normalized.map((n) => n.key) };
  }

  /** 读取单个设置的有效值 (供业务代码消费) */
  async get<T = string | number | boolean>(key: string): Promise<T> {
    const def = findSettingDef(key);
    if (!def) throw new AppError(40400, `未知设置项: ${key}`, 404);
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!row) return def.default as T;
    return this.parseValue(row.value, def) as T;
  }

  /** 按 SettingDef 校验并归一化值 */
  private validate(def: SettingDef, raw: unknown): string | number | boolean {
    if (def.type === 'boolean') {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new AppError(40001, `${def.label} 必须是布尔值`, 400);
    }

    if (def.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new AppError(40001, `${def.label} 必须是数字`, 400);
      }
      if (def.min !== undefined && n < def.min) {
        throw new AppError(40001, `${def.label} 不得小于 ${def.min}`, 400);
      }
      if (def.max !== undefined && n > def.max) {
        throw new AppError(40001, `${def.label} 不得大于 ${def.max}`, 400);
      }
      return n;
    }

    const s = String(raw ?? '').trim();
    if (def.maxLength !== undefined && s.length > def.maxLength) {
      throw new AppError(40001, `${def.label} 长度不得超过 ${def.maxLength}`, 400);
    }
    return s;
  }

  /**
   * 解析库里的字符串值为目标类型。
   *
   * 存量数据可能格式不合法 (手工改过库), 此时回退到代码默认值 ——
   * 一个坏配置不应让整页设置加载失败。
   */
  private parseValue(raw: string, def: SettingDef): string | number | boolean {
    try {
      return this.validate(def, raw);
    } catch {
      return def.default;
    }
  }
}