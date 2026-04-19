import { NextRequest } from "next/server";

import sql from "@/lib/db";
import {
  AVAILABLE_THEMES,
  renderThemeHtml,
  sectionsToJsonResume,
  type ThemeSlug,
} from "@/lib/jsonresume";
import { htmlToPdfBuffer } from "@/lib/pdf-render";
import { parseResumeSections, type ResumeSections } from "@/lib/resume-sections";

export const runtime = "nodejs";

function isThemeSlug(s: string): s is ThemeSlug {
  return AVAILABLE_THEMES.some((t) => t.slug === s);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const themeSlug = (url.searchParams.get("theme") ?? "professional").toLowerCase();
  const format = (url.searchParams.get("format") ?? "html").toLowerCase();
  const resumeIdParam = url.searchParams.get("resumeId");
  const resumeId = resumeIdParam ? Number(resumeIdParam) : undefined;

  if (!isThemeSlug(themeSlug))
    return new Response(`Unknown theme: ${themeSlug}`, { status: 400 });
  if (format !== "html" && format !== "pdf")
    return new Response(`Unsupported format: ${format}`, { status: 400 });

  // Pick the active resume, or the one requested.
  const rows = resumeId
    ? await sql<{ id: number; parsed_text: string; sections: ResumeSections | null; file_name: string }[]>`
        SELECT id, parsed_text, sections, file_name
        FROM resume_versions
        WHERE id = ${resumeId}
        LIMIT 1
      `
    : await sql<{ id: number; parsed_text: string; sections: ResumeSections | null; file_name: string }[]>`
        SELECT id, parsed_text, sections, file_name
        FROM resume_versions
        WHERE is_active = true
        LIMIT 1
      `;
  const resume = rows[0];
  if (!resume) return new Response("No resume found.", { status: 404 });

  // Parse sections lazily if not yet extracted. Rest of the render needs them.
  let sections = resume.sections;
  if (!sections) {
    sections = await parseResumeSections(resume.parsed_text);
    await sql`
      UPDATE resume_versions SET sections = ${sql.json(sections as unknown as object)} WHERE id = ${resume.id}
    `;
  }

  const jsonResume = sectionsToJsonResume(sections, themeSlug);
  const html = await renderThemeHtml(jsonResume, themeSlug);

  if (format === "html") {
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // format === "pdf"
  const pdf = await htmlToPdfBuffer(html);
  const filename = `${resume.file_name.replace(/\.[a-z0-9]+$/i, "")}-${themeSlug}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  });
}
