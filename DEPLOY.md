# Deploy to Render

## 1. You do first (one-time)

1. **Sign up:** Go to [render.com](https://render.com) → Sign up (GitHub or email).
2. **Push this repo to GitHub:**
   - On [github.com](https://github.com): **New repository** → name it (e.g. `Stock-Pattern-Stream`), **Public**, do **not** add README → **Create repository** → copy the repo URL.
   - In this project folder, open `push-to-github.ps1` and replace `YOUR_GITHUB_REPO_URL` with that URL.
   - In PowerShell: `cd e:\Stock-Pattern-Stream` then `.\push-to-github.ps1`. Sign in with GitHub when prompted.
   - Your code (including `render.yaml`, `.env.example`) is now on GitHub.
3. **Create Web Service from Blueprint:**
   - In Render Dashboard: **New +** → **Blueprint**.
   - Connect the repository that contains this project.
   - Render will read `render.yaml` and create a **Web Service** with build/start already set.
4. **Add environment variables:** In the new service → **Environment** tab. Add each key from `.env.example` and set the values (your real `DATABASE_URL`, Alpaca keys, OpenAI key, `SESSION_SECRET`, etc.). At minimum set:
   - `DATABASE_URL`
   - `SESSION_SECRET` (long random string)
   - `ALPACA_API_KEY` and `ALPACA_API_SECRET`
   - `AI_INTEGRATIONS_OPENAI_API_KEY` (if you use AI features)
5. **Deploy:** If the service didn’t auto-deploy, click **Manual Deploy** → **Deploy latest commit**. Wait for the build and start; the app URL will be like `https://stock-pattern-stream.onrender.com`.

## 2. What’s already done in the repo

- **Server listens on `0.0.0.0`** in production so Render can reach it.
- **`render.yaml`** defines the Web Service: Node, Starter plan, `npm install && npm run build`, `npm run start`.
- **`.env.example`** lists all env vars to copy into Render’s Environment tab.

## 3. If the build or runtime fails

- Check **Logs** in the Render service (Build and Runtime). Common fixes:
  - **Build fails:** Ensure branch is correct and `npm run build` works locally.
  - **App won’t start:** Add any missing env vars from `.env.example`.
  - **Database connection errors:** Confirm `DATABASE_URL` is correct and the DB allows connections from Render’s IPs (or use a cloud Postgres that allows public connections with SSL).
