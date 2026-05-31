import { clearSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function GET() {
  await clearSession();
  redirect("/login?error=logged-out");
}

export async function POST() {
  await clearSession();
  redirect("/login?error=logged-out");
}
