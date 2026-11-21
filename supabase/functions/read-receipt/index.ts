// Kayaos fuel receipt reader: sends a fuel receipt photo to Claude and returns the fill-up numbers.
// Deploy as an Edge Function named "read-receipt". Uses the same ANTHROPIC_API_KEY secret as read-price-sign.
// Only signed-in Kayaos users can call it. The app fills the form for you to check before saving.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const FUELS = ["regular", "midGrade", "premium", "diesel", "e85"];
const PROMPT = String.raw`You are a precise document-parsing OCR engine specializing in retail fuel transaction receipts.
Analyze the provided receipt image.

Your task is to extract the transaction variables required to complete a vehicle fuel log entry. Locate the exact type of fuel purchased, the quantity, the total transaction price, and calculate or locate the precise per-gallon price.

Return your findings STRICTLY as a raw JSON object matching the schema below.
Do not wrap your response in markdown code blocks (no code fences). Do not include text, explanations, or commentary.

Target JSON Schema:
{
  "date": "YYYY-MM-DD",
  "gallons": 0.00,
  "totalPaid": 0.00,
  "pricePerGallon": 0.00,
  "fuelTypeMatched": "regular"
}

Rules:
1. Extract "date" in the standard YYYY-MM-DD format based on the transaction timestamp.
2. Ensure "gallons", "totalPaid", and "pricePerGallon" are strict numbers (floats).
3. Map the purchase to the closest string match for "fuelTypeMatched" out of these strict options: ["regular", "midGrade", "premium", "diesel", "e85"].
4. If a field cannot be safely determined due to tears or ink blurriness, set that specific key value to null.`;

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
    if (!r.ok) return new Response("The receipt reader is unavailable right now", { status: 502, headers: cors });
    const j = await r.json();
    const text = (j.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim();
    const clean = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(clean); } catch { return new Response("Could not read this receipt", { status: 422, headers: cors }); }
    const num = (v: unknown, max: number) => { const n = Number(v); return v != null && n > 0 && n < max ? Math.round(n * 1000) / 1000 : null; };
    const date = typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
    const out = {
      date,
      gallons: num(parsed.gallons, 500),
      totalPaid: num(parsed.totalPaid, 5000),
      pricePerGallon: num(parsed.pricePerGallon, 50),
      fuelTypeMatched: FUELS.includes(String(parsed.fuelTypeMatched)) ? String(parsed.fuelTypeMatched) : null,
    };
    return new Response(JSON.stringify(out), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(String(e instanceof Error ? e.message : e), { status: 500, headers: cors });
  }
});
