"use server";

import { revalidatePath } from "next/cache";

import {
  removeFactByIndex,
  resetChat,
  saveWorkingDraft,
} from "@/lib/editor-state";

export async function saveDraftDebouncedAction(text: string) {
  await saveWorkingDraft(text);
}

export async function resetChatAction() {
  await resetChat();
  revalidatePath("/resume/edit");
}

export async function forgetFactAction(index: number) {
  await removeFactByIndex(index);
  revalidatePath("/resume/edit");
}
