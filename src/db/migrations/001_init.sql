-- Migration 001: skema awal (Fase 1-2, Fase 5 sudah diantisipasi)
-- Sumber: docs/arsitektur-spesifikasi-teknis.md, bagian "3. Skema Database (PostgreSQL)"

-- Diperlukan untuk gen_random_uuid() di PostgreSQL < 13. Di PG 13+ fungsi ini
-- sudah built-in di core, tapi CREATE EXTENSION IF NOT EXISTS tetap aman dijalankan.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Project: unit tertinggi, aplikasi yang mau ditest
CREATE TABLE project (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  base_url      TEXT,
  default_provider TEXT DEFAULT 'claude', -- default AI provider utk project ini
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Test case: definisi steps + expected result
CREATE TABLE test_case (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  steps         JSONB NOT NULL,      -- array of {action, selector, value, ...}
  expected      JSONB NOT NULL,      -- array of string expected result
  source        TEXT DEFAULT 'manual', -- manual | ai_prompt | ai_url_exploration (Fase 3)
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Test run: satu eksekusi test case
CREATE TABLE test_run (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id  UUID NOT NULL REFERENCES test_case(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'queued',
                -- queued | running | passed | failed | error
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Artifact: file yang dihasilkan per run (video, trace, screenshot)
CREATE TABLE artifact (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id   UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,       -- video | trace | screenshot | console_log | network_log
  file_path     TEXT NOT NULL,       -- path relatif di ./storage/artifacts/<run_id>/
  size_bytes    BIGINT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Analysis result: hasil klasifikasi AI per test run
CREATE TABLE analysis_result (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id   UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,       -- success | fail | bug | anomaly
  reason        TEXT,                -- wajib diisi untuk status = success
  detail        TEXT,                -- root cause, untuk fail/bug/anomaly
  solution      TEXT,                -- saran perbaikan, untuk fail/bug/anomaly
  provider      TEXT NOT NULL,       -- provider LLM yang dipakai saat analisis ini
  raw_response  JSONB,               -- simpan response mentah utk audit/debug
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Step result: detail per-step di dalam satu run (opsional tapi berguna utk debugging)
CREATE TABLE test_step_result (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id   UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
  step_index    INTEGER NOT NULL,
  action        TEXT NOT NULL,
  status        TEXT NOT NULL,       -- passed | failed
  error_message TEXT,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Fixture (Fase 5)
CREATE TABLE fixture (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  file_type     TEXT NOT NULL,       -- csv | json | image | pdf
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Feature map (Fase 5)
CREATE TABLE feature_map (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  source_document TEXT,              -- path file PRD yang diupload
  features      JSONB NOT NULL,      -- array of {name, description, covered: bool, test_case_id?}
  created_at    TIMESTAMPTZ DEFAULT now()
);
