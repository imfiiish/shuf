-- Pronunciation accent for Chinese words: 'mandarin' (普通话, the default
-- track) or 'cantonese' (粤语, HiuGaaiNeural). It only decides which voice
-- recording the client plays — the word text and all progress are unchanged.

ALTER TABLE app.user_settings
    ADD COLUMN IF NOT EXISTS accent text NOT NULL DEFAULT 'mandarin';

-- Recreate the constraint so a re-run stays clean.
ALTER TABLE app.user_settings
    DROP CONSTRAINT IF EXISTS user_settings_accent;

ALTER TABLE app.user_settings
    ADD CONSTRAINT user_settings_accent
    CHECK (accent IN ('mandarin', 'cantonese'));
