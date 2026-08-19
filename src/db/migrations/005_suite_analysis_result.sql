-- Migration 005: hasil analisis lintas-fitur (Suite Analysis) setelah semua
-- test case dalam satu suite run selesai dieksekusi. suite_run_id BUKAN FK
-- (suite run cuma id ephemeral in-memory, bukan tabel) — test_run_ids
-- menyimpan daftar test_run.id yang tercakup dalam suite tersebut untuk audit.
CREATE TABLE IF NOT EXISTS suite_analysis_result (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  suite_run_id  TEXT NOT NULL,
  test_run_ids  JSONB NOT NULL,
  status        TEXT NOT NULL, -- consistent | issues_found | incomplete
  summary       TEXT,
  findings      JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider      TEXT NOT NULL,
  raw_response  JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suite_analysis_result_project
  ON suite_analysis_result (project_id, created_at DESC);
