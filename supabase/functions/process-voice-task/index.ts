import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const CATEGORIES = ["Work", "Personal", "School", "Errands", "Groceries", "Bills", "Appointments", "Travel", "Family", "Health"];

const MASTER_AI_ENGINE_PROMPT = `You are the core backend processing engine for Kayaos.space, a highly minimalist organizer app built on a 12-hour urgency clock and weekly calendar tracking. Your sole job is to ingest unstructured, messy, or chaotic voice-to-text transcripts from the user and structure them into clean, reliable JSON data.

The user's current local date and time is: {{CURRENT_DATETIME}} (time zone: {{TIMEZONE}}). Resolve words like today, tomorrow and Friday against THIS local time, not UTC.

CRITICAL RULES:
1. ABSOLUTELY NO CONVERSATIONAL FILLER. Output ONLY the valid raw JSON object.
2. If the user does not specify a date or time, default the task to Today and calculate the 12-hour urgency factor based on the system timestamp.
3. Keep task titles stark, punchy, and minimalist. Strip out conversational words like "I need to go ahead and..." or "Can you remind me to...".
4. Categories must be exactly one of: Work, Personal, School, Errands, Groceries, Bills, Appointments, Travel, Family, Health. Grocery and food shopping is Groceries. Homework, assignments, tests and anything for a class are School.
5. Include search_term_for_maps_api when a location, venue, store, or address is mentioned.
6. People talk naturally and ramble ("um so my son has this science thing due next Thursday after school, remind him like two hours before"). Extract the ONE main task, the right date/time (after school = 15:30, end of day = 17:00, before bed = 20:30), the reminder lead time, and any repeat.
7. If the person lists things to buy or steps to do, put them in "checklist" as short items (e.g. ["Milk","Eggs","Bread"]); otherwise use [].

TARGET JSON OUTPUT SCHEMA:
{
  "task": {
    "title": "String max 5 words",
    "description": "String or null",
    "category": "Work | Personal | School | Errands | Groceries | Bills | Appointments | Travel | Family | Health",
    "target_date": "YYYY-MM-DD",
    "target_time": "HH:MM or null"
  },
  "checklist": ["String"],
  "location_context": {
    "is_location_dependent": true,
    "raw_address_or_venue": "String or null",
    "search_term_for_maps_api": "String or null"
  },
  "urgency": {
    "is_high_priority": false,
    "time_window_hours": 12
  },
  "recurrence": {
    "enabled": false,
    "type": "none | daily | weekly | biweekly | monthly"
  },
  "reminders": {
    "enabled": true,
    "notification": true,
    "sound": true,
    "voice": true,
    "times": [{"offset_minutes": 15}]
  }
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const formData = await req.formData();
    const clientNow = String(formData.get("client_now") || new Date().toString());
    const timezone = String(formData.get("timezone") || "UTC");
    // Text mode: the app already has the words (browser speech recognition) and just wants them understood.
    const textIn = String(formData.get("text") || "").trim().slice(0, 2000);
    const dryRun = String(formData.get("dry_run") || "") === "1";
    let userTranscript = textIn;
    if (!userTranscript) {
      const audioFile = formData.get("voice_note");
      if (!(audioFile instanceof File)) return json({ error: "Missing voice_note file or text" }, 400);

      const whisperForm = new FormData();
      whisperForm.append("file", audioFile, audioFile.name || "input.webm");
      whisperForm.append("model", "whisper-1");

      const transcriptionRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
        body: whisperForm,
      });
      if (!transcriptionRes.ok) return json({ error: "Transcription failed", details: await transcriptionRes.text() }, 500);
      userTranscript = (await transcriptionRes.json()).text;
    }

    const systemPrompt = MASTER_AI_ENGINE_PROMPT.replace("{{CURRENT_DATETIME}}", clientNow).replace("{{TIMEZONE}}", timezone);
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userTranscript },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!aiRes.ok) return json({ error: "AI structuring failed", details: await aiRes.text() }, 500);

    const aiJson = await aiRes.json();
    const aiPayload = JSON.parse(aiJson.choices[0].message.content);
    if (dryRun) return json({ success: true, transcript: userTranscript, aiPayload });

    const searchTerm = aiPayload.location_context?.search_term_for_maps_api || aiPayload.location_context?.raw_address_or_venue;
    let gpsPoint: string | null = null;
    if (aiPayload.location_context?.is_location_dependent && searchTerm) {
      const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchTerm)}&format=jsonv2&limit=1`, {
        headers: { "User-Agent": "KayaosSpaceMinimalistOrganizerApp/1.0 contact:kayaos.space" },
      });
      const geoData = await geoRes.json();
      if (Array.isArray(geoData) && geoData[0]) gpsPoint = `(${geoData[0].lon},${geoData[0].lat})`;
    }

    const { data, error } = await supabase.from("tasks").insert({
      user_id: user.id,
      title: aiPayload.task.title,
      description: aiPayload.task.description,
      category: CATEGORIES.includes(aiPayload.task?.category) ? aiPayload.task.category : "Personal",
      target_date: aiPayload.task.target_date,
      target_time: aiPayload.task.target_time || "12:00",
      repeat_type: aiPayload.recurrence?.type || "none",
      reminder_minutes: aiPayload.reminders?.times?.[0]?.offset_minutes ?? 15,
      is_location_dependent: !!aiPayload.location_context?.is_location_dependent,
      raw_address_or_venue: aiPayload.location_context?.raw_address_or_venue || null,
      search_term_for_maps_api: searchTerm || null,
      gps_coordinates: gpsPoint,
      is_high_priority: !!aiPayload.urgency?.is_high_priority,
      time_window_hours: aiPayload.urgency?.time_window_hours || 12,
      checklist: Array.isArray(aiPayload.checklist) ? aiPayload.checklist.map((t: unknown) => ({ t: String(t).slice(0, 80), d: false })) : [],
      alert_style: "both",
      nag_minutes: aiPayload.task?.category === "School" ? 10 : 0,
    }).select().single();

    if (error) return json({ error: error.message }, 500);
    return json({ success: true, transcript: userTranscript, aiPayload, data });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
