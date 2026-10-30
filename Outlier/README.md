# Outlier

A trivia game where rarer answers score more. Each prompt ("Name a fruit") has a list of accepted answers, and each
answer is in one of five rarity tiers: Common 10, Familiar 25, Uncommon 50, Rare 75 and Outlier 100.
You get 20 seconds; wrong guesses cost nothing, and your first accepted answer counts.

- **Daily:** five prompts, the same for everyone, new at midnight Eastern time. Streaks and a copyable result.
- **Unlimited:** prompt after prompt, never repeating until you've seen them all.
- **Play with friends:** live rooms for up to 10 players with a four-letter code or an invite link.

## How it fits together

| Part | Where | What it does |
|---|---|---|
| The game (`public/`) | GitHub Pages, as `outlier.html` on the site | Plays Daily and Unlimited in the browser |
| Puzzles | Firestore | Daily and Unlimited prompts, with answers scrambled (hashed) so they can't be read |
| Answer lists | Firestore, `answerKeys` | Readable only with the admin key, never by browsers |
| Multiplayer server (`server.js`) | Render | Runs rooms and scores every answer itself |

`firestore.rules` lets browsers read today's puzzle or an earlier one, the Unlimited prompts and nothing else.
Tomorrow's puzzle can't be opened early, and browsers can't write anything.

The answer lists live in `content/prompts/*.json`. That folder is **not in git** (see `.gitignore`), so the answers
never appear on GitHub. **Keep a backup copy of `content/` somewhere private**, such as Google Drive. A copy is also in Firestore.

## Playing it on this computer

```sh
npm install
npm run seed:local   # writes dev-data/ from content/
npm run dev          # http://localhost:3000
```

`npm test` runs the tests.

## Adding or changing prompts

Each file in `content/prompts/` is a list of prompts:

```json
{
  "id": "fruits", "pool": "daily", "prompt": "Name a fruit",
  "answers": {
    "common": ["Apple", "Banana"],
    "familiar": ["Kiwi|Kiwifruit"],
    "uncommon": ["Lychee|Litchi"],
    "rare": ["Durian"],
    "outlier": ["Jabuticaba"]
  }
}
```

- `|` separates other accepted spellings.
- Capitals, accents, punctuation, "the" and plural endings don't matter when matching.
- The first answer in the Outlier, Rare and Uncommon lists is shown as a "rarer pick" after each prompt.
- `pool` is `daily` or `unlimited`.
- Daily prompts are scheduled five a day in file order. Days that have already started never change, so editing is
  always safe: fixes to today's answers go live straight away, and later days refill themselves.

After editing, run `npm run seed -- --check` to check the files, then `npm run seed` to publish. The seed script prints
how many days of Daily puzzles are left. Add more daily prompts before they run out; with none scheduled, the Daily
button says the puzzle isn't out yet.

## Setting it up (one time)

### 1. Firebase

1. Go to https://console.firebase.google.com, **Create a project** (Google Analytics not needed).
2. **Build > Firestore Database > Create database**. If asked for an edition, pick Standard. Pick a US location and
   **Start in production mode**.
3. In Firestore, open the **Rules** tab, replace everything with the contents of `firestore.rules`, and **Publish**.
4. **Project settings (gear) > Service accounts > Generate new private key**. Save the downloaded file in this folder
   as `service-account.json`. It's a password to your database: git ignores it, and it must never be shared or committed.
5. Run `npm run seed` here. It should end with "Daily puzzles are scheduled through …".
6. Put the **Project ID** (Project settings > General) in `public/js/config.js` as `firebaseProjectId`.

### 2. Render

1. https://dashboard.render.com > **New > Web Service** > connect the `ArmoredPawn/About` repository.
2. Settings: **Root Directory** `Outlier`, **Runtime** Node, **Build Command** `npm install`,
   **Start Command** `npm start`, **Instance Type** Free.
3. **Environment** variables:
   - `FIREBASE_SERVICE_ACCOUNT`: open `service-account.json` in a text editor and paste all of it.
   - `ALLOWED_ORIGINS`: `https://armoredpawn.github.io`
4. **Health Check Path** (under Advanced): `/healthz`.
5. Once it's live, open `https://<your-service>.onrender.com/healthz`; it should show `"ready":true`.
6. Put that address in `public/js/config.js` as `serverUrl`, commit and push.

On the free plan the server sleeps after 15 minutes without use and takes about a minute to wake. The game wakes it
when someone opens Play with friends and shows a "waking up" message meanwhile. Daily and Unlimited don't use the server.
