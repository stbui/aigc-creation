import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CapabilityParam } from '../constants';
import { VideoResultPane } from '../VideoResultPane';

const params: CapabilityParam[] = [
  {
    key: 'resolution',
    label: '分辨率',
    type: 'enum',
    options: [{ value: '1080P', label: '1080P' }],
  },
];

describe('VideoResultPane', () => {
  it('成功态用 video 播放真实结果，并提供一键下载', () => {
    const { container } = render(
      <VideoResultPane
        source={null}
        submitting={false}
        params={params}
        submittedValues={{ resolution: '1080P' }}
        currentValues={{ resolution: '720P' }}
        result={{
          status: 'succeeded',
          url: '/uploads/generated-video.mp4',
          modality: 'video',
          durationMs: 10_000,
        }}
      />,
    );

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', '/uploads/generated-video.mp4');
    expect(video).toHaveAttribute('controls');
    expect(screen.getByRole('link', { name: '一键下载' })).toHaveAttribute(
      'download',
      'image-to-video.mp4',
    );
    expect(screen.getByText('1080P')).toBeInTheDocument();
  });

  it('失败态展示可读原因，不伪造视频结果', () => {
    const { container } = render(
      <VideoResultPane
        source={null}
        submitting={false}
        params={params}
        submittedValues={{}}
        currentValues={{ resolution: '1080P' }}
        result={{ status: 'failed', errorCode: '42204' }}
      />,
    );

    expect(screen.getByText('视频生成失败')).toBeInTheDocument();
    expect(screen.getByText('暂无可用模型通道，本次未生成视频（积分已退回）')).toBeInTheDocument();
    expect(container.querySelector('video')).not.toBeInTheDocument();
  });
});
