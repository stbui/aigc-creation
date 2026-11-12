/** 未上传原图时的画布占位：演示视频 + 一句话说明。 */
export function LocalRedrawIntro() {
  return (
    <div className="redraw-intro">
      <video
        className="redraw-intro-video"
        src="/static/mp4/local-redraw.mp4"
        poster="/static/mp4/local-redraw-poster.jpg"
        autoPlay
        loop
        muted
        playsInline
        aria-label="局部重绘演示"
      />
      <div className="redraw-intro-copy">
        <strong>局部重绘</strong>
        <p>只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素</p>
      </div>
    </div>
  );
}
