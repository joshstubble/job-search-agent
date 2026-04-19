import { NextRequest } from "next/server";
// `pdfkit` resolves its AFM fonts via fs.readFileSync at package-relative paths,
// which Turbopack rewrites to a bogus /ROOT/... location at runtime. The
// `standalone` build inlines the font data, so we import that instead.
// @ts-expect-error — no types published for the standalone build
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";

import sql from "@/lib/db";

export const runtime = "nodejs";

type Body = { text?: string; useActive?: boolean; filename?: string };

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;

  let text = body.text;
  if (!text && body.useActive) {
    const [active] = await sql<{ parsed_text: string }[]>`
      SELECT parsed_text FROM resume_versions WHERE is_active = true LIMIT 1
    `;
    text = active?.parsed_text;
  }
  if (!text || text.trim().length < 10) {
    return new Response("Empty resume text.", { status: 400 });
  }

  const filename = (body.filename || "resume.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
  const pdfBuffer = await renderPdf(text);

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdfBuffer.length),
      "Cache-Control": "no-store",
    },
  });
}

function renderPdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 54, bottom: 54, left: 72, right: 72 }, // ~0.75"/1"
      autoFirstPage: true,
      info: { Title: "Resume", Creator: "law dashboard" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica");

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      // Blank line → spacer.
      if (!trimmed) {
        doc.moveDown(0.4);
        continue;
      }
      // Treat short ALL-CAPS-ish headings as section headers (bold, slightly bigger).
      const isHeader =
        trimmed.length <= 40 &&
        /^[A-Z][A-Z0-9 &/\-]+$/.test(trimmed) &&
        trimmed.split(/\s+/).length <= 6;

      if (isHeader) {
        doc.moveDown(0.3);
        doc.font("Helvetica-Bold").fontSize(12).text(trimmed, { continued: false });
        doc.font("Helvetica").fontSize(10.5);
      } else {
        doc.font("Helvetica").fontSize(10.5).text(line, { continued: false });
      }
    }

    doc.end();
  });
}
