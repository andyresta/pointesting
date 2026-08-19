import type {
  SuiteAnalysisResultRecord,
  TestRunStatus,
  TestStepResultStatus,
} from '../db/repositories/types';
import type { ProviderName } from '../config/env';
import type { AnalysisResult } from '../analyzer/provider.interface';

export interface RunStatusEvent {
  type: 'run:status';
  runId: string;
  status: TestRunStatus;
}

export interface RunFrameEvent {
  type: 'run:frame';
  runId: string;
  frame: string;
  timestamp: string;
  action?: string;
}

export interface GenerateStatusEvent {
  type: 'generate:status';
  runId: string;
  phase: string;
  message: string;
}

export interface GenerateDoneEvent {
  type: 'generate:done';
  runId: string;
  testCases: Array<{
    id: string;
    title: string;
    description: string | null;
  }>;
}

export interface GenerateErrorEvent {
  type: 'generate:error';
  runId: string;
  message: string;
}

/** Field form dinamis untuk pause input auth saat generate. */
export interface GenerateNeedInputField {
  key: string;
  label: string;
  selectorHint: string;
  secret?: boolean;
  inputType?: string;
}

export interface GenerateNeedInputEvent {
  type: 'generate:need-input';
  runId: string;
  zoneId: string;
  pageUrl: string;
  pageTitle: string;
  message: string;
  fields: GenerateNeedInputField[];
  allowSkip: boolean;
}

export interface RunStepEvent {
  type: 'run:step';
  runId: string;
  stepIndex: number;
  action: string;
  status: TestStepResultStatus;
  testCaseId?: string;
  testRunId?: string;
}

export interface RunSuiteCaseEvent {
  type: 'run:suite-case';
  runId: string;
  testCaseId: string;
  testRunId: string;
  status: TestRunStatus;
  caseIndex: number;
  caseTotal: number;
}

export interface RunSuiteDoneEvent {
  type: 'run:suite-done';
  runId: string;
  status: TestRunStatus;
  results: Array<{
    testCaseId: string;
    testRunId: string;
    status: TestRunStatus;
  }>;
}

export interface RunAnalysisEvent {
  type: 'run:analysis';
  runId: string;
  analysisResult: AnalysisResult & { provider: ProviderName };
}

/**
 * Keterangan: Hasil Suite Analysis (analisis lintas-fitur) dikirim ke
 * subscriber suiteRunId setelah semua test case dalam suite selesai
 * dieksekusi DAN semua analysis_result individualnya siap (atau timeout).
 */
export interface SuiteAnalysisEvent {
  type: 'suite:analysis';
  runId: string;
  result: SuiteAnalysisResultRecord;
}

export interface SuiteAnalysisErrorEvent {
  type: 'suite:analysis-error';
  runId: string;
  message: string;
}

export type RunServerEvent =
  | RunStatusEvent
  | RunFrameEvent
  | RunStepEvent
  | RunSuiteCaseEvent
  | RunSuiteDoneEvent
  | RunAnalysisEvent
  | SuiteAnalysisEvent
  | SuiteAnalysisErrorEvent
  | GenerateStatusEvent
  | GenerateDoneEvent
  | GenerateErrorEvent
  | GenerateNeedInputEvent;

export interface SubscribeRunEvent {
  type: 'subscribe:run';
  runId: string;
}

export interface UnsubscribeRunEvent {
  type: 'unsubscribe:run';
  runId: string;
}

export type RunClientEvent = SubscribeRunEvent | UnsubscribeRunEvent;
