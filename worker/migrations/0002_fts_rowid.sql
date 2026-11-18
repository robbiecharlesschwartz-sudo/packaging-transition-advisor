-- The FTS5 table kept chunk_id as an UNINDEXED column, so every "DELETE ... WHERE chunk_id = ?" scanned the whole
-- index; re-ingesting a few thousand chunks used up D1's 5M rows-read/day free limit (docs/FIXED_BY_HAND.md #12).
-- FTS rows now share the chunks table's integer rowid: deletes and joins are primary-key lookups.
DROP TABLE IF EXISTS chunks_fts;
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  title,
  section,
  content,
  tokenize = 'porter unicode61'
);
INSERT INTO chunks_fts (rowid, title, section, content)
  SELECT c.rowid, d.title, COALESCE(c.section, ''), c.content FROM chunks c JOIN documents d ON d.id = c.document_id;

-- Counters kept up to date at ingest so requests never COUNT(*) the corpus.
INSERT OR REPLACE INTO meta (key, value) VALUES ('chunk_count', (SELECT COUNT(*) FROM chunks));
INSERT OR REPLACE INTO meta (key, value) VALUES ('document_count', (SELECT COUNT(*) FROM documents));
