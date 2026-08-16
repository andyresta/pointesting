export interface TraceActionSummary {
  name: string;
  startOffsetMs: number;
  durationMs: number;
  status: 'passed' | 'failed';
  error?: string;
}

export interface TraceSummary {
  totalDurationMs: number;
  totalActions: number;
  failedActions: number;
  actions: TraceActionSummary[];
  truncated: boolean;
  traceFileCount: number;
  malformedEventCount: number;
}
