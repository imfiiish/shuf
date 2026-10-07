-- Dictionary (public schema) indexes.
--
-- The dictionary ships in db/dump.sql and is never written at runtime, but the
-- app queries it hard and the dump only defines primary keys:
--
--   * Book selectors filter `WHERE lang = ... AND categories && '{...}'`.
--     Without a GIN index on `categories`, every selector scans all of the
--     language's words and tests the array by hand.
--   * The JLPT / HSK detail joins look a word up and keep the lowest level
--     (`WHERE word = ... ORDER BY level LIMIT 1`). Their primary keys lead with
--     `level`, so the `word` lookup was a sequential scan; `(word, level)`
--     turns it into an index scan that is already ordered.
--   * Oxford books filter on `cefr` only, which is not a leading PK column.
--
-- Plain CREATE INDEX (not CONCURRENTLY): migrate.ts runs each file inside a
-- transaction and these tables are read-only, so the brief lock is harmless.
CREATE INDEX IF NOT EXISTS words_categories_gin
    ON public.words USING gin (categories);

CREATE INDEX IF NOT EXISTS oxford_cefr_idx
    ON public.oxford (cefr);

CREATE INDEX IF NOT EXISTS hsk_word_level_idx
    ON public.hsk (word, level);

CREATE INDEX IF NOT EXISTS jlpt_word_level_idx
    ON public.jlpt (word, level);
