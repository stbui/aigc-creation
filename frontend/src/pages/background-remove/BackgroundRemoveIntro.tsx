/** 未上传原图时的画布占位：演示视频 + 一句话说明。 */
export function BackgroundRemoveIntro() {
  return (
    <div className="background-remove-stage" aria-label="一键抠图介绍">
      <div className="background-remove-empty">
        <video
          src="/static/mp4/background-remove.mp4"
          poster="/static/mp4/background-remove-poster.jpg"
          autoPlay
          loop
          muted
          playsInline
          aria-label="一键抠图演示"
        />
        <strong>一键抠图</strong>
        <p>上传图片后，自动去除图片背景</p>
      </div>
    </div>
  );
}
