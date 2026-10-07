-- App-owned tables: accounts (users + guests), sessions, login throttling,
-- study progress, settings and wordbook customization.
--
-- They live in the `app` schema so pgweb (and psql) keep them separate from the
-- fishDict dictionary, which stays in `public` (db/dump.sql). `search_path` is
-- set to `app, public`, so the server's unqualified queries (`FROM users`,
-- `INTO sessions`, ...) resolve without a prefix.
--
-- The dictionary itself lives in dump.sql. This file runs after it during the
-- first container start (99-schema.sql), so `npm run db:reset` builds a complete
-- database. It is idempotent, so it can also be applied to an existing database
-- with `npm run db:schema`; that path migrates app tables which older versions
-- kept in `public` into `app` in place.
--
-- A guest is just a user with is_guest = true. It owns progress like any other
-- account and can be upgraded in place by setting username + pin_hash, so every
-- foreign key that already points at the id simply keeps working.

CREATE SCHEMA IF NOT EXISTS app;

-- One-time relocation: earlier versions kept every app table in `public`. Move
-- them into `app` so an existing database upgrades in place. Safe to re-run.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users', 'sessions', 'login_attempts', 'user_book_custom', 'cascades',
        'user_settings', 'user_word_stats', 'user_word_daily',
        'user_round_words', 'user_rounds'
    ] LOOP
        IF to_regclass(format('public.%I', t)) IS NOT NULL
           AND to_regclass(format('app.%I', t)) IS NULL THEN
            EXECUTE format('ALTER TABLE public.%I SET SCHEMA app', t);
        END IF;
    END LOOP;

    IF to_regprocedure('public.set_updated_at()') IS NOT NULL
       AND to_regprocedure('app.set_updated_at()') IS NULL THEN
        ALTER FUNCTION public.set_updated_at() SET SCHEMA app;
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS app.users (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Anonymous "Just browsing" visitors.
    is_guest     boolean     NOT NULL DEFAULT false,
    -- Lowercase login name; NULL for guests.
    username     text,
    -- Algorithm-tagged hash (e.g. scrypt$...$salt$hash); NULL for guests.
    -- Never store the 4-digit PIN itself.
    pin_hash     text,
    -- What the UI shows (username, or "游客"/"Guest" for guests).
    display_name text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT users_username_shape
        CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9]{2,19}$'),
    -- A registered account has both a username and a PIN; a guest has neither.
    CONSTRAINT users_identity
        CHECK (
            (is_guest     AND username IS NULL     AND pin_hash IS NULL) OR
            (NOT is_guest AND username IS NOT NULL AND pin_hash IS NOT NULL)
        ),
    CONSTRAINT users_display_name_present
        CHECK (char_length(display_name) > 0)
);

-- Case-insensitive-by-construction uniqueness. Partial so the many NULL
-- usernames (guests) do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key
    ON app.users (username) WHERE username IS NOT NULL;

-- Opaque bearer tokens. Only the hash is stored; the raw token lives in the
-- client. Deleting a user (or upgrading/ending a guest) drops its sessions.
CREATE TABLE IF NOT EXISTS app.sessions (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      bigint      NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    token_hash   text        NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    user_agent   text,
    ip           inet
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON app.sessions (user_id);

-- One row per login attempt, used to throttle brute force. A 4-digit PIN has
-- only 10,000 values, so this is required, not optional: lock out after N
-- failures in a window. Also records guest creations for auditing.
CREATE TABLE IF NOT EXISTS app.login_attempts (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username     text,
    ip           inet,
    ok           boolean     NOT NULL,
    attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_username_idx
    ON app.login_attempts (username, attempted_at DESC);

-- Per-user wordbook customization: which related lists to fold in / drop.
CREATE TABLE IF NOT EXISTS app.user_book_custom (
    user_id     bigint      NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    book        text        NOT NULL,
    exclude_ids text[]      NOT NULL DEFAULT '{}',
    addon_ids   text[]      NOT NULL DEFAULT '{}',
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, book)
);

-- Sampling cursor for the study flow: one cascading-window state per
-- (user, book). `levels` is the nested pool chain (levels[0] = active window),
-- `words` is the round currently dealt. See server/sampling.ts.
CREATE TABLE IF NOT EXISTS app.cascades (
    user_id    bigint      NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    book       text        NOT NULL,
    round_seq  integer     NOT NULL DEFAULT 0,
    levels     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    words      jsonb       NOT NULL DEFAULT '[]'::jsonb,
    -- Last word brought to the centre of the deck (synced across devices).
    last_word  text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, book)
);

-- Keep updated_at honest without relying on every caller.
CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON app.users;
CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON app.users
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Per-user study preferences (Settings page).
CREATE TABLE IF NOT EXISTS app.user_settings (
    user_id    bigint      PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
    daily_goal integer     NOT NULL DEFAULT 25,
    mix        text        NOT NULL DEFAULT 'default',
    round_size integer     NOT NULL DEFAULT 16,
    -- The wordbook currently being studied (synced across devices).
    active_book text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_settings_daily_goal CHECK (daily_goal BETWEEN 1 AND 1000),
    CONSTRAINT user_settings_mix
        CHECK (mix IN ('moreReview', 'default', 'faster')),
    CONSTRAINT user_settings_round_size CHECK (round_size IN (8, 16))
);

DROP TRIGGER IF EXISTS user_settings_set_updated_at ON app.user_settings;
CREATE TRIGGER user_settings_set_updated_at
    BEFORE UPDATE ON app.user_settings
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Per-user word stats (cumulative). `exposed` counts the rounds the word was
-- brought to the centre (at most once per round); `met` counts definition
-- reveals (flips), accumulated. Global per (user, lang, word) so a word shares
-- progress across books.
CREATE TABLE IF NOT EXISTS app.user_word_stats (
    user_id    bigint      NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    lang       text        NOT NULL,
    word       text        NOT NULL,
    exposed    integer     NOT NULL DEFAULT 0,
    met        integer     NOT NULL DEFAULT 0,
    exposed_at timestamptz,
    met_at     timestamptz,
    last_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, lang, word)
);

-- The same counters bucketed by logical day (04:00 cutoff) for the Progress
-- charts. `day` is the client's local logical date.
CREATE TABLE IF NOT EXISTS app.user_word_daily (
    user_id bigint  NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    lang    text    NOT NULL,
    word    text    NOT NULL,
    day     date    NOT NULL,
    exposed integer NOT NULL DEFAULT 0,
    met     integer NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, lang, word, day)
);

CREATE INDEX IF NOT EXISTS user_word_daily_user_day_idx
    ON app.user_word_daily (user_id, day);

-- Which words have been exposed in a given round. Exposure is once per round,
-- so re-entering the same (book, round_seq) must not count again. Row exists
-- ⇒ exposed that round.
CREATE TABLE IF NOT EXISTS app.user_round_words (
    user_id    bigint      NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    book       text        NOT NULL,
    round_seq  integer     NOT NULL,
    word       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, book, round_seq, word)
);

-- Per-round aggregates for the day view: how many words were exposed and how
-- many reveals happened in each dealt round.
CREATE TABLE IF NOT EXISTS app.user_rounds (
    user_id    bigint      NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    book       text        NOT NULL,
    round_seq  integer     NOT NULL,
    day        date        NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    exposed    integer     NOT NULL DEFAULT 0,
    reveals    integer     NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, book, round_seq)
);

CREATE INDEX IF NOT EXISTS user_rounds_user_day_idx
    ON app.user_rounds (user_id, day, started_at);

-- Make unqualified names resolve to the app schema first, then the dictionary.
-- Database-level, so psql and pgweb inherit it too (and the pool sets it again).
DO $$
BEGIN
    EXECUTE format(
        'ALTER DATABASE %I SET search_path TO app, public',
        current_database()
    );
END;
$$;
