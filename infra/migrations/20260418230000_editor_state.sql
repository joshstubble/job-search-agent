-- migrate:up

-- Singleton row (id = 1) that persists the ResumeEditor's state across page
-- navigation AND across LLM calls.
--
-- - messages          — full chat history (OpenAI-chat-format jsonb[])
-- - working_draft_text — the textarea value, separate from resume_versions.parsed_text
--                       because the user might be mid-edit against the active resume
-- - remembered_facts  — durable facts the LLM (or user) chose to keep. Injected into
--                       the system prompt on every call so they survive conversations.
CREATE TABLE editor_state (
    id                integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    messages          jsonb       NOT NULL DEFAULT '[]'::jsonb,
    working_draft_text text,
    remembered_facts  jsonb       NOT NULL DEFAULT '[]'::jsonb,
    updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO editor_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- migrate:down

DROP TABLE IF EXISTS editor_state;
