import { MattingResultEditor } from './components';

interface BackgroundResultPaneProps {
  resultUrl: string;
  originalUrl: string;
  selectedColor: string;
  customColor: string;
  customAlpha: number;
  outputRatio: string;
}

/** 抠图结果面板：换底色 / 对比原图 / 下载。 */
export function BackgroundResultPane({
  resultUrl,
  originalUrl,
  selectedColor,
  customColor,
  customAlpha,
  outputRatio,
}: BackgroundResultPaneProps) {
  return (
    <section className="pk-result-pane pk-result-pane-editor">
      <MattingResultEditor
        resultUrl={resultUrl}
        originalUrl={originalUrl}
        selectedColor={selectedColor}
        customColor={customColor}
        customAlpha={customAlpha}
        outputRatio={outputRatio}
      />
    </section>
  );
}
