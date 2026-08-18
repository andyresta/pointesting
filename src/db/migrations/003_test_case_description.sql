-- Migration 003: keterangan/deskripsi test case hasil generate AI
ALTER TABLE test_case
  ADD COLUMN IF NOT EXISTS description TEXT;
