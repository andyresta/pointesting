import type { TraceSummary } from './types';

export interface HistoricalContext {
  avgDurationMs: number;
  avgResponseTimeMs: number;
  currentDurationMs: number;
  currentResponseTimeMs: number;
  sampleSize: number;
}

export interface HealingEvent {
  stepIndex: number;
  oldSelector: string;
  newSelector: string;
}

export interface AnalyzerInput {
  expected: string[];
  consoleLogSummary: string;
  networkLogSummary: string;
  screenshots?: Buffer[];
  traceSummary: TraceSummary;
  historicalContext?: HistoricalContext;
  healingEvents?: HealingEvent[];
}

export interface AnalysisResult {
  status: 'success' | 'fail' | 'bug' | 'anomaly';
  reason?: string;
  detail?: string;
  solution?: string;
}

export interface AnalyzerProvider {
  name: string;
  supportsImage: boolean;
  analyze(input: AnalyzerInput): Promise<AnalysisResult>;
}
