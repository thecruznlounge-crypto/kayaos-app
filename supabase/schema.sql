-- Kayaos.space Supabase schema
-- Safe to run on a NEW project or re-run on an EXISTING one (it upgrades the old table in place).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'Personal',
  target_date DATE,                -- NULL = card has no due date
  target_time TIME,
  repeat_type TEXT DEFAULT 'none' CHECK (repeat_type IN ('none','daily','weekly','monthly')),
  reminder_minutes INT DEFAULT 15,
  is_location_dependent BOOLEAN DEFAULT FALSE,
  raw_address_or_venue TEXT,
  search_term_for_maps_api TEXT,
  gps_coordinates POINT,
  is_high_priority BOOLEAN DEFAULT FALSE,
  time_window_hours INT DEFAULT 12,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE
);

-- Upgrade older installs ------------------------------------------------------
-- 1. Category was a 5-value enum, which silently turned School/Bills/Errands/etc. into "Personal".
ALTER TABLE public.tasks ALTER COLUMN category DROP DEFAULT;
ALTER TABLE public.tasks ALTER COLUMN category TYPE TEXT USING category::text;
ALTER TABLE public.tasks ALTER COLUMN category SET DEFAULT 'Personal';
DROP TYPE IF EXISTS task_category;

-- 2. Due date is now optional.
ALTER TABLE public.tasks ALTER COLUMN target_date DROP NOT NULL;
ALTER TABLE public.tasks ALTER COLUMN target_date DROP DEFAULT;

-- 3. New card fields: alert style, re-alert interval, who the voice speaks to, per-occurrence completion.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS alert_style TEXT DEFAULT 'both';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS nag_minutes INT DEFAULT 0;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assignee_name TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_for DATE;  -- for repeating cards: which occurrence was done
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS start_time TIME;  -- optional start; meter + "time to start" alert
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]'::jsonb;  -- [{"t":"Milk","d":false}]
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS near_me BOOLEAN DEFAULT FALSE;  -- remind when near the place
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS media JSONB DEFAULT '[]'::jsonb;  -- how-to + proof photos/videos (files live in storage)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS proof_required BOOLEAN DEFAULT FALSE;  -- Done needs a photo/video
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2);  -- bill payment amount
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS link TEXT;            -- website / phone link on a card
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS link_app JSONB;        -- {pkg,name}: app to open on Android
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS confirmation TEXT;          -- travel confirmation #
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS checkin_reminder BOOLEAN DEFAULT FALSE;  -- alert 24 h before a flight
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS flight_no TEXT;             -- e.g. DL 1234 (live gate/status button)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS terminal TEXT;              -- airport terminal
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS payments JSONB DEFAULT '[]'::jsonb;  -- bill payments: date, amount, reference #
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS installments INTEGER DEFAULT 0;   -- bill installment plan: stops after N payments (0 = ongoing)
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_repeat_type_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_repeat_type_check CHECK (repeat_type IN ('none','daily','weekly','biweekly','monthly'));
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS review JSONB;           -- proof review: approved / redo (+ note)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;    -- when the card was finished (media clean-up clock)

-- =============================================================================
-- TEAMS: share cards with family or crew, assign them to people
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.team_members (
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'Member',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON public.team_members(user_id);

-- Cards can belong to a team and be assigned to one member.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_team ON public.tasks(team_id);

-- Helpers (SECURITY DEFINER so policies can check membership without recursion)
CREATE OR REPLACE FUNCTION public.is_team_member(t UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = t AND user_id = auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.is_team_owner(t UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = t AND user_id = auth.uid() AND role = 'owner');
$$;
CREATE OR REPLACE FUNCTION public.new_invite_code() RETURNS TEXT
LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

-- Create a team (caller becomes owner)
CREATE OR REPLACE FUNCTION public.create_team(p_name TEXT, p_display_name TEXT) RETURNS public.teams
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.teams;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  INSERT INTO public.teams(name, owner_id, invite_code) VALUES (trim(p_name), auth.uid(), public.new_invite_code()) RETURNING * INTO t;
  INSERT INTO public.team_members(team_id, user_id, display_name, role)
    VALUES (t.id, auth.uid(), COALESCE(NULLIF(trim(p_display_name), ''), 'Owner'), 'owner');
  RETURN t;
END $$;

-- Join with an invite code (re-joining just updates your display name)
CREATE OR REPLACE FUNCTION public.join_team(p_code TEXT, p_display_name TEXT) RETURNS public.teams
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.teams;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO t FROM public.teams WHERE invite_code = upper(trim(p_code));
  IF t.id IS NULL THEN RAISE EXCEPTION 'Invite code not found'; END IF;
  INSERT INTO public.team_members(team_id, user_id, display_name, role)
    VALUES (t.id, auth.uid(), COALESCE(NULLIF(trim(p_display_name), ''), 'Member'), 'member')
  ON CONFLICT (team_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name;
  RETURN t;
END $$;

-- Owner can issue a new code (old code stops working)
CREATE OR REPLACE FUNCTION public.rotate_invite(p_team UUID) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c TEXT := public.new_invite_code();
BEGIN
  IF NOT public.is_team_owner(p_team) THEN RAISE EXCEPTION 'Only the team owner can do that'; END IF;
  UPDATE public.teams SET invite_code = c WHERE id = p_team;
  RETURN c;
END $$;

REVOKE ALL ON FUNCTION public.create_team(TEXT, TEXT), public.join_team(TEXT, TEXT), public.rotate_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_team(TEXT, TEXT), public.join_team(TEXT, TEXT), public.rotate_invite(UUID) TO authenticated;

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members see their teams" ON public.teams;
DROP POLICY IF EXISTS "Owner renames team" ON public.teams;
DROP POLICY IF EXISTS "Owner deletes team" ON public.teams;
CREATE POLICY "Members see their teams" ON public.teams FOR SELECT USING (public.is_team_member(id));
CREATE POLICY "Owner renames team"      ON public.teams FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owner deletes team"      ON public.teams FOR DELETE USING (owner_id = auth.uid());
-- (teams are created only through create_team)

DROP POLICY IF EXISTS "Members see teammates" ON public.team_members;
DROP POLICY IF EXISTS "Leave or owner removes" ON public.team_members;
CREATE POLICY "Members see teammates"  ON public.team_members FOR SELECT USING (public.is_team_member(team_id));
CREATE POLICY "Leave or owner removes" ON public.team_members FOR DELETE USING (user_id = auth.uid() OR public.is_team_owner(team_id));
-- (members are added only through create_team / join_team)

-- The creator of a card can never be changed (teammates can complete/edit, not take over).
CREATE OR REPLACE FUNCTION public.keep_task_creator() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.user_id := OLD.user_id;
  NEW.created_at := OLD.created_at;
  IF NEW.team_id IS NULL THEN NEW.assigned_to := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_keep_task_creator ON public.tasks;
CREATE TRIGGER trg_keep_task_creator BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.keep_task_creator();

-- =============================================================================
-- TASKS row level security: your own cards + cards shared with your teams
-- =============================================================================
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create their own tasks." ON public.tasks;
DROP POLICY IF EXISTS "Users can view their own tasks." ON public.tasks;
DROP POLICY IF EXISTS "Users can update their own tasks." ON public.tasks;
DROP POLICY IF EXISTS "Users can delete their own tasks." ON public.tasks;
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;

CREATE POLICY "tasks_select" ON public.tasks FOR SELECT
  USING (user_id = auth.uid() OR (team_id IS NOT NULL AND public.is_team_member(team_id)));
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT
  WITH CHECK (user_id = auth.uid() AND (team_id IS NULL OR public.is_team_member(team_id)));
-- Any teammate can update a shared card (e.g. mark it done); the creator never changes.
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE
  USING (user_id = auth.uid() OR (team_id IS NOT NULL AND public.is_team_member(team_id)))
  WITH CHECK ((user_id = auth.uid() OR (team_id IS NOT NULL AND public.is_team_member(team_id))) AND (team_id IS NULL OR public.is_team_member(team_id)));
-- Only the creator or the team owner can delete.
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE
  USING (user_id = auth.uid() OR (team_id IS NOT NULL AND public.is_team_owner(team_id)));

CREATE INDEX IF NOT EXISTS idx_tasks_user_due ON public.tasks(user_id, target_date, target_time);
CREATE INDEX IF NOT EXISTS idx_tasks_user_complete ON public.tasks(user_id, is_completed);

-- Live updates: teammates see new / completed cards within seconds.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

-- =============================================================================
-- PHOTOS / VIDEOS: private storage bucket "kayaos-media"
-- Files live at  <team_id or user_id>/<task_id>/<file>. You can read/write your own folder
-- and the folders of teams you belong to. Nobody else can see them.
-- =============================================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('kayaos-media', 'kayaos-media', false)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_use_media(folder TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT folder = auth.uid()::text
      OR (folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND public.is_team_member(folder::uuid));
$$;

DROP POLICY IF EXISTS "kayaos media read" ON storage.objects;
DROP POLICY IF EXISTS "kayaos media upload" ON storage.objects;
DROP POLICY IF EXISTS "kayaos media update" ON storage.objects;
DROP POLICY IF EXISTS "kayaos media delete" ON storage.objects;
CREATE POLICY "kayaos media read"   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'kayaos-media' AND public.can_use_media((storage.foldername(name))[1]));
CREATE POLICY "kayaos media upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'kayaos-media' AND public.can_use_media((storage.foldername(name))[1]));
CREATE POLICY "kayaos media update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'kayaos-media' AND public.can_use_media((storage.foldername(name))[1]));
CREATE POLICY "kayaos media delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'kayaos-media' AND public.can_use_media((storage.foldername(name))[1]));

-- =============================================================================
-- OPTIONAL: nightly media clean-up on the server (Edge Function "cleanup-media")
-- Removes old photos/videos even if nobody opens the app. Steps:
--   1. Deploy supabase/functions/cleanup-media/index.ts as "cleanup-media".
--   2. Database → Extensions: turn on pg_cron and pg_net.
--   3. Fill in your project URL + service-role key below, remove the leading "-- ", and run it once.
--      (Both are stored encrypted in Supabase Vault, not in plain text.)
-- =============================================================================
-- select vault.create_secret('https://YOUR-PROJECT.supabase.co', 'kayaos_url');
-- select vault.create_secret('YOUR-SERVICE-ROLE-KEY', 'kayaos_service_key');
-- select cron.schedule('kayaos-cleanup-media', '17 3 * * *', $job$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'kayaos_url') || '/functions/v1/cleanup-media',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
--                'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'kayaos_service_key')),
--     body := '{}'::jsonb);
-- $job$);

-- =============================================================================
-- OWNERS DASHBOARD: only accounts listed in app_owners can read these numbers.
-- Safe to re-run. Nobody can read or write app_owners through the API; it is
-- managed from the SQL editor only.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.app_owners (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.app_owners ENABLE ROW LEVEL SECURITY;  -- no policies = no API access

CREATE OR REPLACE FUNCTION public.is_app_owner() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_owners WHERE user_id = auth.uid());
$$;

-- Totals only (no card content, no file names)
CREATE OR REPLACE FUNCTION public.owner_dashboard() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, storage AS $$
DECLARE r JSONB;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Owners only'; END IF;
  SELECT jsonb_build_object(
    'generated_at',      now(),
    'users',             (SELECT count(*) FROM auth.users),
    'signups_7d',        (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '7 days'),
    'signups_30d',       (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '30 days'),
    'active_users_30d',  (SELECT count(DISTINCT user_id) FROM public.tasks WHERE created_at > now() - interval '30 days'),
    'cards',             (SELECT count(*) FROM public.tasks),
    'cards_open',        (SELECT count(*) FROM public.tasks WHERE NOT is_completed),
    'cards_done',        (SELECT count(*) FROM public.tasks WHERE is_completed),
    'cards_30d',         (SELECT count(*) FROM public.tasks WHERE created_at > now() - interval '30 days'),
    'cards_with_media',  (SELECT count(*) FROM public.tasks WHERE jsonb_array_length(COALESCE(media, '[]'::jsonb)) > 0),
    'teams',             (SELECT count(*) FROM public.teams),
    'team_members',      (SELECT count(*) FROM public.team_members),
    'media_files',       (SELECT count(*) FROM storage.objects WHERE bucket_id = 'kayaos-media'),
    'media_bytes',       (SELECT COALESCE(sum((metadata->>'size')::bigint), 0) FROM storage.objects WHERE bucket_id = 'kayaos-media')
  ) INTO r;
  RETURN r;
END $$;

-- One row per user (newest first, up to 200): email, sign-up, last sign-in, card and team counts
CREATE OR REPLACE FUNCTION public.owner_users()
RETURNS TABLE (user_email TEXT, signed_up TIMESTAMPTZ, last_seen TIMESTAMPTZ, cards BIGINT, open_cards BIGINT, teams BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Owners only'; END IF;
  RETURN QUERY
    SELECT u.email::text, u.created_at, u.last_sign_in_at,
      (SELECT count(*) FROM public.tasks t WHERE t.user_id = u.id),
      (SELECT count(*) FROM public.tasks t WHERE t.user_id = u.id AND NOT t.is_completed),
      (SELECT count(*) FROM public.team_members m WHERE m.user_id = u.id)
    FROM auth.users u
    ORDER BY u.created_at DESC
    LIMIT 200;
END $$;

REVOKE ALL ON FUNCTION public.is_app_owner(), public.owner_dashboard(), public.owner_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_app_owner(), public.owner_dashboard(), public.owner_users() TO authenticated;

-- MAKE ME AN OWNER: run this once in the SQL editor, with the email you sign in to Kayaos with.
-- insert into public.app_owners (user_id) select id from auth.users where email = 'YOUR-EMAIL@example.com' on conflict do nothing;

-- FUEL SYNC (optional sign-in): vehicles, fill-ups and favorites follow the account across devices.
-- Photos use the private "kayaos-media" bucket under the account's own folder (<user id>/fuel/...), which the rules above allow.
CREATE TABLE IF NOT EXISTS public.fuel_vehicles (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  fuel        TEXT NOT NULL DEFAULT 'Regular',
  photo_path  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fuel_logs (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id  UUID NOT NULL REFERENCES public.fuel_vehicles(id) ON DELETE CASCADE,
  fill_date   DATE NOT NULL,
  fuel_type   TEXT,
  unit        TEXT,
  amount      NUMERIC,
  total       NUMERIC,
  price       NUMERIC,
  odometer    NUMERIC,
  station     TEXT,
  job_id      TEXT,
  note        TEXT,
  photo_path  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Who paid for each fill-up and whether the owner has paid it back (keeps reimbursement ticks across devices)
ALTER TABLE public.fuel_logs ADD COLUMN IF NOT EXISTS payer TEXT NOT NULL DEFAULT 'me';
ALTER TABLE public.fuel_logs ADD COLUMN IF NOT EXISTS reimb BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.fuel_favorites (
  id          TEXT NOT NULL,
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('brand', 'place')),
  name        TEXT NOT NULL,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  osm_id      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
ALTER TABLE public.fuel_vehicles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fuel_vehicles own"  ON public.fuel_vehicles;
DROP POLICY IF EXISTS "fuel_logs own"      ON public.fuel_logs;
DROP POLICY IF EXISTS "fuel_favorites own" ON public.fuel_favorites;
CREATE POLICY "fuel_vehicles own"  ON public.fuel_vehicles  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "fuel_logs own"      ON public.fuel_logs      FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "fuel_favorites own" ON public.fuel_favorites FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- WORK DATA: jobs, shifts and payments, one record per account (synced between devices)
CREATE TABLE IF NOT EXISTS public.work_data (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.work_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "work_data own" ON public.work_data;
CREATE POLICY "work_data own" ON public.work_data FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- FUEL PRICES: community reports. Anyone can read them; signed-in users add their own.
CREATE TABLE IF NOT EXISTS public.fuel_prices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  station_key  TEXT NOT NULL,
  station_name TEXT,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  fuel_type    TEXT NOT NULL,
  price        NUMERIC NOT NULL CHECK (price > 0 AND price < 50),
  reported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fuel_prices ADD COLUMN IF NOT EXISTS photo_path TEXT;  -- price-sign photo in kayaos-media (folder: <user id>/prices/)
CREATE INDEX IF NOT EXISTS fuel_prices_geo ON public.fuel_prices (lat, lng, reported_at DESC);
-- Anyone signed in can view price-sign photos (they sit under <user id>/prices/ in the kayaos-media bucket)
DROP POLICY IF EXISTS "kayaos price photos read" ON storage.objects;
CREATE POLICY "kayaos price photos read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'kayaos-media' AND (storage.foldername(name))[2] = 'prices');
ALTER TABLE public.fuel_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fuel_prices read" ON public.fuel_prices;
DROP POLICY IF EXISTS "fuel_prices add" ON public.fuel_prices;
DROP POLICY IF EXISTS "fuel_prices delete own" ON public.fuel_prices;
CREATE POLICY "fuel_prices read"       ON public.fuel_prices FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "fuel_prices add"        ON public.fuel_prices FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "fuel_prices delete own" ON public.fuel_prices FOR DELETE TO authenticated USING (user_id = auth.uid());
