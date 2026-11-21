// Kayaos fuel price reader: sends a photo of a gas station price sign to Claude and returns the per-gallon prices.
// Deploy as an Edge Function named "read-price-sign". Needs the secret ANTHROPIC_API_KEY (optional: ANTHROPIC_MODEL).
// Only signed-in Kayaos users can call it. The app shows the numbers for you to check before anything is shared.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const GRADES = ["regular", "midGrade", "premium", "diesel", "e85"];
const PROMPT = String.raw`You are a precise data extraction engine specializing in fuel retail infrastructure.
Analyze the provided image of a gas station price display sign.

Your task is to locate the per-gallon prices for each fuel grade visible on the sign.
Look closely for vertical text alignment, color-coded price blocks, and the small fractional 9/10 numbers floating at the end of each price (e.g., \$3.95 9/10 must be evaluated as 3.959).

Return your findings STRICTLY as a raw JSON object matching the schema below.
Do not wrap your response in markdown code blocks (no code fences). Do not provide any conversational text before or after the JSON payload.

Target JSON Schema:
{
  "regular": 0.000,
  "midGrade": 0.000,
  "premium": 0.000,
  "diesel": 0.000,
  "e85": 0.000
}

Rules:
1. Ensure prices are returned as numeric values (floats) out to three decimal places.
2. If a specific fuel grade is missing, unreadable, or not sold at this location, entirely omit that key from the final JSON object.`;

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
    const image = String(body.image || "");
    if (!image) return new Response("Missing image", { status: 400, headers: cors });
    if (image.length > 6_000_000) return new Response("Photo too large", { status: 413, headers: cors });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
        max_tokens: 200,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: PROMPT },
        ] }],
      }),
    });
    if (!r.ok) return new Response("The price reader is unavailable right now", { status: 502, headers: cors });
    const j = await r.json();
    const text = (j.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim();
    const clean = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(clean); } catch { return new Response("Could not read prices from this photo", { status: 422, headers: cors }); }
    const out: Record<string, number> = {};
    for (const k of GRADES) {
      const v = Number(parsed[k]);
      if (v > 0 && v < 50) out[k] = Math.round(v * 1000) / 1000;
    }
    return new Response(JSON.stringify(out), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(String(e instanceof Error ? e.message : e), { status: 500, headers: cors });
  }
});
