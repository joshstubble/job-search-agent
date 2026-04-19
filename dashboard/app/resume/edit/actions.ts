"use server";

import { revalidatePath } from "next/cache";

import sql from "@/lib/db";
import { embedText, toVectorLiteral } from "@/lib/llm";

export async function saveEditedResumeAction(
  text: string,
  activate: boolean,
): Promise<{ id: number; rescored: number }> {
  if (!text || text.trim().length < 50)
    throw new Error("Edited resume is too short to save.");

  const embedding = await embedText(text.slice(0, 8000));
  const fileName = `edited-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;

  const [row] = await sql<{ id: number }[]>`
    INSERT INTO resume_versions (file_name, file_data, parsed_text, embedding, is_active, notes)
    VALUES (
      ${fileName},
      ${Buffer.from(text, "utf-8")},
      ${text},
      ${toVectorLiteral(embedding)}::vector,
      false,
      'chat-edited'
    )
    RETURNING id
  `;

  let rescored = 0;
  if (activate) {
    await sql.begin(async (tx) => {
      await tx`UPDATE resume_versions SET is_active = false WHERE is_active = true`;
      await tx`UPDATE resume_versions SET is_active = true WHERE id = ${row.id}`;
    });
    // Formula lives in the `compute_fit_score` SQL function (migration
    // 20260419000000_fit_score_fn.sql) — matched by classifier/run.py.
    const result = await sql`
      UPDATE job_classifications c
         SET fit_score = compute_fit_score(
               GREATEST(0.0, 1 - (c.embedding <=> r.embedding))::numeric,
               c.llm_match,
               c.location_bonus
             )
        FROM (SELECT embedding FROM resume_versions WHERE is_active = true LIMIT 1) r
       WHERE c.embedding IS NOT NULL
    `;
    rescored = result.count ?? 0;
    revalidatePath("/");
  }
  revalidatePath("/resume");
  return { id: row.id, rescored };
}
