// Kayaos natural voices: turns a reminder sentence into speech with OpenAI's gpt-4o-mini-tts.
// Deploy as an Edge Function named "tts". Uses the same OPENAI_API_KEY secret as process-voice-task.
// Only signed-in Kayaos users can call it. The app caches every sentence on the phone, so repeats are free.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const VOICES = ["marin", "coral", "nova", "shimmer", "sage", "cedar", "onyx", "ash", "echo", "verse"];
const ACCENTS: Record<string, string> = {
  auto: "a neutral American",
  us: "a natural American",
  uk: "a natural British (London)",
  au: "a natural Australian",
  in: "a natural Indian English",
  ie: "a natural Irish",
  za: "a natural South African",
  jm: "a natural Jamaican",
  latam: "a natural Latino / Spanish-speaking (Miami)",
};

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
    const text = String(body.text || "").trim().slice(0, 600);
    if (!text) return new Response("Missing text", { status: 400, headers: cors });
    const voice = VOICES.includes(body.voice) ? body.voice : "marin";
    const accent = ACCENTS[body.accent] || ACCENTS.auto;
    const male = body.gender === "male" || ["onyx", "ash", "cedar", "echo", "verse"].includes(voice);

    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        input: text,
        response_format: "mp3",
        instructions:
          `Speak with ${accent} accent. ` +
          (male ? "Use a clearly adult MALE voice: deep, low-pitched, relaxed and masculine — like a dad or coach. " : "Use a clearly adult female voice. ") +
          `Sound like a warm, real person reminding a family member — friendly, ` +
          `natural pacing and intonation, never robotic. Slightly upbeat; a little firmer if the text says something is late.`,
      }),
    });
    if (!r.ok) return new Response(await r.text(), { status: 502, headers: cors });
    return new Response(r.body, { headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=31536000" } });
  } catch (e) {
    return new Response(String(e instanceof Error ? e.message : e), { status: 500, headers: cors });
  }
});
