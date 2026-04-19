import sql from "@/lib/db";
import { loadEditorState } from "@/lib/editor-state";
import type { ResumeSections } from "@/lib/resume-sections";

import { Editor } from "./Editor";

export default async function ResumeEditPage() {
  const [[active], state] = await Promise.all([
    sql<
      { id: number; file_name: string; parsed_text: string; sections: ResumeSections | null }[]
    >`
      SELECT id, file_name, parsed_text, sections
      FROM resume_versions
      WHERE is_active = true
      LIMIT 1
    `,
    loadEditorState(),
  ]);

  if (!active) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Resume editor</h1>
        <p className="text-sm text-muted-foreground">
          No active resume yet.{" "}
          <a href="/resume" className="underline">Upload one first</a>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Resume editor</h1>
        <p className="text-sm text-muted-foreground">
          Editing <span className="font-mono">{active.file_name}</span> — the draft + chat persist across page reloads, and the coach remembers durable facts about you across sessions.
        </p>
      </div>
      <HowThisWorks />
      <Editor
        resumeId={active.id}
        initialText={state.working_draft_text ?? active.parsed_text}
        initialSections={active.sections}
        initialMessages={state.messages}
        rememberedFacts={state.remembered_facts}
      />
    </div>
  );
}

function HowThisWorks() {
  return (
    <details className="rounded-md border bg-muted/30 p-3 text-sm">
      <summary className="cursor-pointer select-none font-medium">
        How this editor works
      </summary>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-[13px]">
        <div>
          <h4 className="font-medium mb-1">What the coach does</h4>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>
              Opens with 3–4 interview questions to build context (first visit only).
            </li>
            <li>
              Asks clarifying questions before making substantive rewrites — it won&rsquo;t guess at your target field or preferences.
            </li>
            <li>
              Uses your actual ranked job feed to ground suggestions, not generic advice.
            </li>
            <li>
              Numerically verifies rewrites before proposing them (tests them against your top-10 jobs).
            </li>
            <li>
              Remembers durable facts you share so future sessions don&rsquo;t start from zero.
            </li>
            <li>
              Never invents employers, dates, degrees, or credentials.
            </li>
          </ul>
        </div>
        <div>
          <h4 className="font-medium mb-1">Tools the coach can call</h4>
          <ul className="space-y-1.5 text-muted-foreground">
            <li>
              <span className="font-mono text-xs text-foreground">keyword_gap</span> — surfaces terms common in your top-ranked jobs but missing from the draft.
            </li>
            <li>
              <span className="font-mono text-xs text-foreground">score_against</span> — embeds a proposed rewrite, reports fit_score delta vs your current top-10 or a specific job.
            </li>
            <li>
              <span className="font-mono text-xs text-foreground">discipline_distribution</span> — shows which disciplines / specialties dominate your top-ranked jobs so edits can target them.
            </li>
            <li>
              <span className="font-mono text-xs text-foreground">remember</span> — saves a durable fact about you (preference, constraint, correction). Survives across sessions.
            </li>
          </ul>
        </div>
        <div className="md:col-span-2">
          <h4 className="font-medium mb-1">Try asking</h4>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground text-[13px]">
            <li>&ldquo;What terms am I missing from my top-10 jobs?&rdquo;</li>
            <li>&ldquo;Rewrite my summary to emphasize backend experience.&rdquo;</li>
            <li>&ldquo;Remember: I&rsquo;m only open to fully remote roles.&rdquo;</li>
            <li>&ldquo;Does this proposed version score higher than my current one?&rdquo;</li>
            <li>&ldquo;Which of my experience bullets is weakest and why?&rdquo;</li>
            <li>&ldquo;Which disciplines dominate my top 50 jobs?&rdquo;</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
