"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Fact, StoredMessage } from "@/lib/editor-state";
import type { ResumeSections } from "@/lib/resume-sections";

import { saveEditedResumeAction } from "./actions";
import { UnifiedDiff } from "./DiffViewer";
import {
  forgetFactAction,
  resetChatAction,
  saveDraftDebouncedAction,
} from "./editor-actions";
import { SectionsPanel } from "./SectionsPanel";
import { ThemeExport } from "./ThemeExport";

// ---------- helpers ----------------------------------------------------------

// Hide a ```resume``` fenced block from chat-panel display — it's shown live in
// the left panel instead, so echoing it in the chat is just noise.
function formatForDisplay(content: string): string {
  return content.replace(
    /```resume\s*\n[\s\S]*?(?:```|$)/g,
    "\n\n_✓ edited your resume on the left_\n\n",
  );
}

// Stream-parse a possibly-in-progress ```resume``` block. Returns what belongs
// in the left-panel draft (if any), what's left over for the chat panel, and
// whether we're currently inside the block.
type StreamParse = {
  chatText: string;
  blockText: string | null; // null → no block seen yet
  blockClosed: boolean;
};
function parseStream(raw: string): StreamParse {
  const openRe = /```resume\s*\n?/;
  const match = openRe.exec(raw);
  if (!match) return { chatText: raw, blockText: null, blockClosed: false };
  const before = raw.slice(0, match.index);
  const rest = raw.slice(match.index + match[0].length);
  const closeIdx = rest.indexOf("```");
  if (closeIdx === -1) {
    return {
      chatText: before + "\n\n_✍️ editing your resume on the left…_",
      blockText: rest,
      blockClosed: false,
    };
  }
  const blockText = rest.slice(0, closeIdx);
  const after = rest.slice(closeIdx + 3);
  return {
    chatText: before + "\n\n_✓ edited your resume on the left_\n\n" + after,
    blockText,
    blockClosed: true,
  };
}

async function downloadPdf(text: string, filename: string) {
  const res = await fetch("/api/resume/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, filename }),
  });
  if (!res.ok) throw new Error(`PDF render failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type DisplayMsg = { role: "user" | "assistant"; content: string };

// The server persists system/tool turns and assistant turns with only tool_calls
// (no content). None of those are useful to show in the UI — we keep only plain
// user/assistant turns with textual content.
function toDisplayMessages(msgs: StoredMessage[]): DisplayMsg[] {
  return msgs
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }));
}

// ---------- Editor -----------------------------------------------------------

export function Editor({
  resumeId,
  initialText,
  initialSections,
  initialMessages,
  rememberedFacts,
}: {
  resumeId: number;
  initialText: string;
  initialSections: ResumeSections | null;
  initialMessages: StoredMessage[];
  rememberedFacts: Fact[];
}) {
  const [draft, setDraft] = useState(initialText);
  const [messages, setMessages] = useState<DisplayMsg[]>(
    toDisplayMessages(initialMessages),
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Canvas-style live edit: when the coach streams a ```resume block, we pipe
  // its content directly into the draft on the left. preEditSnapshot holds the
  // draft as it was right before the coach started editing, so the user can
  // undo or diff against it.
  const [liveEditing, setLiveEditing] = useState(false);
  const [preEditSnapshot, setPreEditSnapshot] = useState<string | null>(null);
  const [showPreEditDiff, setShowPreEditDiff] = useState(false);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // --- scroll chat to bottom whenever messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // --- debounced server-side save of the draft textarea
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      void saveDraftDebouncedAction(draft);
    }, 800);
    return () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    };
  }, [draft]);

  // --- auto-kickoff: if chat is empty, have the LLM open the conversation
  const kickedOffRef = useRef(false);
  useEffect(() => {
    if (kickedOffRef.current) return;
    if (messages.length > 0) return;
    kickedOffRef.current = true;
    void streamChat({ kickoff: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function streamChat(opts: { kickoff?: boolean; userMessage?: string }) {
    setChatErr(null);
    if (opts.userMessage) {
      setMessages((m) => [...m, { role: "user", content: opts.userMessage! }]);
    }
    setStreaming(true);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    // Reset any lingering post-edit UI from a previous turn.
    setShowPreEditDiff(false);

    let snapshotTaken = false;
    let enteredBlock = false;

    try {
      const res = await fetch("/api/resume/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftText: draftRef.current,
          userMessage: opts.userMessage,
          kickoff: opts.kickoff,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`chat API: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      // The stored assistant turn keeps the full raw content (including the
      // fenced block) — that matches what the server persisted, so the UI is
      // consistent across reloads.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const parsed = parseStream(raw);

        // Enter live-edit mode on first sight of the opener; snapshot the draft
        // so the user can undo.
        if (parsed.blockText !== null && !enteredBlock) {
          enteredBlock = true;
          if (!snapshotTaken) {
            setPreEditSnapshot(draftRef.current);
            snapshotTaken = true;
          }
          setLiveEditing(true);
        }

        // Pipe the in-progress block text into the draft. While still open we
        // stream in verbatim; once closed we trim trailing whitespace.
        if (parsed.blockText !== null) {
          setDraft(parsed.blockClosed ? parsed.blockText.trim() : parsed.blockText);
        }

        // Leave live-edit mode once the block closes.
        if (parsed.blockClosed) {
          setLiveEditing(false);
        }

        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: raw };
          return copy;
        });
      }
    } catch (e) {
      setChatErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      setLiveEditing(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    await streamChat({ userMessage: text });
  }

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  async function downloadCurrentAsPdf() {
    setPdfErr(null);
    setPdfBusy(true);
    try {
      const ts = new Date().toISOString().slice(0, 10);
      await downloadPdf(draft, `resume-${ts}.pdf`);
    } catch (e) {
      setPdfErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfBusy(false);
    }
  }

  function save(activate: boolean) {
    setSaveMsg(null);
    startSaving(async () => {
      try {
        const r = await saveEditedResumeAction(draft, activate);
        setSaveMsg(
          activate
            ? `Saved version #${r.id} and re-ranked ${r.rescored} jobs.`
            : `Saved version #${r.id} (inactive).`,
        );
      } catch (e) {
        setSaveMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  const [chatResetting, setChatResetting] = useState(false);
  async function newChat() {
    if (streaming || chatResetting) return;
    setChatResetting(true);
    try {
      await resetChatAction();
      setMessages([]);
      kickedOffRef.current = false;
      // Kick off a fresh interview. Small delay so streaming-guards reset first.
      setTimeout(() => void streamChat({ kickoff: true }), 50);
    } catch (e) {
      setChatErr(e instanceof Error ? e.message : String(e));
    } finally {
      setChatResetting(false);
    }
  }

  const [activeTab, setActiveTab] = useState<"plain" | "sections">("plain");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-13rem)]">
      {/* Left: the draft (tabbed: plain text / sections) */}
      <div className="flex flex-col gap-2 min-h-0">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex rounded-lg bg-muted p-0.5">
            <TabButton
              active={activeTab === "plain"}
              onClick={() => setActiveTab("plain")}
            >
              Plain text
            </TabButton>
            <TabButton
              active={activeTab === "sections"}
              onClick={() => setActiveTab("sections")}
            >
              Sections
            </TabButton>
          </div>
          <div className="text-xs text-muted-foreground">
            {draft.length.toLocaleString()} chars · autosaves
          </div>
        </div>
        {activeTab === "plain" ? (
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            {liveEditing && (
              <div className="inline-flex w-fit items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs text-blue-700 dark:text-blue-300">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                </span>
                Coach is editing your resume…
              </div>
            )}
            {!liveEditing &&
              preEditSnapshot !== null &&
              preEditSnapshot !== draft && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs">
                  <span className="text-emerald-700 dark:text-emerald-300">
                    ✓ Coach edited your resume
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={() => setShowPreEditDiff((v) => !v)}
                    >
                      {showPreEditDiff ? "Hide diff" : "Show diff"}
                    </button>
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={() => {
                        setDraft(preEditSnapshot);
                        setPreEditSnapshot(null);
                        setShowPreEditDiff(false);
                      }}
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      title="Dismiss"
                      onClick={() => {
                        setPreEditSnapshot(null);
                        setShowPreEditDiff(false);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}
            {showPreEditDiff && preEditSnapshot !== null && (
              <UnifiedDiff oldText={preEditSnapshot} newText={draft} />
            )}
            <Textarea
              value={draft}
              readOnly={liveEditing}
              onChange={(e) => setDraft(e.target.value)}
              className={cn(
                "flex-1 resize-none font-mono text-[13px] leading-relaxed transition-shadow",
                liveEditing &&
                  "bg-blue-500/5 ring-2 ring-blue-500/50 ring-offset-1",
              )}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <SectionsPanel
              resumeId={resumeId}
              initialSections={initialSections}
              onApplyToDraft={(t) => setDraft(t)}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => save(true)} disabled={saving || streaming}>
            {saving ? "Saving…" : "Save + Activate + Re-rank"}
          </Button>
          <Button
            variant="outline"
            onClick={() => save(false)}
            disabled={saving || streaming}
          >
            Save as inactive version
          </Button>
          <Button
            variant="outline"
            onClick={downloadCurrentAsPdf}
            disabled={pdfBusy || !draft.trim()}
          >
            {pdfBusy ? "Rendering…" : "Plain PDF"}
          </Button>
          <ThemeExport activeResumeId={resumeId} />
          {saveMsg && (
            <span
              className={
                saveMsg.startsWith("Error")
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {saveMsg}
            </span>
          )}
          {pdfErr && (
            <span className="text-xs text-destructive">PDF: {pdfErr}</span>
          )}
        </div>
      </div>

      {/* Right: chat */}
      <div className="flex flex-col gap-2 min-h-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Coach — Gemini 3.1 Pro</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={newChat}
            disabled={streaming || chatResetting}
          >
            {chatResetting ? "Resetting…" : "New chat"}
          </Button>
        </div>

        {/* Remembered facts */}
        {rememberedFacts.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
            <div className="font-medium">
              Remembered ({rememberedFacts.length}) —{" "}
              <span className="text-muted-foreground">
                carries across sessions; the coach sees these every turn
              </span>
            </div>
            <ul className="space-y-0.5">
              {rememberedFacts.map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex-1">
                    <span className="text-muted-foreground">[{f.category ?? "note"}]</span>{" "}
                    {f.text}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void forgetFactAction(i)}
                    title="Forget this"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex-1 overflow-y-auto rounded-md border p-3 space-y-3 bg-muted/20">
          {messages.length === 0 && !streaming && (
            <p className="text-xs text-muted-foreground italic">
              The coach will open the conversation with a few questions.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className="text-sm">
              <div className="text-xs font-medium text-muted-foreground mb-0.5">
                {m.role === "user" ? "you" : "coach"}
              </div>
              <div className="whitespace-pre-wrap">
                {m.role === "assistant" ? formatForDisplay(m.content) : m.content}
              </div>
            </div>
          ))}
          {chatErr && <p className="text-xs text-destructive">Chat error: {chatErr}</p>}
          <div ref={chatEndRef} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex gap-2"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Answer the coach's question, or ask your own. (⌘/Ctrl+Enter to send)"
            rows={2}
            className="text-sm resize-none"
            disabled={streaming}
          />
          <Button type="submit" disabled={streaming || !input.trim()}>
            {streaming ? "…" : "Send"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-sm transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
