/** 未上传原图时的画布占位：演示视频 + 一句话说明。 */
export function WatermarkRemoveIntro() {
  return (
    <div className="redraw-intro" aria-label="去除水印介绍">
      <video
        className="redraw-intro-video"
        src="/static/mp4/03_qcsy.mp4"
        poster="/static/mp4/03_qcsy-poster.jpg"
        autoPlay
        loop
        muted
        playsInline
        aria-label="去除水印演示"
      />
      <div className="redraw-intro-copy">
        <strong>去除水印</strong>
        <p>框选、圈选或涂抹水印区域，即可去除图片中的水印</p>
      </div>
    </div>
  );
}
