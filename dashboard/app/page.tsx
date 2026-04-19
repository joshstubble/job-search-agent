import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import sql, { type JobListRow } from "@/lib/db";

type SearchParams = Promise<{
  stale?: string;
  seniority?: string;
  remote?: string;
}>;

export default async function FeedPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const includeStale = sp.stale === "1";
  const seniority = sp.seniority ?? "";
  const remote = sp.remote ?? "";

  const rows = await sql<JobListRow[]>`
    SELECT
      j.id, j.title, j.company, j.location, j.url, j.source,
      j.first_seen_at, j.last_seen_at,
      c.seniority, c.discipline, c.remote, c.years_required,
      c.salary_range, c.jd_summary, c.fit_score
    FROM jobs j
    JOIN job_classifications c ON c.job_id = j.id
    WHERE 1=1
    ${
      includeStale
        ? sql``
        : sql`AND j.last_seen_at >= now() - interval '21 days'`
    }
    ${
      seniority
        ? sql`AND c.seniority = ${seniority}`
        : sql`AND c.seniority <> 'non_target'`
    }
    ${
      remote === "remote"
        ? sql`AND c.remote = true`
        : remote === "onsite"
        ? sql`AND c.remote = false`
        : sql``
    }
    ORDER BY c.fit_score DESC NULLS LAST, j.last_seen_at DESC
    LIMIT 100
  `;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Feed</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} jobs shown{" "}
            {includeStale
              ? "(including stale)"
              : "(active — seen in last 21 days)"}
          </p>
        </div>
        <FilterBar seniority={seniority} remote={remote} stale={includeStale} />
      </div>
      <div className="grid gap-3">
        {rows.map((r) => (
          <JobCard key={r.id} job={r} />
        ))}
      </div>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No jobs match. Try loosening the filters.
        </p>
      )}
    </div>
  );
}

function FilterBar({
  seniority,
  remote,
  stale,
}: {
  seniority: string;
  remote: string;
  stale: boolean;
}) {
  return (
    <form className="flex items-end gap-2 text-sm" action="/">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Seniority</span>
        <select
          name="seniority"
          defaultValue={seniority}
          className="rounded-md border bg-background px-2 py-1.5 h-9"
        >
          <option value="">Default (hide non-target)</option>
          <option value="intern">intern</option>
          <option value="entry">entry</option>
          <option value="mid">mid</option>
          <option value="senior">senior</option>
          <option value="staff">staff</option>
          <option value="management">management</option>
          <option value="executive">executive</option>
          <option value="non_target">non_target</option>
          <option value="unknown">unknown</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Remote</span>
        <select
          name="remote"
          defaultValue={remote}
          className="rounded-md border bg-background px-2 py-1.5 h-9"
        >
          <option value="">Any</option>
          <option value="remote">remote</option>
          <option value="onsite">onsite</option>
        </select>
      </label>
      <label className="flex items-center gap-2 h-9 ml-2">
        <input
          type="checkbox"
          name="stale"
          value="1"
          defaultChecked={stale}
          className="h-4 w-4"
        />
        <span className="text-xs text-muted-foreground">Show stale</span>
      </label>
      <button
        type="submit"
        className="rounded-md border bg-background px-3 h-9 hover:bg-accent"
      >
        Apply
      </button>
    </form>
  );
}

function JobCard({ job }: { job: JobListRow }) {
  const daysAgo = Math.floor(
    (Date.now() - new Date(job.last_seen_at).getTime()) / 86_400_000
  );
  const fitVariant = fitScoreVariant(job.fit_score);

  return (
    <Link href={`/jobs/${job.id}`}>
      <Card className="p-4 hover:bg-accent/40 transition-colors">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="font-medium text-base truncate">{job.title}</h2>
              {job.fit_score !== null && (
                <Badge variant={fitVariant}>{formatScore(job.fit_score)}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {job.company} · {job.location || "—"}
            </p>
            {job.jd_summary && (
              <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                {job.jd_summary}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2 text-xs">
              {job.seniority && <Tag>{job.seniority}</Tag>}
              {job.discipline && job.discipline !== "unknown" && (
                <Tag>{job.discipline}</Tag>
              )}
              {job.remote === true && <Tag>remote</Tag>}
              {job.years_required !== null && (
                <Tag>{job.years_required}+ yrs</Tag>
              )}
              {job.salary_range && <Tag>{job.salary_range}</Tag>}
            </div>
          </div>
          <div className="shrink-0 text-xs text-muted-foreground text-right space-y-1">
            <div>{job.source}</div>
            <div>{daysAgo === 0 ? "today" : `${daysAgo}d ago`}</div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs bg-secondary/50">
      {children}
    </span>
  );
}

function formatScore(n: number | null): string {
  if (n === null) return "—";
  return Number(n).toFixed(0);
}

function fitScoreVariant(
  n: number | null
): "default" | "secondary" | "outline" | "destructive" {
  if (n === null) return "outline";
  if (n >= 45) return "default";
  if (n >= 30) return "secondary";
  return "outline";
}
