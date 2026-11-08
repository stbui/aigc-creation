/** 任务的一次线路派发尝试快照，按 routeRun / attemptNumber 升序排列。 */
export interface AdminTaskRouteAttempt {
  id: string;
  routeRun: number;
  attemptNumber: number;
  logicalModelId: string;
  logicalModelRevisionId: string;
  routeId: string;
  channelId: string;
  channelModelId: string;
  status: 'selected' | 'dispatching' | 'succeeded' | 'failed';
  dispatchState: 'not_sent' | 'submission_unknown' | 'accepted' | 'rejected_no_job';
  providerRequestId: string;
  failureCode: string;
  failureMessage: string;
  startedAt: string;
  completedAt: string | null;
}
