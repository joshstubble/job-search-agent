import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import sql from "@/lib/db";

import { SourceToggle } from "./SourceToggle";

type SourceRow = {
  name: string;
  enabled: boolean;
  last_run_at: Date | null;
  last_success_at: Date | null;
  last_error: string | null;
};

export default async function SettingsPage() {
  const sources = await sql<SourceRow[]>`
    SELECT name, enabled, last_run_at, last_success_at, last_error
    FROM sources
    ORDER BY name
  `;

  const [stats] = await sql<
    { total: number; classified: number; with_draft: number; active_resume: number }[]
  >`
    SELECT
      (SELECT count(*) FROM jobs)::int AS total,
      (SELECT count(*) FROM job_classifications)::int AS classified,
      (SELECT count(*) FROM job_classifications WHERE llm_cover_letter_draft IS NOT NULL)::int AS with_draft,
      (SELECT count(*) FROM resume_versions WHERE is_active = true)::int AS active_resume
  `;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">System</h3>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">jobs</dt>
            <dd className="text-lg font-mono">{stats.total.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">classified</dt>
            <dd className="text-lg font-mono">{stats.classified.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">with draft</dt>
            <dd className="text-lg font-mono">{stats.with_draft.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">active resume</dt>
            <dd className="text-lg font-mono">{stats.active_resume ? "yes" : "no"}</dd>
          </div>
        </dl>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">Sources ({sources.length})</h3>
        <div className="space-y-2">
          {sources.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between gap-3 py-1.5 border-b last:border-b-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-sm">{s.name}</span>
                {s.last_error && <Badge variant="destructive">last-error</Badge>}
              </div>
              <div className="text-xs text-muted-foreground shrink-0 text-right">
                {s.last_success_at ? (
                  <>last ok: {new Date(s.last_success_at).toLocaleString()}</>
                ) : (
                  "never run"
                )}
              </div>
              <SourceToggle name={s.name} enabled={s.enabled} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
