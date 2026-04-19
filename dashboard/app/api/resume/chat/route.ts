import { NextRequest } from "next/server";

import {
  loadEditorState,
  replaceMessages,
  type StoredMessage,
} from "@/lib/editor-state";
import { openRouter, RESUME_EDITOR_MODEL } from "@/lib/llm";
import { executeResumeTool, RESUME_TOOLS } from "@/lib/resume-tools";

export const runtime = "nodejs";

// Upper bound on the assistant → tool-call → assistant → … ping-pong within a
// single turn. Generous enough for multi-step coach flows (e.g. keyword_gap →
// discipline_distribution → propose rewrite → score_against → final reply),
// low enough that a tool-loop bug can't rack up OpenRouter spend. Each iteration
// is one LLM call so cost scales linearly with this cap.
const MAX_TOOL_ITERATIONS = 12;

type Body = {
  draftText: string;
  // Optional one-shot user message; if omitted we assume the client already wrote
  // the user turn to the DB (via `/api/resume/chat/user-turn`) and we just want
  // the model to continue.
  userMessage?: string;
  // If true, kickoff mode: model opens the conversation with interview questions
  // and no prior user turn is required.
  kickoff?: boolean;
};

function buildSystemPrompt(draftText: string, facts: { text: string; category?: string }[]): string {
  const factBlock = facts.length
    ? "\n\nLong-term memory (durable facts about this user):\n" +
      facts.map((f, i) => `  ${i + 1}. [${f.category ?? "note"}] ${f.text}`).join("\n")
    : "";

  return `You are a senior career coach and resume editor working with a job-seeker to craft the strongest possible resume for their target roles.

You are INTERACTIVE — not a one-shot rewriter. Your job is to elicit the best possible resume through conversation:
- Ask clarifying questions BEFORE making substantial edits. Do not guess at target field, seniority, or preferences — ask.
- Validate assumptions before proposing changes. If the user says "make my summary stronger," ask what "stronger" means to them (tighter? more technical? more narrative?).
- When you see an ambiguous or weak block, point it out and ask what the user really did — don't invent content.
- Use your tools proactively to ground your advice in data (the user's actual top-ranked jobs), not generalities.

Available tools:
- keyword_gap — terms frequent in the user's top jobs but missing from the current draft
- score_against — test a proposed rewrite: does it numerically improve fit_score vs current top-10?
- discipline_distribution — see which disciplines dominate the user's ranked feed
- remember — save durable facts about the user that should survive this conversation (preferences, constraints, corrections)

Interaction rules:
1. If the conversation is empty (kickoff), open with a warm, specific greeting and ask 3-4 focused interview questions to build your initial context. Example topics: target disciplines / specialties, geography constraints, years of actual experience vs. what's listed, any current roles the user is particularly excited about in their feed, deal-breakers. Do NOT propose edits yet — first build context.
2. Before any substantive rewrite, call keyword_gap AND discipline_distribution so your suggestions reflect the user's actual top jobs.
3. When the user gives you a durable preference, constraint, or correction, call \`remember\`. Keep it tight — don't remember everything, only what would matter in a future session.
4. When you do propose a full rewrite, call \`score_against\` on your proposal first. If avg_delta is negative vs the current draft, rework before presenting.
5. Present rewrites inside a fenced code block tagged "resume":
\`\`\`resume
<full rewritten resume text>
\`\`\`

Truth rules (non-negotiable):
- NEVER invent facts, employers, dates, degrees, certifications, or credentials.
- Only restructure or reword content already in the source resume.
- Keep the candidate's voice. Use plain ASCII (no em dashes or curly quotes unless already present).

Current draft:
---
${draftText || "(empty)"}
---${factBlock}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;

  const state = await loadEditorState();
  const messages: StoredMessage[] = [...state.messages];

  // Append the user turn to persisted history, if one came in.
  if (body.userMessage?.trim()) {
    messages.push({
      role: "user",
      content: body.userMessage.trim(),
      created_at: new Date().toISOString(),
    });
  }

  const system = buildSystemPrompt(body.draftText, state.remembered_facts);

  // Build the conversation we send to the model: system prompt + stored history.
  // We exclude any prior "system" entries in history (we always regenerate the
  // system from current facts + draft).
  const convo = [
    { role: "system" as const, content: system },
    ...messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content: m.content ?? "",
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
  ];

  // Kickoff mode: nudge the model to open the conversation even though there's
  // no user turn. We do that with a pseudo-user turn that does NOT get persisted.
  if (body.kickoff && messages.length === 0) {
    convo.push({
      role: "user" as const,
      content:
        "Please open the conversation: greet the user and ask your initial interview questions to build context. Keep it brief and focused.",
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          const res = await openRouter().chat.completions.create({
            model: RESUME_EDITOR_MODEL,
            max_tokens: 8000,
            tools: RESUME_TOOLS,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: convo as any,
          });
          const msg = res.choices[0]?.message;
          if (!msg) {
            emit("\n[error: model returned no message]");
            break;
          }

          // Persist the assistant turn (with any tool_calls) to both the live
          // conversation (so subsequent iterations see it) and the stored history.
          const assistantTurn: StoredMessage = {
            role: "assistant",
            content: msg.content ?? null,
            tool_calls: msg.tool_calls ?? undefined,
            created_at: new Date().toISOString(),
          };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          convo.push(msg as any);
          messages.push(assistantTurn);

          if (msg.tool_calls?.length) {
            const names = msg.tool_calls.map((t) => t.function.name).join(", ");
            emit(`\n> _calling tools: ${names}_\n`);
            for (const call of msg.tool_calls) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(call.function.arguments || "{}");
              } catch {
                args = {};
              }
              const result = await executeResumeTool(
                call.function.name,
                args,
                body.draftText,
              );
              const toolTurn: StoredMessage = {
                role: "tool",
                tool_call_id: call.id,
                name: call.function.name,
                content: JSON.stringify(result),
                created_at: new Date().toISOString(),
              };
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              convo.push(toolTurn as any);
              messages.push(toolTurn);
            }
            emit(`_tools done_\n\n`);
            continue;
          }

          // Final text response
          if (msg.content) emit(msg.content);
          break;
        }
      } catch (e) {
        emit(`\n\n[error: ${e instanceof Error ? e.message : String(e)}]`);
      }

      // Persist the full conversation so the next page load sees it.
      try {
        await replaceMessages(messages);
      } catch (e) {
        emit(`\n\n[error persisting chat: ${e instanceof Error ? e.message : String(e)}]`);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
