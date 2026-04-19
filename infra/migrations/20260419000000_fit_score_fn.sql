-- migrate:up

-- Canonical fit_score definition, shared by the dashboard's re-rank SQL and
-- the classifier's Python code. Before this migration the formula lived in
-- three places (classifier/run.py:compute_fit_score, dashboard/.../resume/
-- actions.ts:activateResumeAction, dashboard/.../resume/edit/actions.ts:
-- saveEditedResumeAction) and risked drift.
--
-- Inputs:
--   cos_sim        cosine similarity in [0, 1] (already clamped)
--   llm_match_val  scorer output, integer 0-10
--   proximity      location_bonus in [0, 1]
--
-- Output: numeric(5,2) in [0, 100].
CREATE OR REPLACE FUNCTION compute_fit_score(
    cos_sim        numeric,
    llm_match_val  integer,
    proximity      numeric
) RETURNS numeric LANGUAGE SQL IMMUTABLE AS $$
    SELECT ROUND((100 * (
        0.5 * GREATEST(0.0, COALESCE(cos_sim, 0)) +
        0.3 * (LEAST(10, GREATEST(0, COALESCE(llm_match_val, 0)))::numeric / 10.0) +
        0.2 * COALESCE(proximity, 0)
    ))::numeric, 2);
$$;

-- migrate:down

DROP FUNCTION IF EXISTS compute_fit_score(numeric, integer, numeric);
