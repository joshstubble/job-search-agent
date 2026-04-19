import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import sql from "@/lib/db";

import { ResumeRow } from "./ResumeRow";
import { UploadForm } from "./UploadForm";

type ResumeListRow = {
  id: number;
  file_name: string;
  uploaded_at: Date;
  is_active: boolean;
  chars: number | null;
  has_embedding: boolean;
};

export default async function ResumePage() {
  const rows = await sql<ResumeListRow[]>`
    SELECT
      id,
      file_name,
      uploaded_at,
      is_active,
      char_length(parsed_text) AS chars,
      (embedding IS NOT NULL) AS has_embedding
    FROM resume_versions
    ORDER BY uploaded_at DESC
  `;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Resume</h1>
          <p className="text-sm text-muted-foreground">
            Upload a PDF or .docx, activate a version, and the feed re-ranks against it.
          </p>
        </div>
        <a
          href="/resume/edit"
          className="text-sm rounded-md border px-3 py-1.5 hover:bg-accent/40"
        >
          Open editor →
        </a>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">Upload new</h3>
        <UploadForm />
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">Versions ({rows.length})</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No resumes uploaded yet. The scorer's cosine term is zero until one is active,
            so scores currently cap at ~50.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-4 pb-3 border-b last:border-b-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm truncate">{r.file_name}</span>
                    {r.is_active && <Badge>active</Badge>}
                    {!r.has_embedding && (
                      <Badge variant="destructive">no embedding</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {new Date(r.uploaded_at).toLocaleString()} ·{" "}
                    {(r.chars ?? 0).toLocaleString()} chars parsed
                  </div>
                </div>
                <ResumeRow
                  id={r.id}
                  isActive={r.is_active}
                  hasEmbedding={r.has_embedding}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
