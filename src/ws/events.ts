import type {
  TestRunStatus,
  TestStepResultStatus,
} from '../db/repositories/types';

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
  analysisResult: unknown;
}

export type RunServerEvent =
  | RunStatusEvent
  | RunFrameEvent
  | RunStepEvent
  | RunAnalysisEvent;

export interface SubscribeRunEvent {
  type: 'subscribe:run';
  runId: string;
}

export interface UnsubscribeRunEvent {
  type: 'unsubscribe:run';
  runId: string;
}

export type RunClientEvent = SubscribeRunEvent | UnsubscribeRunEvent;
