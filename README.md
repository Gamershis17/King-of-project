# King of Project

## What this is

King of Project is a multiplayer idle RPG game you play in your web browser —
no install needed, and it works on phones and computers. You pick a hero race
(Human, Orc, Celestial, Dragonkin, Fae, or Revenant), tap to fight monsters,
collect loot, recruit a party for dungeon runs, and even prestige (restart
stronger) once you reach stage 50. Your progress is saved on the server, and
there's a global leaderboard so you can compare your level with other players.
The game has three play modes: **Clicker** (tap to attack — the main mode),
**Auto** (your hero fights on its own), and **Dungeon** (your 3-hero party
fights together).

## Run it on your own computer

You only need to do this once.

1. **Install Node.js 20 (LTS)** from [nodejs.org](https://nodejs.org) — this is
   the engine that runs the game server. Download the "LTS" version for your
   system (Windows/Mac/Linux) and run the installer.
2. **Open a terminal** (on Windows: PowerShell; on Mac: Terminal) and go into
   this folder, e.g.:
   ```
   cd path/to/rpg-server
   ```
   (Replace `path/to/rpg-server` with the real location of this folder.)
3. **Install the game's pieces:**
   ```
   npm install
   ```
   This downloads the small libraries the server needs. It can take a minute.
4. **Set up the database.** The server stores accounts, saves, the
   leaderboard and gift codes in PostgreSQL (so progress survives restarts).
   - **Easiest:** leave `DATABASE_URL` unset and create a local database named
     `king_of_project` that your OS user can connect to
     (e.g. `createdb king_of_project`). The server creates all tables itself
     on first start.
   - Or point `DATABASE_URL` at any Postgres you have, e.g.
     `DATABASE_URL=postgres://user:password@localhost:5432/king_of_project`.
5. **Start the server with your owner account.** The owner account is the game's
   admin account — it unlocks the GM console. You create it with a username and
   password of your choice:
   - **Mac/Linux:** `OWNER_USERNAME=yourname OWNER_PASSWORD=yoursecret npm start`
   - **Windows (PowerShell):** `$env:OWNER_USERNAME="yourname"; $env:OWNER_PASSWORD="yoursecret"; npm start`
   - **Windows (Command Prompt):** `set OWNER_USERNAME=yourname && set OWNER_PASSWORD=yoursecret && npm start`

   Pick a real password you don't use anywhere else.
5. **Open the game:** go to <http://localhost:3000> in your browser. Click
   "Register", make a player account for yourself (a different name is fine),
   pick your race, and play.

> **Tip:** Keep that terminal window open while you play. Close it (Ctrl+C)
> to stop the server. Your progress is stored in PostgreSQL (not a local
> file), so stopping and restarting the server never loses anything.

## How to play (the short version)

- **Battle tab:** tap the big TAP button to attack the enemy. Kill it for gold,
  XP, and loot. Every 10th stage is a boss with better drops.
- **Gear tab:** equip the loot you find; better rarity = better stats. You can
  sell junk for gold.
- **Party tab:** recruit companions and switch to Dungeon mode so all three
  fight together.
- **Ranks tab:** the global leaderboard — top 100 players by level.
- **Progress saves automatically**, and when you come back later you'll get a
  "While you were away…" summary of what you earned offline (up to 8 hours).
- **Prestige:** at stage 50 you can reset for a permanent +25% damage and gold
  bonus. Your special gear sets and stars carry over.

## Put it on the internet with Render (step by step)

This makes the game shareable — anyone with the link can play.

1. **Put the code on GitHub.**
   - Make a free account at [github.com](https://github.com), then create a
     new repository (give it any name, e.g. `king-of-project`).
   - Upload this whole folder to it. The simplest way: on the repository page,
     click "uploading an existing file" and drag the folder's contents in,
     then commit. (If you know git, `git init`, `git add .`,
     `git commit`, `git push` works too — `data/` and `node_modules` are
     ignored automatically by the `.gitignore` file.)
2. **Make a free Render account** at [render.com](https://render.com).
3. **Deploy with the Blueprint file.** In the Render dashboard: **New → Blueprint**,
   connect your GitHub account, and select your repository. Render will read
   `render.yaml` and create a free web service called `king-of-project`.
4. **What to enter:** almost everything is set up. `PORT` is already 3000,
   `SESSION_SECRET` is generated automatically, and `OWNER_USERNAME` /
   `OWNER_PASSWORD` get random values generated for you.
   - **Where to find your owner login:** after the deploy finishes, go to your
     service in Render → the **Environment** tab. Copy the generated
     `OWNER_USERNAME` and `OWNER_PASSWORD` — that is your admin login on the
     website. You can change them to your own name/password there and
     redeploy; keep the password secret.
   - **The one thing you must add yourself: `DATABASE_URL`.** This is the
     connection string for your PostgreSQL database — it's what keeps
     accounts, saves and the leaderboard alive when the server restarts.
     Get a **free** Postgres database at [Neon](https://neon.tech) or
     [Supabase](https://supabase.com) (both have free tiers, no credit card
     needed for the basic plan), create a database, copy its connection
     string (it looks like
     `postgres://user:password@host:5432/dbname`), and paste it as the
     `DATABASE_URL` value in the Environment tab. Then redeploy (or it
     redeploys automatically).
   - Without `DATABASE_URL` the server will not start — it fails fast with a
     clear error instead of silently losing data.
5. **Open the URL.** Render gives you a link like
   `https://king-of-project.onrender.com`. Open it, register a player account,
   and play. Share the link with friends so they can join and appear on the
   leaderboard.

### Honest caveats (please read)

- **The free plan sleeps when nobody is playing.** After ~15 minutes with no
  visitors, Render puts the server to sleep. The first person to open the link
  after that will wait 30–60 seconds while it wakes up. That's normal on the
  free plan; a paid plan stays awake.
- **Progress now survives restarts — as long as `DATABASE_URL` is set.**
  Accounts, saves, sessions, gift codes and the leaderboard live in your
  external PostgreSQL database (Neon/Supabase free tier), not on Render's
  disk, so restarts, redeploys and sleep/wake cycles no longer wipe anything.
  Render's free filesystem itself is still temporary — don't store anything
  you need to keep on the local disk.
- **This is a hobby build, not a professionally audited product.** It uses
  standard protections (passwords are hashed, logins are rate-limited, inputs
  are validated), but it has not been through a security review. Don't reuse
  passwords you use elsewhere, and don't store anything sensitive in the game.
- **No Google sign-in (yet).** Players register with a username and password.
  Adding "Sign in with Google" requires setting up your own Google Cloud
  project, which is beyond this guide — it can be added later.

## The GM console (owner / GM only)

When you log in with the **owner** account (or an account the owner promotes
to GM), a **GM Console** tab appears in the game. It lets you:

- **Grant gifts:** give any player free stars (the premium currency) or a full
  gear set. Only the *owner* can grant the ultra-powerful Sovereign set.
- **Create gift codes:** make redeemable codes (like `XXXX-XXXX-XXXX`) for gear
  sets, choose how many times each code can be used, and hand them out to
  friends — players redeem them in the game to get the gear.
- **See an overview:** how many players exist and how many codes have been
  created.
- **Owner only — manage staff:** promote players to **GM** (gets the console)
  or **Admin** (gets the special Admin Warden gear, no console), or demote them.

So the flow is: you log in as owner → open the GM Console → create gift codes
→ share codes with friends → they redeem them and get powerful gear.

---

*Built with Node.js + Express + PostgreSQL. Game simulation runs in the browser;
the server handles accounts, saves, the leaderboard, codes, and staff roles.*
