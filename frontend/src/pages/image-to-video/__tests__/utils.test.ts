import { describe, expect, it } from 'vitest';

import type { CapabilityParam } from '../constants';
import {
  buildImageToVideoPayload,
  isVideoFormReady,
  videoConfigSummary,
  videoEnumParams,
  videoOptionLabel,
  videoParamDefaults,
  videoTextParams,
  videoTaskErrorText,
} from '../utils';

const backendParams: CapabilityParam[] = [
  {
    key: 'prompt',
    label: '动态描述',
    type: 'text',
    placeholder: '描述镜头如何运动',
  },
  {
    key: 'motion',
    label: '运动幅度',
    type: 'enum',
    default: 'normal',
    options: [
      { value: 'static', label: '静止' },
      { value: 'slow', label: '缓慢' },
      { value: 'normal', label: '标准' },
      { value: 'dynamic', label: '强烈' },
    ],
  },
  {
    key: 'duration',
    label: '视频时长',
    type: 'enum',
    default: 6,
    options: [
      { value: 6, label: '6 秒' },
      { value: 10, label: '10 秒' },
    ],
  },
  {
    key: 'resolution',
    label: '分辨率',
    type: 'enum',
    default: '1080P',
    options: [
      { value: '720P', label: '720P' },
      { value: '1080P', label: '1080P' },
      { value: '2K', label: '2K' },
    ],
  },
];

describe('videoParamDefaults', () => {
  it('把后端默认值统一转成表单字符串', () => {
    expect(videoParamDefaults(backendParams)).toEqual({
      motion: 'normal',
      duration: '6',
      resolution: '1080P',
    });
  });

  it('不把隐藏参数或没有默认值的参数放进表单', () => {
    const params: CapabilityParam[] = [
      { key: 'prompt', label: '动态描述', type: 'text' },
      { key: 'internalRoute', label: '内部线路', type: 'text', default: 'route-a', hidden: true },
    ];

    expect(videoParamDefaults(params)).toEqual({});
  });
});

describe('能力参数分组', () => {
  it('只返回可渲染的文本与枚举参数', () => {
    const params: CapabilityParam[] = [
      ...backendParams,
      { key: 'seed', label: '种子', type: 'number', default: 1 },
      { key: 'hidden', label: '隐藏项', type: 'text', hidden: true },
    ];

    expect(videoTextParams(params).map((param) => param.key)).toEqual(['prompt']);
    expect(videoEnumParams(params).map((param) => param.key)).toEqual([
      'motion',
      'duration',
      'resolution',
    ]);
  });
});

describe('isVideoFormReady', () => {
  it('接受空动态描述，但要求所有枚举值有效', () => {
    expect(
      isVideoFormReady(backendParams, {
        prompt: '',
        motion: 'normal',
        duration: '6',
        resolution: '1080P',
      }),
    ).toBe(true);
  });

  it('枚举值不在后端选项内时拒绝提交', () => {
    expect(
      isVideoFormReady(backendParams, {
        prompt: '镜头缓慢推进',
        motion: 'extreme',
        duration: '6',
        resolution: '1080P',
      }),
    ).toBe(false);
  });

  it('缺少枚举值时拒绝提交', () => {
    expect(
      isVideoFormReady(backendParams, {
        motion: 'normal',
        duration: '6',
      }),
    ).toBe(false);
  });

  it('能力参数尚未就绪时不按前端臆造值放行', () => {
    expect(isVideoFormReady([], {})).toBe(false);
  });
});

describe('buildImageToVideoPayload', () => {
  it('只提交能力清单声明的字段，并保留空 prompt', () => {
    const payload = buildImageToVideoPayload(backendParams, {
      prompt: '   ',
      motion: 'slow',
      duration: '10',
      resolution: '2K',
      unrelated: '不应提交',
    });

    expect(payload).toEqual({
      prompt: '',
      motion: 'slow',
      duration: '10',
      resolution: '2K',
    });
  });

  it('按参数声明转换数字与布尔值，并跳过隐藏字段', () => {
    const params: CapabilityParam[] = [
      { key: 'duration', label: '时长', type: 'number' },
      { key: 'watermark', label: '水印', type: 'boolean' },
      { key: 'internalRoute', label: '内部线路', type: 'text', hidden: true },
    ];

    expect(
      buildImageToVideoPayload(params, {
        duration: '10',
        watermark: 'true',
        internalRoute: 'route-a',
      }),
    ).toEqual({ duration: 10, watermark: true });
  });

  it('参数定义为空时返回空对象', () => {
    expect(buildImageToVideoPayload([], { prompt: '镜头推进' })).toEqual({});
  });
});

describe('结果摘要', () => {
  it('按后端选项把枚举值转成可读标签', () => {
    expect(videoOptionLabel(backendParams[2], '10')).toBe('10 秒');
    expect(videoOptionLabel(backendParams[2], 'unknown')).toBe('unknown');
  });

  it('摘要顺序跟随能力定义，不跟随表单对象键顺序', () => {
    expect(
      videoConfigSummary(backendParams, {
        resolution: '720P',
        duration: '6',
        motion: 'dynamic',
      }),
    ).toEqual(['强烈', '6 秒', '720P']);
  });
});

describe('videoTaskErrorText', () => {
  it('保留共享错误码与退款语义，但把产出名词校正为视频', () => {
    expect(videoTaskErrorText('42204')).toBe(
      '暂无可用模型通道，本次未生成视频（积分已退回）',
    );
    expect(videoTaskErrorText('POLL_TIMEOUT')).toContain('任务可能仍在后台生成');
  });
});

describe('参数来源', () => {
  it('页面辅助函数使用传入的能力定义，而不是页面内硬编码枚举', () => {
    const customParams: CapabilityParam[] = [
      {
        key: 'motion',
        label: '镜头运动',
        type: 'enum',
        default: 'orbit',
        options: [
          { value: 'orbit', label: '环绕' },
          { value: 'push', label: '推进' },
        ],
      },
    ];

    expect(videoParamDefaults(customParams)).toEqual({ motion: 'orbit' });
    expect(videoConfigSummary(customParams, { motion: 'push' })).toEqual(['推进']);
    expect(isVideoFormReady(customParams, { motion: 'push' })).toBe(true);
  });
});
