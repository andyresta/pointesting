-- Migration 004: simpan instruction generate per project
ALTER TABLE project
  ADD COLUMN IF NOT EXISTS instruction TEXT,
  ADD COLUMN IF NOT EXISTS extra_data TEXT;
