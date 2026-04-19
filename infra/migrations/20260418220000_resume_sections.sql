-- migrate:up

-- Structured resume: JSON sections parsed out of parsed_text so the LLM (and UI)
-- can target individual blocks without touching the rest. Nullable — plain-text
-- resumes still work without being parsed.
ALTER TABLE resume_versions
    ADD COLUMN sections jsonb;

-- migrate:down

ALTER TABLE resume_versions
    DROP COLUMN IF EXISTS sections;
