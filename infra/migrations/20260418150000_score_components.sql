-- migrate:up

-- Store the three fit_score components separately so re-ranking after a new
-- resume is a pure SQL UPDATE: only the cosine term changes, the other two
-- (llm_match and location_bonus) are stable per job.
ALTER TABLE job_classifications
    ADD COLUMN llm_match       integer,
    ADD COLUMN location_bonus numeric(3,2);

-- migrate:down

ALTER TABLE job_classifications
    DROP COLUMN IF EXISTS llm_match,
    DROP COLUMN IF EXISTS location_bonus;
