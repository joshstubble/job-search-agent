"use server";

import { revalidatePath } from "next/cache";

import sql from "@/lib/db";

export async function toggleSourceAction(name: string, enabled: boolean) {
  await sql`UPDATE sources SET enabled = ${enabled} WHERE name = ${name}`;
  revalidatePath("/settings");
}
