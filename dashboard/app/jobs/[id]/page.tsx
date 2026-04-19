import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import sql, { type JobDetailRow } from "@/lib/db";

import { DraftPanel } from "./DraftPanel";
import { StatusPanel } from "./StatusPanel";
import { TailorPanel } from "./TailorPanel";

type Params = Promise<{ id: string }>;

export default async function JobDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isFinite(jobId)) notFound();

  const [job] = await sql<JobDetailRow[]>`
    SELECT j.id, j.title, j.company, j.location, j.url, j.source,
           j.first_seen_at, j.last_seen_at,
           j.description, j.salary_min, j.salary_max, j.remote_type,
           c.seniority, c.discipline, c.remote, c.years_required,
           c.salary_range, c.jd_summary, c.fit_score,
           c.llm_cover_letter_draft, c.draft_updated_at, c.classified_at,
           a.status AS applied_status
    FROM jobs j
    LEFT JOIN job_classifications c ON c.job_id = j.id
    LEFT JOIN applications a ON a.job_id = j.id
    WHERE j.id = ${jobId}
    LIMIT 1
  `;
  if (!job) notFound();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Feed
        </a>
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold">{job.title}</h1>
            <p className="text-muted-foreground">
              {job.company} · {job.location}
            </p>
          </div>
          <div className="text-right text-sm text-muted-foreground space-y-0.5">
            {job.fit_score !== null && (
              <div>
                fit <Badge>{Number(job.fit_score).toFixed(0)}</Badge>
              </div>
            )}
            <div>
              source: <span className="font-mono text-xs">{job.source}</span>
            </div>
            {job.url && (
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Open posting ↗
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {job.seniority && <Badge variant="outline">{job.seniority}</Badge>}
          {job.discipline && job.discipline !== "unknown" && (
            <Badge variant="outline">{job.discipline}</Badge>
          )}
          {job.remote === true && <Badge variant="outline">remote</Badge>}
          {job.years_required !== null && (
            <Badge variant="outline">{job.years_required}+ yrs</Badge>
          )}
          {job.salary_range && <Badge variant="outline">{job.salary_range}</Badge>}
        </div>
      </header>

      <Card className="p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Status</h3>
        <StatusPanel jobId={job.id} current={job.applied_status ?? null} />
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">
          Cover letter (Gemini 3.1 Pro, on-demand)
        </h3>
        <DraftPanel
          jobId={job.id}
          initialDraft={job.llm_cover_letter_draft ?? null}
        />
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">
          Tailor resume (Gemini 3.1 Pro, on-demand)
        </h3>
        <TailorPanel jobId={job.id} />
      </Card>

      {job.jd_summary && (
        <Card className="p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-1">Summary</h3>
          <p className="text-sm">{job.jd_summary}</p>
        </Card>
      )}

      {job.description && (
        <Card className="p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Full posting
          </h3>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
            {job.description}
          </pre>
        </Card>
      )}
    </div>
  );
}
