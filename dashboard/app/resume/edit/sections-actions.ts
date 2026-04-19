"use server";

import { revalidatePath } from "next/cache";

import sql from "@/lib/db";
import {
  parseResumeSections,
  renderSectionsToText,
  type ResumeSections,
} from "@/lib/resume-sections";

export async function extractSectionsAction(
  resumeId: number,
): Promise<ResumeSections> {
  const [row] = await sql<{ parsed_text: string }[]>`
    SELECT parsed_text FROM resume_versions WHERE id = ${resumeId} LIMIT 1
  `;
  if (!row) throw new Error(`Resume ${resumeId} not found`);
  const sections = await parseResumeSections(row.parsed_text);
  await sql`
    UPDATE resume_versions
       SET sections = ${sections}::jsonb
     WHERE id = ${resumeId}
  `;
  revalidatePath("/resume/edit");
  return sections;
}

export async function renderSectionsToTextAction(
  sections: ResumeSections,
): Promise<string> {
  return renderSectionsToText(sections);
}
