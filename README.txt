KAYAOS.SPACE — PWA PACKAGE
==========================

UPLOAD (cPanel → public_html)
  index.html, script.js, service-worker.js, manifest.webmanifest, favicon.ico,
  apple-touch-icon.png, icons/ (keep folder name), and config.js (your Supabase URL and key; leave blank for local-only use).
  Do NOT overwrite your filled-in config.js with the blank one from a new download.
  IMPORTANT: upload script.js — the app logic now lives there (it was duplicated inline before).
  Delete the old Namecheap parking-page.shtml from public_html if it is still there.
  Also upload .htaccess (it's a hidden file — in cPanel File Manager turn on Settings → "Show Hidden
  Files"). It tells browsers to always check for new versions of the app files.

UPDATES / CACHING
  Each release loads its own script.js?v=<build>, so a phone can never mix a new page with old code.
  If the app ever fails to start, it clears its own saved copies and reloads once by itself.
  When you edit files yourself, change the build number in index.html (KAYAOS_BUILD and both ?v=)
  and in service-worker.js (CACHE) so every phone picks up the change.

APP LAYOUT
  Install – orange button in the header (hidden once installed). One tap on Android/desktop Chrome;
           on iPhone it shows the Safari "Add to Home Screen" steps.
  Bottom bar – Cards · Week · Day · Place, then YOUR categories (up to 5, you choose — none by
           default), then ☰ More. Tap ＋ Categories (or More → Choose bar categories) to pick them,
           in the order you want; you can type a new category there too. Each category shows its
           open-card count (red = something overdue). The bar scrolls sideways on small phones.
  Cards  – every card, urgency meter + color that shifts green → red as it gets closer, search,
           category filter, ⋯ = clear menu
           Cards are compact (title, due, meter, ✓ Done). Tap a card and it pops up as a full card —
           checklist, notes, photos, reminders, place, and the 📷 🔊 ✎ × buttons. Close with ×, the
           dimmed background, or back. Week/Day rows and the Android widget open the same pop-up.
  Week   – 7-day strip + agenda, ‹ › to move weeks, tap a day to open it
  Day    – one day's timeline (morning / afternoon / evening / anytime)
  School – opens when "School" is in your bar (or via More): student name, "What's due", test alert
  Team   – via More: shared cards (needs cloud accounts). Create a team, Invite by link/code,
           assign cards to a person, filter Assigned to me / by me / Overdue. You get a chime +
           pop-up when someone finishes a card you assigned or assigns one to you. Assigned cards
           alert only the assignee. Only the creator or team owner can delete a shared card.
  Place  – map, location tracking, share location, check-ins
  +      – Add card. The 🧰 icon inside it opens Smart tools:
           AI voice, Notifications, Location tracking, Share location, Load demo cards
  Start  – every card has a start date & time (defaults to now). The meter fills from start to due;
           a future start triggers a "time to start" chime/voice alert.
  Splash – logo + name on launch; the header shows the current screen.
  ⚙      – Your name, default alert, quiet hours, voice (Female / Male, Accent, Voice quality,
           specific voice), test sounds, account sign-in. "Kayaos" is spoken as "chaos".
  Bills  – Bills cards have a Payment amount ($). It shows on the card (💵 $142.50), in the widget,
           and in spoken reminders ("Pay insurance, $142.50 is due at 5 PM"). Open the Bills category to
           see this month's total, paid, left and overdue, plus what's coming up in the next 30 days.
           Each bill shows Unpaid / ⚠ Overdue / ✓ Paid. Tapping ✓ Paid asks for the amount paid, the date and an
           optional confirmation/reference # (Kayaos doesn't check with the biller — you confirm it). The card then
           shows "✓ Paid Oct 14 · Ref FPL-88213"; repeating bills move to the next month and show "Last paid…".
           The pop-up lists recent payments. ↺ Undo removes that payment.
           Repeat options: daily, weekly, every 2 weeks (bi-weekly), monthly.
           Partial payments: type less than the full amount and the bill stays open ("Partly paid $30.00 · $70.00
           left"). It's done once the total is paid. The Bills total counts the partial payments.
           Progress: every bill card has a bar — "$30.00 paid of $100.00 · $70.00 left". Installment plans also show
           the whole plan ("$50.00 of $200.00 paid"). The Bills total has a bar for how much of this month is paid.
           Installments: set "Installments" to the number of payments (e.g. 6) with a repeat. The bill stops after
           that many; the card shows "Installment 2 of 6", and "✓ All 6 installments paid" when finished. Voice: "pay the light bill $86 on the 15th".
  Links  – every card has a Website link field (a site, a phone number or an email). The card gets a
           button for it: 🔗 site ↗ (📞 Call / ✉️ Email). Links open in a new tab; only web, phone and email
           links are allowed. Bills cards call it "Pay link", show quick picks (PayPal, Chase, FPL,
           Xfinity, Geico…) and the button reads 💳 Pay now ↗. In the Android app, "📱 Pick an app on this
           phone" lets the card open your bank/biller app instead ("💳 Pay in Chase"); picking a biller also
           finds its app automatically. If that app isn't on a phone, the website opens (or the Play Store).
  Travel – Travel cards call the link "Booking link" and show quick picks: airlines (American, Delta, United,
           Southwest, JetBlue, Frontier), stays (Marriott, Hilton, Airbnb, Expedia) and rides (Uber, Lyft).
           The button matches: ✈️ Check in ↗, 🏨 View booking ↗, 🚗 Open Uber. Add a Confirmation # — it shows on
           the card as 🎫 QX7P2L; tap it to copy. Add the Flight # (e.g. DL 1234 — or just 1234 after picking the
           airline) and Terminal: the card shows ✈️ DL 1234 · Terminal S and a 🛫 Gate & status button that opens
           live flight status (current gate, terminal, delays). Gates aren't typed in because they change. "✈️ Remind me to check in 24 hours before" adds an alert a day
           ahead that also reads out the confirmation #. Voice: "flight to Atlanta on Delta Friday at 6am
           confirmation number QX7P2L" fills all of it.
           🧳 Add a packing list (Travel cards) adds ID, boarding pass, charger, meds… to the card's checklist.
           Check-ins also appear on the Day and Week screens (and the Android widget) on the day they open.
           Flight # and terminal are labeled as what you entered; 🛫 Live gate & status shows the airline's info.
  Groceries – its own category with store quick picks (Publix, Walmart, Target, Costco, Sam's Club, BJ's, Aldi,
           Kroger, Winn-Dixie, Whole Foods, Trader Joe's, Instacart). The card gets 🛒 Shop Publix ↗ / 🛒 Order on
           Instacart, plus its checklist. In the Android app, picking a store also finds its app.
  Opening links – installed Kayaos (Home Screen app): sites open inside the Kayaos window with a × bar to come back.
           Android app: sites open in an in-app browser tab over Kayaos; Back returns. In a regular browser: new tab.
           Sign-ins are remembered by the phone's browser and password manager (Google Password Manager / iCloud
           Keychain), so you log in to each site once. Kayaos itself never stores passwords.
  Directions – any card with a place gets 🧭 Directions (Google Maps; Apple Maps on iPhone).
  Checklist – any card can hold a checklist (grocery list, packing list, steps). Tick items right
           on the card. Voice: "add milk, eggs and bread to the grocery list" (creates the list in
           Groceries if it doesn't exist yet). "add paper towels to the Costco list" makes a Costco list.
  Near-me – "📍 Remind me when I'm near this place" on a card: when you get within ~350 m it chimes
           and reads what's left on the list. Works while Kayaos is open with tracking on.
  Photos & videos – 📷 on any card → choose Proof or How-to, then 📷 Take photo, 🎥 Record video, or
           🖼 Gallery (how-to only — proof must come from the camera so old pictures can't count). Turn on "📸 Require a photo/video as proof to finish" and Done opens
           the camera — the card can't be finished (and reminders keep going) until proof is added.
           Photos are shrunk to ~1000px; videos up to 15 s.
  Proof review – a finished card with proof shows the photo right on the card with "👀 Proof to review".
           Tap the photo to see it full size. 👍 Looks good approves it; 🔁 Redo sends the card back (with an
           optional note): it's no longer done, the old photo doesn't count, and reminders start again until new
           proof is taken. On teams the person who did the card can't approve their own proof, they get a pop-up
           for "approved" / "redo", and Team → "👀 To review" lists everything waiting on you.
  Media clean-up – photos/videos are removed 7 days after the proof is approved (or 7 days after a card with
           no proof is finished). Proof nobody has reviewed is kept 30 days. The pop-up shows the removal date.
           With cloud accounts, media syncs privately (bucket "kayaos-media") so a parent's how-to shows on
           the child's phone and the child's proof shows on the parent's — only your team can see it.
  Voice understanding – speak naturally ("um so Jayden has a science project due next Thursday after
           school, remind him two hours before"). When signed in, the cloud AI understands even
           longer, rambling sentences.

ALERTS
  • Chime, voice, chime+voice, or silent per card. Voice speaks by name:
    "Hey Jayden, Math worksheet is due at 8:00 PM. That's in 1 hour."
  • "Re-alert every N min until done" keeps chiming/speaking until the card is marked done
    (stops 12 hours after the due time). School cards default to 1 hr before + every 10 min.
  • Alerts play while Kayaos is open (foreground or recently backgrounded). Browsers do not let a
    web app play sound when fully closed — for that you would need a push server or a native wrapper.
  • Phones require one tap in the app before sound can play. Tap 🧰 → Notifications once per device.

CLEARING
  × on a card deletes that card. ⋯ on the Cards screen: clear completed, clear all demo cards,
  or clear everything. Demo cards are labeled DEMO and never sync to the cloud.

CLOUD ACCOUNTS (optional — app works fully without them)
  1. Supabase SQL editor: run supabase/schema.sql (safe to re-run). It upgrades the old table and
     adds start date/time, checklist, near-me, media + proof, bill amount, link, confirmation #, check-in, flight # and terminal, bill payments, proof review columns, team tables, security rules,
     live updates, and the private "kayaos-media" storage bucket with its access rules.
     If live updates don't arrive: Database → Replication → make sure "tasks" is enabled.
  2. Deploy two Edge Functions (Secrets for both: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY):
       supabase/functions/process-voice-task/index.ts  as "process-voice-task"  (voice notes + sentence understanding)
       supabase/functions/tts/index.ts                 as "tts"                 (natural AI voices)
     Optional third function: supabase/functions/cleanup-media/index.ts as "cleanup-media" — removes old
     photos/videos on the server every night even if nobody opens the app. Turn on the pg_cron and pg_net
     extensions, then follow the short commented block at the end of schema.sql (paste your project URL +
     service-role key, remove the "-- ", run it once). If your service key starts with "sb_secret_", turn off
     "Verify JWT" for this one function in its settings.
     Natural voices: OpenAI gpt-4o-mini-tts. Every sentence is fetched once and then saved on the phone,
     so repeat reminders cost nothing. Users can switch to "Phone's built-in voice" in Settings.
     Male natural voice defaults to Onyx (deep). Note: in a phone's web browser only one built-in voice
     per accent exists (usually female) — for a real male voice use the natural voice or the Android app.
     Settings shows that natural voices are AI-generated (OpenAI requires telling users).
  3. Open config.js, paste the Supabase Project URL and anon key between the quotes (Project Settings → API),
     and upload it beside index.html. Keep your filled-in copy safe.
  4. Owners dashboard (optional): the schema creates an owner-only area. In the SQL editor, run the
     "make me an owner" line at the end of schema.sql with your own sign-up email. Then More → 👑 Owner
     dashboard shows users, cards, teams and photo storage. Only accounts listed in app_owners can open it.
  Signing in uploads any local cards first, then syncs. Sign in with the same account on your
  son's device so his assignments (and their alerts) are on his phone too.
  The edge function is only used for voice on browsers without built-in speech recognition.

SHARED FUEL PRICES (v103)
  Fuel prices are shared with Roadesy and Bloop through roadesy.com/api/prices.php. A price reported
  in any of the three apps shows in all of them; the newest report wins. No sign-in is needed to share.
  Signed-in reports still go to your own fuel_prices table too, which keeps the price-sign photo.
  Stations are matched by their OpenStreetMap id. Stations you added yourself stay on this phone.
  To use another address put window.KAYAOS_PRICE_HUB = 'https://...'; in config.user.js ('' turns sharing off).

v104 (2026.11.19)
  More → Work: the Jobs list and the Payments and shifts list now follow the period picked in
  Earnings (Day, Week, Month, Year). Only jobs with work in that period show, and inside each job
  only that period's shifts and payments. Use ‹ › to step to earlier periods. Wages owed and
  Balance owed to you are still the running totals across all dates.
  Sign in: the email field is now marked as the username and the change-email / new-password
  fields sit in their own form, so a saved login fills the email as well as the password. The app
  also remembers the last email used on the device.

v105 (2026.11.19)
  More → Work: every number now follows the selected period, not only the lists. Wages owed, Fuel
  to reimburse and Balance are for that period; each job's owed amount and fuel line too; the
  header shows hours for the period; the four glance tiles show the day, week, month and year that
  hold the selected period. The screen also redraws after midnight and after an entry is edited.
  The "+ Payment" prefill and Export CSV still use all-time totals.

v107 (2026.11.25) — PORTFOLIO
  More → 📊 Portfolio puts income, expenses, debt and assets in one place.
  Pulled in automatically (nothing entered twice):
    Work  — payments received count as income; wages and fuel still owed to you count as assets.
    Bills — every bill payment is an expense; what's unpaid this month counts as owed.
    Fuel  — fill-ups you paid and weren't reimbursed for are expenses.
  Added here: other income, other expenses (both can repeat weekly, every 2 weeks, monthly or
  yearly), assets (cash, accounts, investments, vehicles, property…) and debts (balance, APR,
  minimum payment, due day). "Pay" on a debt logs an expense and lowers its balance; editing or
  deleting that payment puts the amount back.
  Shows: money in / out / left over for the picked Day, Week, Month or Year; spending and income
  by category; net worth today with a monthly trend; next 30 days due; debt interest, average APR
  and payoff time at the minimum. Your own entries count once their date arrives. Export CSV.
  Sync: saved inside the Work sync record (work_data), so no new table is needed. Update every
  device to v107; an older version syncing would drop the Portfolio entries from the cloud copy.
