-- migrate:up

CREATE EXTENSION IF NOT EXISTS vector;

-- Scrapers / feeds we pull from. Name is the stable key ('jobspy_indeed', 'usajobs', etc.).
CREATE TABLE sources (
    name              text PRIMARY KEY,
    enabled           boolean     NOT NULL DEFAULT true,
    config            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    last_run_at       timestamptz,
    last_success_at   timestamptz,
    last_error        text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- Raw job postings. Dedup key is a hash of title+company+location; repeat pulls bump last_seen_at.
CREATE TABLE jobs (
    id                bigserial PRIMARY KEY,
    dedupe_hash       text        NOT NULL UNIQUE,
    source            text        NOT NULL REFERENCES sources(name),
    source_job_id     text,
    url               text,
    title             text        NOT NULL,
    company           text        NOT NULL,
    location          text        NOT NULL,
    description       text,
    posted_at         timestamptz,
    salary_min        integer,
    salary_max        integer,
    salary_currency   text,
    remote_type       text,
    raw               jsonb       NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at     timestamptz NOT NULL DEFAULT now(),
    last_seen_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_last_seen_idx ON jobs (last_seen_at DESC);
CREATE INDEX jobs_company_idx   ON jobs (company);
CREATE INDEX jobs_source_idx    ON jobs (source);

-- Classifier + scorer + drafter output, 1:1 with jobs.
-- Embedding dim 1536 matches openai/text-embedding-3-small.
CREATE TABLE job_classifications (
    job_id                    bigint      PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    classified_at             timestamptz NOT NULL DEFAULT now(),
    seniority                 text,
    discipline             text,
    remote                    boolean,
    years_required            integer,
    salary_range              text,
    jd_summary                text,
    embedding                 vector(1536),
    fit_score                 numeric(5,2),
    llm_model                 text,
    llm_cover_letter_draft    text,
    draft_updated_at          timestamptz
);
CREATE INDEX job_classifications_fit_score_idx
    ON job_classifications (fit_score DESC NULLS LAST);
CREATE INDEX job_classifications_seniority_idx
    ON job_classifications (seniority);
-- ivfflat needs data to train; lists=100 is fine for up to ~100k rows. Rebuild if we scale.
CREATE INDEX job_classifications_embedding_idx
    ON job_classifications USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Resume PDFs stored as bytea + parsed text + embedding. Exactly one is_active at a time.
CREATE TABLE resume_versions (
    id              bigserial PRIMARY KEY,
    uploaded_at     timestamptz NOT NULL DEFAULT now(),
    file_name       text        NOT NULL,
    file_data       bytea       NOT NULL,
    parsed_text     text,
    embedding       vector(1536),
    is_active       boolean     NOT NULL DEFAULT false,
    notes           text
);
CREATE UNIQUE INDEX resume_versions_one_active_idx
    ON resume_versions (is_active) WHERE is_active = true;

-- Application pipeline state. Status is free text gated at the app layer to the set listed below.
-- ('interested','applied','screening','interview','offer','rejected','withdrawn')
CREATE TABLE applications (
    id                  bigserial PRIMARY KEY,
    job_id              bigint      NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    status              text        NOT NULL DEFAULT 'interested',
    applied_at          timestamptz,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    resume_version_id   bigint      REFERENCES resume_versions(id),
    cover_letter_used   text,
    notes               text,
    UNIQUE (job_id)
);
CREATE INDEX applications_status_idx ON applications (status);

-- migrate:down

DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS resume_versions;
DROP TABLE IF EXISTS job_classifications;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS sources;
DROP EXTENSION IF EXISTS vector;
