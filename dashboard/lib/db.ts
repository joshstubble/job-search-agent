import postgres from "postgres";

// Singleton. Next.js dev mode hot-reloads modules, so stash on globalThis to
// avoid leaking connection pools every edit.
declare global {
  // eslint-disable-next-line no-var
  var __lawSql: ReturnType<typeof postgres> | undefined;
}

const sql =
  globalThis.__lawSql ??
  postgres(process.env.DATABASE_URL!, {
    max: 4,
    prepare: false, // avoid pgbouncer-like pain if we ever front with one
    // pgvector columns come back as string `'[0.1, 0.2, ...]'`; callers parse on demand.
  });

if (process.env.NODE_ENV !== "production") globalThis.__lawSql = sql;

export default sql;

// ---- Shared row shapes ------------------------------------------------------

export type JobListRow = {
  id: number;
  title: string;
  company: string;
  location: string;
  url: string | null;
  source: string;
  first_seen_at: Date;
  last_seen_at: Date;
  seniority: string | null;
  discipline: string | null;
  remote: boolean | null;
  years_required: number | null;
  salary_range: string | null;
  jd_summary: string | null;
  fit_score: number | null;
};

export type JobDetailRow = JobListRow & {
  description: string | null;
  salary_min: number | null;
  salary_max: number | null;
  remote_type: string | null;
  llm_cover_letter_draft: string | null;
  draft_updated_at: Date | null;
  classified_at: Date | null;
  applied_status: string | null;
};
