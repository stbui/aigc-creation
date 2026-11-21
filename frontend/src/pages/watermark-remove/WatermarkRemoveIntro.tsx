/** 未上传原图时的画布占位：演示视频 + 一句话说明。 */
export function WatermarkRemoveIntro() {
  return (
    <div
      className="redraw-intro flex-none! w-[min(100%,720px)] m-auto gap-8! bg-transparent!"
      aria-label="去除水印介绍"
    >
      <video
        className="redraw-intro-video block w-[480px] max-w-full flex-none h-[480px] bg-[var(--surface-2)] object-cover"
        src="/static/mp4/03_qcsy.mp4"
        poster="/static/mp4/03_qcsy-poster.jpg"
        autoPlay
        loop
        muted
        playsInline
        aria-label="去除水印演示"
      />
      <div className="redraw-intro-copy">
        <strong className="text-sm leading-5 font-bold text-[color:var(--wb-text)]">
          去除水印
        </strong>
        <p className="m-0 max-w-[692px] text-xs leading-5 text-[color:var(--text-desc)]!">
          框选、圈选或涂抹水印区域，即可去除图片中的水印
        </p>
      </div>
    </div>
  );
}
