import type {
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

export interface RunStepEvent {
  type: 'run:step';
  runId: string;
  stepIndex: number;
  action: string;
  status: TestStepResultStatus;
}

export interface RunAnalysisEvent {
  type: 'run:analysis';
  runId: string;
  analysisResult: AnalysisResult & { provider: ProviderName };
}

export type RunServerEvent =
  | RunStatusEvent
  | RunFrameEvent
  | RunStepEvent
  | RunAnalysisEvent
  | GenerateStatusEvent
  | GenerateDoneEvent
  | GenerateErrorEvent;

export interface SubscribeRunEvent {
  type: 'subscribe:run';
  runId: string;
}

export interface UnsubscribeRunEvent {
  type: 'unsubscribe:run';
  runId: string;
}

export type RunClientEvent = SubscribeRunEvent | UnsubscribeRunEvent;
