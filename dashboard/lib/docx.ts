// Server-side .docx text extraction via mammoth. Produces plain text with paragraphs
// separated by blank lines — consistent shape with pdf.ts output so downstream
// code (embedding, DB insert) doesn't need to branch.
import mammoth from "mammoth";

export async function parseDocxText(bytes: Uint8Array): Promise<string> {
  const buffer = Buffer.from(bytes);
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}
