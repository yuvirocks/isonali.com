# iSonali Dashboard — Setup Guide

The dashboard lives at **login.isonali.com** and reads/writes the same Google Sheet
that already captures website registrations. Total setup time: ~20 minutes.

## 1. Update the Google Apps Script (5 min)

1. Open [script.google.com](https://script.google.com) → the project attached to your registrations Sheet.
2. Replace all code with the contents of `admin/Code.gs` from this repo.
3. **Project Settings → Script Properties**, add:
   | Property | Value |
   |---|---|
   | `DASH_KEY` | the dashboard password you choose (share only with Sonali) |
   | `RZP_KEY_ID` | *(optional)* Razorpay Key Id — Dashboard → Settings → API Keys |
   | `RZP_KEY_SECRET` | *(optional)* Razorpay Key Secret |
   With the Razorpay keys set, the "Sync Razorpay payments" button pulls real
   payment records automatically. Without them, everything else still works.
4. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.**
   Access must be: *Execute as Me, Anyone can access.*
5. If the /exec URL changed, paste the new one into `SCRIPT_URL` near the bottom
   of `dashboard.html`. (If you redeployed the same deployment, the URL stays the same.)

The script auto-creates these Sheet tabs on first use:
`Registrations`, `CRM`, `InstaPlanner`, `InstaMetrics`, `Payments`.

> ⚠️ If your existing "Registrations" tab has different column order than
> Timestamp · Name · Email · Phone · City · Role · Program · Price · PaymentStatus,
> rename the old tab (e.g. "Registrations-old") and let the script create a fresh one.

## 2. Point login.isonali.com at Vercel (5 min)

1. **Vercel** → isonali.com project → Settings → Domains → Add → `login.isonali.com`.
2. **GoDaddy** → DNS for isonali.com → Add record:
   - Type: `CNAME` · Name: `login` · Value: `cname.vercel-dns.com`
3. Wait a few minutes; Vercel shows a green check. `vercel.json` in the repo
   already routes that subdomain to the dashboard.

Until DNS is live you can also open the dashboard at `isonali.com/dashboard.html`.

## 3. Google Analytics + Search Console (10 min)

1. [analytics.google.com](https://analytics.google.com) → Create property *isonali.com* → Web stream → copy the **G-XXXXXXXXXX** id.
2. In `index.html`, find `const GA_ID = "G-XXXXXXXXXX"` and replace with your real id. Push.
3. [search.google.com/search-console](https://search.google.com/search-console) → Add property `isonali.com` → verify via DNS TXT record on GoDaddy.
4. Vercel project → **Analytics** tab → Enable (free tier is enough).

## 3b. YouTube auto-tracking (optional, ~5 min, free)

Makes all of Sonali's videos + views appear automatically in Content Studio:

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project → APIs & Services → Enable **YouTube Data API v3**.
2. Credentials → **Create API key** → copy it.
3. In `Code.gs`, fill in the two lines near the top:
   `var YT_API_KEY = "your-key";` and `var YT_CHANNEL = "@channelhandle";`
4. Deploy a new version (Manage deployments → ✏️ → New version).

## 4. Instagram (one-time, free)

1. Instagram app → Settings → *Switch to professional account* → **Creator → Coach**.
2. This unlocks **Insights** (reach, profile views, follower growth) and
   Meta Business Suite for scheduling posts.
3. Each week, copy the numbers from Insights into the dashboard's
   "Log this week's numbers" box — the growth chart builds itself.

## Daily use (for Sonali)

- **Overview** — today's snapshot; "Needs attention" lists people who registered but never paid, with a one-tap WhatsApp nudge.
- **Registrations** — every form fill; mark verified payments, sync Razorpay, export CSV.
- **Students / CRM** — one row per person; set status (Lead/Student/Alumni), keep notes, WhatsApp or email anyone. The broadcast helper pre-fills one message for many people.
- **SEO & Traffic** — opens GA4/Search Console/Vercel; the UTM builder makes tagged links so you know which Instagram post brought each registration.
- **Instagram** — content planner (idea → drafted → scheduled → posted), weekly metrics log with growth chart, and a coach-specific playbook.

## Security notes

- The dashboard page is public but shows nothing without the password; all data
  stays in your Google Sheet and is only served after the password check in Apps Script.
- The password travels over HTTPS. Change it anytime by editing `DASH_KEY`.
- The Razorpay secret never leaves Google's servers.
