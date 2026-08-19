import type { ProviderName } from '../../config/env';

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
  instruction: string | null;
  extraData: string | null;
  createdAt: Date | null;
}

export interface ProjectCreateData {
  name: string;
  baseUrl?: string | null;
  defaultProvider?: string | null;
  instruction?: string | null;
  extraData?: string | null;
}

export type ProjectUpdateData = Partial<ProjectCreateData>;

export interface ProjectProviderPublic {
  provider: ProviderName;
  hasApiKey: boolean;
  apiKeyMasked: string;
  defaultModel: string | null;
  sortOrder: number;
}

export interface ProjectProviderSecret {
  provider: ProviderName;
  apiKey: string;
  defaultModel: string | null;
  sortOrder: number;
}

export interface ProjectProviderWrite {
  provider: ProviderName;
  apiKey?: string;
  defaultModel?: string | null;
  remove?: boolean;
}

export interface ProjectWithProviders extends Project {
  providers: ProjectProviderPublic[];
}

export interface TestCase {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  steps: JsonValue;
  expected: JsonValue;
  source: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface TestCaseCreateData {
  projectId: string;
  title: string;
  description?: string | null;
  steps: JsonValue;
  expected: JsonValue;
  source?: string | null;
}

export interface TestCaseUpdateData {
  projectId?: string;
  title?: string;
  description?: string | null;
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

export type AnalysisStatus = 'success' | 'fail' | 'bug' | 'anomaly';

export interface AnalysisResultRecord {
  id: string;
  testRunId: string;
  status: AnalysisStatus;
  reason: string | null;
  detail: string | null;
  solution: string | null;
  provider: ProviderName;
  rawResponse: JsonValue | null;
  createdAt: Date | null;
}

export interface AnalysisResultCreateData {
  testRunId: string;
  status: AnalysisStatus;
  reason?: string | null;
  detail?: string | null;
  solution?: string | null;
  provider: ProviderName;
  rawResponse?: JsonValue | null;
}

export interface AnalysisResultUpdateData {
  testRunId?: string;
  status?: AnalysisStatus;
  reason?: string | null;
  detail?: string | null;
  solution?: string | null;
  provider?: ProviderName;
  rawResponse?: JsonValue | null;
}

export type AnalysisResultSummary = Omit<AnalysisResultRecord, 'rawResponse'>;

export interface TestCaseWithLatestAnalysis extends TestCase {
  latestAnalysisResult: AnalysisResultSummary | null;
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

/**
 * Keterangan: Hasil "Suite Analysis" — analisis AI lintas-fitur setelah
 * semua test case dalam satu suite run selesai, mencari inkonsistensi antar
 * fitur, coverage gap sederhana, dan pola kegagalan sistemik. Berbeda dari
 * `analysis_result` (per test_run tunggal) — ini melihat gambaran besar.
 */
export type SuiteAnalysisStatus = 'consistent' | 'issues_found' | 'incomplete';

export interface SuiteAnalysisFinding {
  category: 'inconsistency' | 'coverage_gap' | 'systemic_failure' | 'other';
  title: string;
  detail: string;
  relatedTestCases: string[];
}

export interface SuiteAnalysisResultRecord {
  id: string;
  projectId: string;
  suiteRunId: string;
  testRunIds: string[];
  status: SuiteAnalysisStatus;
  summary: string | null;
  findings: SuiteAnalysisFinding[];
  provider: ProviderName;
  rawResponse: JsonValue | null;
  createdAt: Date | null;
}

export interface SuiteAnalysisResultCreateData {
  projectId: string;
  suiteRunId: string;
  testRunIds: string[];
  status: SuiteAnalysisStatus;
  summary?: string | null;
  findings: SuiteAnalysisFinding[];
  provider: ProviderName;
  rawResponse?: JsonValue | null;
}
