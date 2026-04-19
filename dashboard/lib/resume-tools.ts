// Tool implementations the ResumeEditor agent calls via OpenAI function-calling.
// Each tool returns a JSON-serializable object; the model sees this as tool output
// and reasons over it. Tools have access to the user's current draft + DB.
import sql from "@/lib/db";
import { embedText, toVectorLiteral } from "@/lib/llm";

// ---------------------------------------------------------------------------
// keyword_gap
// ---------------------------------------------------------------------------
// Generic job-posting boilerplate we never want to surface as a "gap".
const STOPWORDS = new Set<string>([
  // articles + prep + aux
  "the", "a", "an", "of", "and", "or", "to", "in", "for", "with", "on", "at",
  "by", "from", "as", "is", "are", "be", "was", "were", "will", "have", "has",
  "had", "this", "that", "these", "those", "it", "its", "not", "but", "if",
  "then", "so", "up", "out", "over", "into", "about", "after", "before",
  "during", "within", "without", "per", "can", "may", "must", "should",
  "would", "could",
  // job-post boilerplate
  "you", "your", "we", "our", "us", "they", "their", "them",
  "role", "roles", "position", "candidate", "candidates", "applicant",
  "team", "work", "working", "experience", "experienced", "skills", "skill",
  "required", "requires", "requirement", "preferred", "prefer",
  "ability", "abilities", "strong", "excellent", "good", "proven",
  "knowledge", "understanding", "familiar", "familiarity",
  "responsibilities", "responsibility", "duties", "duty",
  "including", "include", "includes", "etc", "e.g", "i.e",
  "opportunity", "opportunities", "firm", "company", "office", "location",
  "salary", "range", "benefits", "compensation", "pto", "vacation",
  "year", "years", "day", "days", "week", "weeks", "month", "months",
  "new", "old", "high", "low", "large", "small", "full", "part", "time",
  "who", "which", "what", "when", "where", "how", "why",
  "all", "any", "some", "each", "every", "other", "another", "also", "only",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/\b[a-z][a-z'-]+\b/g) ?? []).filter(
    (w) => w.length > 2 && !STOPWORDS.has(w),
  );
}

export async function keywordGapTool(draftText: string, topN = 25) {
  const rows = await sql<
    { title: string; jd_summary: string | null; discipline: string | null }[]
  >`
    SELECT j.title, c.jd_summary, c.discipline
    FROM jobs j
    JOIN job_classifications c ON c.job_id = j.id
    WHERE c.fit_score IS NOT NULL
      AND c.seniority <> 'non_target'
    ORDER BY c.fit_score DESC
    LIMIT ${topN}
  `;

  const jobBlob = rows
    .map((r) => [r.title, r.jd_summary, r.discipline].filter(Boolean).join(" "))
    .join("\n");
  const jobTokens = tokenize(jobBlob);
  const draftLower = " " + draftText.toLowerCase() + " ";

  // Unigrams
  const counts = new Map<string, number>();
  for (const t of jobTokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  // Bigrams (only if both tokens pass the stopword filter)
  for (let i = 0; i < jobTokens.length - 1; i++) {
    const bg = `${jobTokens[i]} ${jobTokens[i + 1]}`;
    counts.set(bg, (counts.get(bg) ?? 0) + 1);
  }
  // Trigrams
  for (let i = 0; i < jobTokens.length - 2; i++) {
    const tg = `${jobTokens[i]} ${jobTokens[i + 1]} ${jobTokens[i + 2]}`;
    counts.set(tg, (counts.get(tg) ?? 0) + 1);
  }

  const gaps: { keyword: string; top_jobs_count: number; in_draft: boolean }[] = [];
  for (const [keyword, count] of counts) {
    // phrases must show up in at least 3 of top-N to count as a pattern
    if (count < 3) continue;
    const inDraft = draftLower.includes(` ${keyword} `);
    if (inDraft) continue;
    gaps.push({ keyword, top_jobs_count: count, in_draft: false });
  }
  gaps.sort((a, b) => b.top_jobs_count - a.top_jobs_count);
  return {
    sample_size: rows.length,
    missing_keywords_or_phrases: gaps.slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// score_against — embed a proposed resume; report delta vs current
// ---------------------------------------------------------------------------
export async function scoreAgainstTool(
  proposedText: string,
  jobId?: number,
): Promise<Record<string, unknown>> {
  const embedding = await embedText(proposedText.slice(0, 8000));
  const v = toVectorLiteral(embedding);

  if (jobId) {
    const rows = await sql<
      { title: string; fit_score: number | null; new_score: number | null }[]
    >`
      SELECT j.title, c.fit_score,
        ROUND((100 * (
          0.5 * GREATEST(0.0, 1 - (c.embedding <=> ${v}::vector)) +
          0.3 * (COALESCE(c.llm_match, 0)::numeric / 10.0) +
          0.2 * COALESCE(c.location_bonus, 0)
        ))::numeric, 2) AS new_score
      FROM job_classifications c
      JOIN jobs j ON j.id = c.job_id
      WHERE c.job_id = ${jobId} AND c.embedding IS NOT NULL
    `;
    const r = rows[0];
    if (!r) return { error: `job ${jobId} not found or has no embedding` };
    const current = r.fit_score === null ? 0 : Number(r.fit_score);
    const proposed = r.new_score === null ? 0 : Number(r.new_score);
    return {
      job_id: jobId,
      title: r.title,
      current_score: current,
      proposed_score: proposed,
      delta: Math.round((proposed - current) * 100) / 100,
    };
  }

  // Top-10
  const rows = await sql<
    { id: number; title: string; fit_score: number | null; new_score: number | null }[]
  >`
    SELECT j.id, j.title, c.fit_score,
      ROUND((100 * (
        0.5 * GREATEST(0.0, 1 - (c.embedding <=> ${v}::vector)) +
        0.3 * (COALESCE(c.llm_match, 0)::numeric / 10.0) +
        0.2 * COALESCE(c.location_bonus, 0)
      ))::numeric, 2) AS new_score
    FROM job_classifications c
    JOIN jobs j ON j.id = c.job_id
    WHERE c.embedding IS NOT NULL
      AND c.seniority <> 'non_target'
    ORDER BY c.fit_score DESC NULLS LAST
    LIMIT 10
  `;
  const comps = rows.map((r) => {
    const current = r.fit_score === null ? 0 : Number(r.fit_score);
    const proposed = r.new_score === null ? 0 : Number(r.new_score);
    return {
      job_id: r.id,
      title: r.title,
      current,
      proposed,
      delta: Math.round((proposed - current) * 100) / 100,
    };
  });
  const avgDelta = comps.length
    ? comps.reduce((s, c) => s + c.delta, 0) / comps.length
    : 0;
  return {
    top10: comps,
    avg_delta: Math.round(avgDelta * 100) / 100,
    note: "Positive delta means the proposed draft scores better than the currently-saved draft against these jobs.",
  };
}

// ---------------------------------------------------------------------------
// discipline_distribution
// ---------------------------------------------------------------------------
export async function disciplineDistributionTool(limit = 100) {
  const rows = await sql<
    { discipline: string; count: number; avg_fit: number }[]
  >`
    WITH top_jobs AS (
      SELECT c.discipline, c.fit_score
      FROM job_classifications c
      WHERE c.fit_score IS NOT NULL
        AND c.seniority <> 'non_target'
        AND c.discipline IS NOT NULL
        AND c.discipline <> 'unknown'
      ORDER BY c.fit_score DESC
      LIMIT ${limit}
    )
    SELECT discipline,
           count(*)::int AS count,
           ROUND(avg(fit_score)::numeric, 1) AS avg_fit
      FROM top_jobs
     GROUP BY discipline
     ORDER BY count DESC, avg_fit DESC
  `;
  return {
    top_n: limit,
    disciplines: rows.map((r) => ({
      discipline: r.discipline,
      count: r.count,
      avg_fit_score: Number(r.avg_fit),
    })),
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible tool schemas
// ---------------------------------------------------------------------------
export const RESUME_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "keyword_gap",
      description:
        "Find terms, phrases, or skills that appear frequently in the user's top-ranked jobs but are missing from the current resume draft. Use when the user asks about keyword optimization, what to emphasize, or what's missing.",
      parameters: {
        type: "object",
        properties: {
          top_n: {
            type: "integer",
            description: "How many top-ranked jobs to scan (default 25).",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "score_against",
      description:
        "Embed a proposed resume text and measure its fit_score against a specific job (if job_id is given) or the user's current top 10. Use this to verify that a proposed rewrite numerically improves the match.",
      parameters: {
        type: "object",
        required: ["proposed_text"],
        properties: {
          proposed_text: {
            type: "string",
            description:
              "The full resume text to test. Usually the rewrite the assistant is considering.",
          },
          job_id: {
            type: "integer",
            description:
              "Optional. If provided, score only against that single job. Otherwise returns deltas for the top 10.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "discipline_distribution",
      description:
        "List the disciplines / specialties present across the user's top-ranked jobs, with counts and average fit_score. Use to understand where demand is and what to emphasize.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "How many top jobs to tally (default 100).",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_themes",
      description:
        "Return the catalog of installed JSON Resume themes the user can render their resume in (each entry has slug, label, and a short blurb). Use when the user asks about how their resume will look, which template to pick, or when you want to recommend a specific template for a specific job type.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remember",
      description:
        "Save a durable fact about the user that should survive across sessions. Use when the user tells you a preference, constraint, career goal, or correction that will matter in future conversations (e.g. 'I'm only open to jobs within 50 miles of my city', 'My target specialty is backend Python — not frontend', 'Never suggest management-track roles'). Do NOT use for transient chat content — only use when something should be permanently remembered.",
      parameters: {
        type: "object",
        required: ["fact"],
        properties: {
          fact: {
            type: "string",
            description: "The durable fact to remember, in a short declarative sentence.",
          },
          category: {
            type: "string",
            description:
              "Optional label: 'preference', 'constraint', 'goal', 'correction', 'biographical'.",
          },
        },
      },
    },
  },
];

import { appendFact } from "@/lib/editor-state";
import { AVAILABLE_THEMES } from "@/lib/jsonresume";

export async function executeResumeTool(
  name: string,
  args: Record<string, unknown>,
  draftText: string,
): Promise<unknown> {
  switch (name) {
    case "keyword_gap":
      return keywordGapTool(
        draftText,
        typeof args.top_n === "number" ? args.top_n : 25,
      );
    case "score_against":
      return scoreAgainstTool(
        typeof args.proposed_text === "string"
          ? args.proposed_text
          : draftText,
        typeof args.job_id === "number" ? args.job_id : undefined,
      );
    case "discipline_distribution":
      return disciplineDistributionTool(
        typeof args.limit === "number" ? args.limit : 100,
      );
    case "list_themes":
      return {
        themes: AVAILABLE_THEMES.map((t) => ({
          slug: t.slug,
          label: t.label,
          blurb: t.blurb,
        })),
        note: "User can render the current active resume in any of these via the Preview / Download themed PDF buttons in the editor toolbar.",
      };
    case "remember": {
      const fact = typeof args.fact === "string" ? args.fact.trim() : "";
      if (!fact) return { error: "empty fact" };
      const facts = await appendFact({
        text: fact,
        category: typeof args.category === "string" ? args.category : undefined,
        added_at: new Date().toISOString(),
      });
      return {
        ok: true,
        total_remembered: facts.length,
        saved_fact: fact,
      };
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}
