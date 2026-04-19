"use server";

import { revalidatePath } from "next/cache";

import sql from "@/lib/db";
import { parseDocxText } from "@/lib/docx";
import { embedText, toVectorLiteral } from "@/lib/llm";
import { parsePdfText } from "@/lib/pdf";

export async function uploadResumeAction(
  fd: FormData,
): Promise<{ id: number; chars: number }> {
  const file = fd.get("file") as File | null;
  if (!file || typeof file === "string") throw new Error("No file uploaded.");

  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  if (name.endsWith(".pdf")) {
    text = await parsePdfText(bytes);
  } else if (name.endsWith(".docx")) {
    text = await parseDocxText(bytes);
  } else {
    throw new Error("Upload a .pdf or .docx. (Legacy .doc is not supported.)");
  }
  if (text.length < 50)
    throw new Error(
      `Parsed to only ${text.length} chars — is it a scanned image or an empty doc?`,
    );

  const embedding = await embedText(text.slice(0, 8000));

  const [row] = await sql<{ id: number }[]>`
    INSERT INTO resume_versions (file_name, file_data, parsed_text, embedding, is_active)
    VALUES (
      ${file.name},
      ${Buffer.from(bytes)},
      ${text},
      ${toVectorLiteral(embedding)}::vector,
      false
    )
    RETURNING id
  `;

  revalidatePath("/resume");
  return { id: row.id, chars: text.length };
}

export async function activateResumeAction(
  resumeId: number,
): Promise<{ rescored: number }> {
  // Flip is_active, then re-rank every classified row.
  await sql.begin(async (tx) => {
    await tx`UPDATE resume_versions SET is_active = false WHERE is_active = true`;
    await tx`UPDATE resume_versions SET is_active = true WHERE id = ${resumeId}`;
  });

  // Formula lives in the `compute_fit_score` SQL function (migration
  // 20260419000000_fit_score_fn.sql) so both this re-rank path and the
  // classifier's Python scorer agree on weights.
  const result = await sql`
    UPDATE job_classifications c
       SET fit_score = compute_fit_score(
             GREATEST(0.0, 1 - (c.embedding <=> r.embedding))::numeric,
             c.llm_match,
             c.location_bonus
           )
      FROM (
        SELECT embedding FROM resume_versions
         WHERE is_active = true AND embedding IS NOT NULL
         LIMIT 1
      ) r
     WHERE c.embedding IS NOT NULL
  `;

  revalidatePath("/");
  revalidatePath("/resume");
  return { rescored: result.count ?? 0 };
}

export async function deleteResumeAction(resumeId: number) {
  await sql`DELETE FROM resume_versions WHERE id = ${resumeId}`;
  revalidatePath("/resume");
}
