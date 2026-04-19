import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import sql from "@/lib/db";

const COLUMNS = [
  "interested",
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;

type PipelineRow = {
  job_id: number;
  status: string;
  updated_at: Date;
  applied_at: Date | null;
  title: string;
  company: string;
  location: string;
  fit_score: number | null;
};

export default async function PipelinePage() {
  const rows = await sql<PipelineRow[]>`
    SELECT a.job_id, a.status, a.updated_at, a.applied_at,
           j.title, j.company, j.location,
           c.fit_score
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    LEFT JOIN job_classifications c ON c.job_id = a.job_id
    ORDER BY a.updated_at DESC
  `;

  const byStatus = new Map<string, PipelineRow[]>();
  for (const col of COLUMNS) byStatus.set(col, []);
  for (const r of rows) {
    if (!byStatus.has(r.status)) byStatus.set(r.status, []);
    byStatus.get(r.status)!.push(r);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} application{rows.length === 1 ? "" : "s"}. Mark a job's status from the job detail page.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const items = byStatus.get(col) ?? [];
          return (
            <Card key={col} className="p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium capitalize">{col}</h3>
                <Badge variant="outline">{items.length}</Badge>
              </div>
              <div className="space-y-2">
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">empty</p>
                ) : (
                  items.map((r) => (
                    <Link
                      key={r.job_id}
                      href={`/jobs/${r.job_id}`}
                      className="block rounded-md border p-2 hover:bg-accent/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">
                          {r.title}
                        </span>
                        {r.fit_score !== null && (
                          <Badge variant="secondary">
                            {Number(r.fit_score).toFixed(0)}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.company}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.updated_at).toLocaleDateString()}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
