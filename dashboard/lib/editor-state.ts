import sql from "@/lib/db";

export type StoredMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content?: string | null;
  // present on assistant turns that invoked a tool
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  // present on tool turns
  tool_call_id?: string;
  name?: string;
  created_at?: string;
};

export type Fact = { text: string; category?: string; added_at: string };

export type EditorState = {
  messages: StoredMessage[];
  working_draft_text: string | null;
  remembered_facts: Fact[];
  updated_at: Date;
};

export async function loadEditorState(): Promise<EditorState> {
  const [row] = await sql<EditorState[]>`
    SELECT messages, working_draft_text, remembered_facts, updated_at
    FROM editor_state WHERE id = 1
  `;
  return row ?? {
    messages: [],
    working_draft_text: null,
    remembered_facts: [],
    updated_at: new Date(),
  };
}

export async function replaceMessages(messages: StoredMessage[]): Promise<void> {
  // postgres.js auto-JSON-encodes arrays/objects; don't pre-stringify or it
  // becomes a quoted string in the jsonb column.
  await sql`
    UPDATE editor_state
       SET messages = ${sql.json(messages as unknown as object)},
           updated_at = now()
     WHERE id = 1
  `;
}

export async function saveWorkingDraft(text: string): Promise<void> {
  await sql`
    UPDATE editor_state
       SET working_draft_text = ${text},
           updated_at = now()
     WHERE id = 1
  `;
}

export async function appendFact(fact: Fact): Promise<Fact[]> {
  const [row] = await sql<{ remembered_facts: Fact[] }[]>`
    UPDATE editor_state
       SET remembered_facts = remembered_facts || ${sql.json([fact] as unknown as object)},
           updated_at = now()
     WHERE id = 1
     RETURNING remembered_facts
  `;
  return row.remembered_facts;
}

export async function removeFactByIndex(index: number): Promise<Fact[]> {
  const [row] = await sql<{ remembered_facts: Fact[] }[]>`
    UPDATE editor_state
       SET remembered_facts = remembered_facts - ${index}::int,
           updated_at = now()
     WHERE id = 1
     RETURNING remembered_facts
  `;
  return row.remembered_facts;
}

export async function resetChat(): Promise<void> {
  await sql`
    UPDATE editor_state
       SET messages = '[]'::jsonb,
           updated_at = now()
     WHERE id = 1
  `;
}
