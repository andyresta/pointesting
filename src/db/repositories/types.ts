export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface Project {
  id: string;
  name: string;
  baseUrl: string | null;
  defaultProvider: string | null;
  createdAt: Date | null;
}

export interface ProjectCreateData {
  name: string;
  baseUrl?: string | null;
  defaultProvider?: string | null;
}

export type ProjectUpdateData = Partial<ProjectCreateData>;

export interface TestCase {
  id: string;
  projectId: string;
  title: string;
  steps: JsonValue;
  expected: JsonValue;
  source: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface TestCaseCreateData {
  projectId: string;
  title: string;
  steps: JsonValue;
  expected: JsonValue;
  source?: string | null;
}

export interface TestCaseUpdateData {
  projectId?: string;
  title?: string;
  steps?: JsonValue;
  expected?: JsonValue;
  source?: string | null;
}

export type TestRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error';

export interface TestRun {
  id: string;
  testCaseId: string;
  status: TestRunStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  createdAt: Date | null;
}

export interface TestRunCreateData {
  testCaseId: string;
  status?: TestRunStatus;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  durationMs?: number | null;
}

export interface TestRunUpdateData {
  testCaseId?: string;
  status?: TestRunStatus;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  durationMs?: number | null;
}

export type ArtifactType =
  | 'video'
  | 'trace'
  | 'screenshot'
  | 'console_log'
  | 'network_log';

export interface Artifact {
  id: string;
  testRunId: string;
  type: ArtifactType;
  filePath: string;
  sizeBytes: string | null;
  createdAt: Date | null;
}

export interface ArtifactCreateData {
  testRunId: string;
  type: ArtifactType;
  filePath: string;
  sizeBytes?: string | number | null;
}

export interface ArtifactUpdateData {
  testRunId?: string;
  type?: ArtifactType;
  filePath?: string;
  sizeBytes?: string | number | null;
}

export type TestStepResultStatus = 'passed' | 'failed';

export interface TestStepResult {
  id: string;
  testRunId: string;
  stepIndex: number;
  action: string;
  status: TestStepResultStatus;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: Date | null;
}

export interface TestStepResultCreateData {
  testRunId: string;
  stepIndex: number;
  action: string;
  status: TestStepResultStatus;
  errorMessage?: string | null;
  durationMs?: number | null;
}

export interface TestStepResultUpdateData {
  testRunId?: string;
  stepIndex?: number;
  action?: string;
  status?: TestStepResultStatus;
  errorMessage?: string | null;
  durationMs?: number | null;
}
