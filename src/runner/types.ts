/**
 * Keterangan: Tipe satu step test case yang siap dieksekusi Playwright.
 * Bentuknya sama persis dengan `TestCaseStep` di
 * `src/api/schemas/testcase.schema.ts` (action goto/fill/click/check/select/
 * waitFor + grup assert* checkpoint: assertVisible/assertHidden/assertChecked/
 * assertText/assertValue/assertCount/assertUrl) — dipisah di sini agar
 * `src/runner` tidak perlu bergantung ke layer API.
 */
export type StepAction =
  | 'goto'
  | 'fill'
  | 'click'
  | 'check'
  | 'select'
  | 'waitFor'
  | 'assertVisible'
  | 'assertHidden'
  | 'assertChecked'
  | 'assertText'
  | 'assertValue'
  | 'assertCount'
  | 'assertUrl';

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

/** Keterangan: Checkpoint — elemen harus terlihat saat ini. */
export interface AssertVisibleStep {
  action: 'assertVisible';
  selector: string;
}

/** Keterangan: Checkpoint — elemen harus tersembunyi/tidak ada saat ini. */
export interface AssertHiddenStep {
  action: 'assertHidden';
  selector: string;
}

/** Keterangan: Checkpoint — checkbox/radio harus tercentang saat ini. */
export interface AssertCheckedStep {
  action: 'assertChecked';
  selector: string;
}

/** Keterangan: Checkpoint — teks elemen harus mengandung `value`. */
export interface AssertTextStep {
  action: 'assertText';
  selector: string;
  value: string;
}

/** Keterangan: Checkpoint — nilai input harus persis sama dengan `value`. */
export interface AssertValueStep {
  action: 'assertValue';
  selector: string;
  value: string;
}

/** Keterangan: Checkpoint — jumlah elemen yang cocok selector harus sama dengan `value`. */
export interface AssertCountStep {
  action: 'assertCount';
  selector: string;
  value: string;
}

/** Keterangan: Checkpoint — URL halaman saat ini harus mengandung `value`. */
export interface AssertUrlStep {
  action: 'assertUrl';
  value: string;
}

export type Step =
  | GotoStep
  | FillStep
  | ClickStep
  | CheckStep
  | SelectStep
  | WaitForStep
  | AssertVisibleStep
  | AssertHiddenStep
  | AssertCheckedStep
  | AssertTextStep
  | AssertValueStep
  | AssertCountStep
  | AssertUrlStep;

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
