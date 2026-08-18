-- Migration 002: kredensial AI per project (terpisah dari tabel project)
-- API key disimpan terenkripsi di api_key_cipher; plaintext tidak boleh
-- dikembalikan ke UI. Satu project boleh punya banyak provider untuk fallback.

CREATE TABLE project_provider (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  api_key_cipher  TEXT NOT NULL,
  default_model   TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, provider)
);

CREATE INDEX project_provider_project_id_idx
  ON project_provider (project_id, sort_order, provider);
