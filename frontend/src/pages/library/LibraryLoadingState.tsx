import { StateSkeleton } from './components';

/** 骨架屏占住 5 列卡片网格的形状, 内容到达时零位移 */
export function LibraryLoadingState() {
  return <StateSkeleton variant="card" count={10} columns={5} />;
}
