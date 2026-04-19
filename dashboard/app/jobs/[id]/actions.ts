"use server";

import { revalidatePath } from "next/cache";

import sql from "@/lib/db";
import { DRAFTER_MODEL, RESUME_EDITOR_MODEL, embedText, openRouter, toVectorLiteral } from "@/lib/llm";

const _DRAFT_INSTRUCTIONS = `You draft a personalized cover letter for the candidate applying to the given job.

Tone: professional, specific to the employer and role, under 300 words. Do NOT invent qualifications the candidate hasn't said they have — pull only from the job posting and the candidate's resume (when provided) to explain interest. Reference the discipline and location from the job.

Structure:
  Paragraph 1 — Why this employer / role specifically (cite a detail from the posting)
  Paragraph 2 — What the candidate brings (interest in the discipline and seniority level of the role)
  Paragraph 3 — Close with availability and contact

Output ONLY the letter body. No 'Dear …' salutation (the dashboard prepends it). No signature block. Plain prose only.`;

type JobForDraft = {
  title: string;
  company: string;
  location: string;
  description: string | null;
  discipline: string | null;
  jd_summary: string | null;
};

export async function generateDraftAction(jobId: number): Promise<string> {
  const [job] = await sql<JobForDraft[]>`
    SELECT j.title, j.company, j.location, j.description,
           c.discipline, c.jd_summary
    FROM jobs j
    JOIN job_classifications c ON c.job_id = j.id
    WHERE j.id = ${jobId}
    LIMIT 1
  `;
  if (!job) throw new Error(`Job ${jobId} not found or not classified.`);

  const userPrompt = [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location}`,
    `Discipline: ${job.discipline ?? "unknown"}`,
    `Summary: ${job.jd_summary ?? ""}`,
    `Posting:\n${(job.description ?? "").slice(0, 4000)}`,
  ].join("\n");

  const res = await openRouter().chat.completions.create({
    model: DRAFTER_MODEL,
    max_tokens: 4000, // reasoning model — budget for think + letter
    messages: [
      { role: "system", content: _DRAFT_INSTRUCTIONS },
      { role: "user", content: userPrompt },
    ],
  });
  const text = res.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Drafter returned empty content.");

  await sql`
    UPDATE job_classifications
       SET llm_cover_letter_draft = ${text},
           draft_updated_at       = now()
     WHERE job_id = ${jobId}
  `;
  revalidatePath(`/jobs/${jobId}`);
  return text;
}

export async function saveDraftAction(jobId: number, draft: string) {
  await sql`
    UPDATE job_classifications
       SET llm_cover_letter_draft = ${draft},
           draft_updated_at       = now()
     WHERE job_id = ${jobId}
  `;
  revalidatePath(`/jobs/${jobId}`);
}

const _TAILOR_INSTRUCTIONS = `You tailor the user's existing resume for a specific job posting. Rules:

- STRICTLY do not invent facts, employers, dates, degrees, certifications, or credentials.
- Only reorder, re-emphasize, and reword what is already in the source resume. If the job wants skill X and the resume doesn't mention X, you may NOT add X — leave the honest gap.
- Rewrite the summary to lead with the aspects of the candidate that best match this posting's discipline, location, and seniority.
- Surface any bullets from Experience that are relevant to the posting's duties or discipline higher up; demote irrelevant bullets.
- Keep the same factual sections (Contact, Summary, Experience, Education, Skills, anything else the source has).
- Output ONLY the final tailored resume body. No preamble, no postscript, no code fences. Plain ASCII only.`;

export async function tailorResumeForJobAction(
  jobId: number,
): Promise<{ resumeId: number; tailoredText: string }> {
  const [job] = await sql<
    { title: string; company: string; location: string; description: string | null; discipline: string | null; seniority: string | null }[]
  >`
    SELECT j.title, j.company, j.location, j.description,
           c.discipline, c.seniority
    FROM jobs j
    JOIN job_classifications c ON c.job_id = j.id
    WHERE j.id = ${jobId}
    LIMIT 1
  `;
  if (!job) throw new Error(`Job ${jobId} not found or not classified.`);

  const [active] = await sql<{ parsed_text: string }[]>`
    SELECT parsed_text FROM resume_versions WHERE is_active = true LIMIT 1
  `;
  if (!active) throw new Error("No active resume — upload or activate one first.");

  const userPrompt =
    `Source resume:\n---\n${active.parsed_text}\n---\n\n` +
    `Target job:\n` +
    `Title: ${job.title}\n` +
    `Company: ${job.company}\n` +
    `Location: ${job.location}\n` +
    `Discipline: ${job.discipline ?? "unknown"}\n` +
    `Seniority: ${job.seniority ?? "unknown"}\n` +
    `Posting:\n${(job.description ?? "").slice(0, 6000)}`;

  const res = await openRouter().chat.completions.create({
    model: RESUME_EDITOR_MODEL,
    max_tokens: 8000,
    messages: [
      { role: "system", content: _TAILOR_INSTRUCTIONS },
      { role: "user", content: userPrompt },
    ],
  });
  const tailored = res.choices[0]?.message?.content?.trim();
  if (!tailored) throw new Error("Tailor returned empty content.");

  // Stripped-down embedding + save as a new inactive resume_versions row.
  const embedding = await embedText(tailored.slice(0, 8000));
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const fileName = `tailored-job-${jobId}-${ts}.txt`;
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO resume_versions (file_name, file_data, parsed_text, embedding, is_active, notes)
    VALUES (
      ${fileName},
      ${Buffer.from(tailored, "utf-8")},
      ${tailored},
      ${toVectorLiteral(embedding)}::vector,
      false,
      ${`tailored for job #${jobId} — ${job.title} @ ${job.company}`}
    )
    RETURNING id
  `;

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/resume");
  return { resumeId: row.id, tailoredText: tailored };
}


export async function upsertApplicationAction(
  jobId: number,
  status: string,
) {
  await sql`
    INSERT INTO applications (job_id, status, applied_at)
    VALUES (${jobId}, ${status}, ${status === "applied" ? sql`now()` : null})
    ON CONFLICT (job_id) DO UPDATE SET
      status     = EXCLUDED.status,
      applied_at = COALESCE(applications.applied_at, EXCLUDED.applied_at),
      updated_at = now()
  `;
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/pipeline");
}
