/**
 * Keterangan: Tipe satu step test case yang siap dieksekusi Playwright.
 * Bentuknya sama persis dengan `TestCaseStep` di
 * `src/api/schemas/testcase.schema.ts` (action goto/fill/click/check/select/waitFor)
 * — dipisah di sini agar `src/runner` tidak perlu bergantung ke layer API.
 */
export type StepAction = 'goto' | 'fill' | 'click' | 'check' | 'select' | 'waitFor';

export interface GotoStep {
  action: 'goto';
  url: string;
}

export interface FillStep {
  action: 'fill';
  selector: string;
  value: string;
}

export interface ClickStep {
  action: 'click';
  selector: string;
}

export interface CheckStep {
  action: 'check';
  selector: string;
}

export interface SelectStep {
  action: 'select';
  selector: string;
  value: string;
}

export interface WaitForStep {
  action: 'waitFor';
  selector: string;
}

export type Step = GotoStep | FillStep | ClickStep | CheckStep | SelectStep | WaitForStep;

/**
 * Keterangan: Hasil eksekusi satu step — field-nya selaras dengan kolom
 * tabel `test_step_result` (index→step_index, action, status, errorMessage,
 * durationMs) supaya bisa langsung disimpan lewat repository di Step 9.
 */
export interface StepExecutionResult {
  index: number;
  action: StepAction;
  status: 'passed' | 'failed';
  errorMessage: string | null;
  durationMs: number;
}
