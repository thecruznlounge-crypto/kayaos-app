// Kayaos work importer: reads pasted or uploaded text (a text message, email, or schedule) and returns shifts and payments.
// Deploy as an Edge Function named "parse-work". Uses the same ANTHROPIC_API_KEY secret. Signed-in users only.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PROMPT = (today: string) => String.raw`You extract work records from text the user pasted or uploaded (a text message, an email, or a schedule).
Today's date is ${today}. Use it to work out years when a date has none.

Return STRICTLY a raw JSON object, no code fences, no commentary, in this shape:
{"entries":[{"kind":"shift","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","hours":null,"amount":null,"job":null,"ref":null,"note":null}]}

Rules:
1. kind "shift" = time worked. Use start and end in 24-hour HH:MM when given. If only a total is given, put it in hours and leave start and end null.
2. kind "pay" = a payment received for work. Put the money in amount. Put a payment reference or confirmation number in ref.
3. job = the employer, client, or job name if it is stated, else null. note = short context from the text.
4. Ignore ads, promotions, and anything that is not a shift or payment. If nothing matches, return {"entries":[]}.
5. Never invent values. Use null when something is not in the text.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return new Response("Unauthorized", { status: 401, headers: cors });
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return new Response("Unauthorized", { status: 401, headers: cors });

    const body = await req.json().catch(() => ({}));
    const text = String(body.text || "").trim().slice(0, 20000);
    if (!text) return new Response("Missing text", { status: 400, headers: cors });
    const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || "") ? body.today : new Date().toISOString().slice(0, 10);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
        max_tokens: 1500,
        messages: [{ role: "user", content: `${PROMPT(today)}\n\n---\n${text}\n---` }],
      }),
    });
    if (!r.ok) return new Response("The importer is unavailable right now", { status: 502, headers: cors });
    const j = await r.json();
    const raw = (j.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim();
    const clean = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    let parsed: { entries?: Array<Record<string, unknown>> };
    try { parsed = JSON.parse(clean); } catch { return new Response("Could not read entries from this text", { status: 422, headers: cors }); }

    const ymdOk = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const hm = (v: unknown) => typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, "0") : null;
    const num = (v: unknown, max: number) => { const n = Number(v); return v != null && n > 0 && n < max ? Math.round(n * 100) / 100 : null; };
    const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    const entries = (parsed.entries || []).slice(0, 100).flatMap((e) => {
      if (!ymdOk(e.date)) return [];
      if (e.kind === "shift") {
        return [{ kind: "shift", date: e.date, start: hm(e.start), end: hm(e.end), hours: num(e.hours, 240), job: str(e.job, 60), note: str(e.note, 120) }];
      }
      if (e.kind === "pay") {
        const amount = num(e.amount, 100000);
        return amount ? [{ kind: "pay", date: e.date, amount, job: str(e.job, 60), ref: str(e.ref, 60), note: str(e.note, 120) }] : [];
      }
      return [];
    });
    return new Response(JSON.stringify({ entries }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(String(e instanceof Error ? e.message : e), { status: 500, headers: cors });
  }
});
