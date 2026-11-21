// Kayaos media clean-up: runs on a schedule (see README / schema.sql) so old photos and videos are removed
// even when nobody opens the app. Same rule as the app:
//   • finished card, proof approved      → removed 7 days after approval
//   • finished card, no proof            → removed 7 days after it was finished
//   • finished card, proof NOT reviewed  → kept 30 days so a parent / team lead can still see it
// Deploy as an Edge Function named "cleanup-media". Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (already set).
// Only callable with the service-role key (the scheduled job sends it), so nobody else can trigger deletes.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DAY = 864e5, KEEP_DAYS = 7, UNREVIEWED_KEEP_DAYS = 30, BUCKET = "kayaos-media";

type Media = { id: string; role?: string; path?: string; at?: number };
type Review = { for?: string; state?: string; at?: number } | null;

function expiry(doneAt: number, media: Media[], review: Review): number {
  const hasProof = media.some((m) => m.role === "proof");
  const ok = !!review && review.for === "once" && review.state === "ok";
  if (hasProof && !ok) return doneAt + UNREVIEWED_KEEP_DAYS * DAY;
  return Math.max(doneAt, ok ? Number(review!.at) || 0 : 0) + KEEP_DAYS * DAY;
}

serve(async (req) => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (!key || token !== key) return new Response("Unauthorized", { status: 401 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const { data, error } = await sb.from("tasks")
    .select("id, media, review, done_at")
    .eq("is_completed", true).not("done_at", "is", null).neq("media", "[]").limit(500);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const now = Date.now();
  let cards = 0, files = 0;
  for (const row of data || []) {
    const media: Media[] = Array.isArray(row.media) ? row.media : [];
    if (!media.length) continue;
    if (expiry(Date.parse(row.done_at), media, row.review) > now) continue;
    const paths = media.map((m) => m.path).filter((p): p is string => !!p);
    if (paths.length) {
      const { error: rmErr } = await sb.storage.from(BUCKET).remove(paths);
      if (rmErr) continue; // try again next run
      files += paths.length;
    }
    await sb.from("tasks").update({ media: [] }).eq("id", row.id);
    cards++;
  }
  return new Response(JSON.stringify({ checked: (data || []).length, cards, files }), { headers: { "Content-Type": "application/json" } });
});
