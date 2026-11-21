/** 未上传原图时的画布占位：演示视频 + 一句话说明。 */
export function LocalRedrawIntro() {
  return (
    <div
      className="redraw-intro flex-none! w-[min(100%,720px)] m-auto gap-8! bg-transparent!"
    >
      <video
        className="redraw-intro-video block w-[480px] max-w-full flex-none h-[480px] bg-[var(--surface-2)] object-cover"
        src="/static/mp4/local-redraw.mp4"
        poster="/static/mp4/local-redraw-poster.jpg"
        autoPlay
        loop
        muted
        playsInline
        aria-label="局部重绘演示"
      />
      <div className="redraw-intro-copy gap-2!">
        <strong className="text-sm leading-5 font-bold text-[color:var(--wb-text)]">局部重绘</strong>
        <p className="m-0 max-w-[692px] text-xs leading-5 text-[color:var(--text-desc)]!">
          只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素
        </p>
      </div>
    </div>
  );
}
