/** 生成任务队列名。生产、测试与验证脚本必须共用这一个名字。 */
export const GENERATION_QUEUE = 'generation-tasks';

export interface GenerationJobData {
  taskId: string;
}
