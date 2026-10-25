# Eye → Face (production build)

An eye photo becomes ASCII, blinks, and the camera dives into the pupil. If the visitor picked a
story genre, the zoom reveals a **Gemini-generated cinematic novel moodboard** that features their
own recognisable face, with a short original quote. They can download the image.

```
Browser (public/)                      Your server (server.js)                 Google
────────────────                       ───────────────────────                 ──────
ASCII eye + zoom (unchanged)   POST    validates photo + genre
photo + genre  ───────────────────▶   rate / daily / concurrency limits
                               /api/    builds the prompt (server-owned)
                               generate asks Gemini for a fresh scene plan ──▶ Gemini text model
                                        sends photo + prompt as identity ref ─▶ Gemini image model
download ◀──── image + quote ◀──────── returns the generated image
```

* **The API key lives only in the server's environment** (`GEMINI_API_KEY`). It is never in `public/`,
  never sent to the browser, and never echoed in errors (there are tests for this).
* **Prompts live on the server.** The browser can only send `{genre, photo}`, so visitors cannot use
  your key as a free general-purpose image generator.
* **No fake art.** Every image comes from the Gemini image model. There are no CSS/canvas filters.
* **Zero npm dependencies.** Node 20+ built-ins only; nothing to install, nothing to audit.

## Project layout

```
server.js            HTTP server: static files, /api/generate, /api/health, limits, headers
lib/gemini.js        Gemini client: scene plan, prompt, image call, retries, error mapping
lib/genres.js        The 13 genres' art direction + fallback quotes
public/index.html    page          public/style.css    styles
public/app.js        ASCII animation (unchanged) + backend client UI
public/config.js     where the API lives (only needed if frontend and backend are on different hosts)
test/run.js          37 integration tests against a mock Gemini (no key or network needed)
Dockerfile  render.yaml  .env.example
```

## 1. Run locally

Requires **Node 20 or newer**.

```bash
# 1. Get a Gemini API key at https://aistudio.google.com/apikey
#    (image generation models generally require a billing-enabled project)
cp .env.example .env
#    edit .env and set GEMINI_API_KEY=...

# 2. Start
npm start            # or: npm run dev   (auto-restarts on file changes)

# 3. Open
http://localhost:3000
```

Upload an eye photo and a face photo, pick a genre, tick the consent box, press **Generate**.
Generation takes roughly 20-60 seconds. Check the service is healthy:
`curl localhost:3000/api/health` → `{"ok":true,"ai":true}` (`ai:false` means the key is missing).

Run the tests (no key, no network, uses a mock Gemini): `npm test`

## 2. Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | – | **Required.** Keep it secret; set it in your host's secret/env settings, never in git. |
| `GEMINI_IMAGE_MODEL` | `gemini-2.5-flash-image` | Must be a Gemini model that can output images. Check Google's current model list and change this if a newer one is available to you. |
| `GEMINI_TEXT_MODEL` | `gemini-2.5-flash` | Writes the unique scene plan + quote. If it fails, the server falls back to the built-in genre bank. |
| `GEMINI_ASPECT` | `2:3` | Output aspect ratio. Set to an empty value if your chosen model rejects it. |
| `PORT` | `3000` | Most hosts set this for you. |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the app. **Set `1` on Render/Railway/Fly**, otherwise every visitor shares one rate-limit bucket. |
| `CORS_ORIGIN` | empty | Comma-separated origins allowed to call the API. Only needed if the frontend is hosted elsewhere (section 3B). |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MIN` | `5` / `10` | Artworks per visitor IP per window. |
| `DAILY_LIMIT` | `300` | Total generations per UTC day for the whole service. **Your hard cap on cost.** |
| `MAX_CONCURRENT` | `3` | Simultaneous Gemini calls. Extra visitors get a friendly "busy, try again". |
| `MAX_IMAGE_MB` | `4` | Maximum uploaded photo size (the page already downsizes photos to ~1280 px). |

## 3. Deploy publicly

### Option A (recommended): one service serves both frontend and backend

The Node server already serves `public/`, so you deploy one thing and need no CORS setup.

**Render (free tier available)**
1. Push this folder to a GitHub repo.
2. Render dashboard → **New → Blueprint** → pick the repo (it reads `render.yaml`).
   Or **New → Web Service**: Runtime *Node*, Build command *(empty)*, Start command `node server.js`.
3. Add the environment variable `GEMINI_API_KEY` (and `TRUST_PROXY=1` if you did not use the blueprint).
4. Deploy. Your site is at `https://<name>.onrender.com`. Verify: `curl https://<name>.onrender.com/api/health`.

Free Render services sleep when idle, so the first visit after a quiet spell takes ~30-60 s to wake. A paid instance avoids that.

**Railway / Fly.io / any Docker host**
```bash
docker build -t eye-to-face .
docker run -p 3000:3000 -e GEMINI_API_KEY=your-key -e TRUST_PROXY=1 eye-to-face
```
Railway and Fly detect the `Dockerfile` automatically; add `GEMINI_API_KEY` and `TRUST_PROXY=1` as secrets/variables.
Put the container behind HTTPS (these platforms do it for you; on a VPS use Caddy or nginx).

### Option B: frontend and backend on different hosts

Use this if you want the static site on Netlify / Vercel / Cloudflare Pages / GitHub Pages.

1. Deploy the backend (Option A, steps above). Note its URL, e.g. `https://eye-to-face-api.onrender.com`.
2. On the backend set `CORS_ORIGIN=https://your-site.netlify.app` (exact origin, no trailing slash; comma-separate several).
3. Edit `public/config.js`: `window.E2F_API_BASE = 'https://eye-to-face-api.onrender.com';`
4. Deploy the **`public/` folder** as a static site (Netlify: drag the folder onto app.netlify.com/drop;
   Vercel: `npx vercel public`; Cloudflare Pages: output directory `public`).

> If your static host sets its own Content-Security-Policy, allow `connect-src` to your API origin.

## 4. Go-live checklist

- [ ] `GEMINI_API_KEY` is set as a secret on the host, **not** committed (`.env` is git-ignored).
- [ ] `TRUST_PROXY=1` behind Render/Railway/Fly.
- [ ] Set a **budget and quota alert** on the Google Cloud / AI Studio project. `DAILY_LIMIT` is your in-app cap; Google's budget is the safety net.
- [ ] Tune `RATE_LIMIT_MAX` and `DAILY_LIMIT` to what you are willing to pay for.
- [ ] `curl https://your-site/api/health` returns `"ai":true`.
- [ ] Generate one image of yourself in two different genres and compare it to your photo.
- [ ] Add a short privacy policy and terms page. The consent checkbox says the photo goes to Google through your server and is not stored here; keep that true (the server never writes photos to disk and never logs them).

## 5. What visitors see when things go wrong

| Situation | Message / behaviour |
|---|---|
| No photo / consent not ticked | Generate stays disabled |
| Rate limit hit | Friendly message + a countdown on the button |
| Gemini overloaded (429 / 5xx) | Server retries twice with backoff, then "very busy, try again", with a cooldown |
| Safety filter declined the photo | Clear message suggesting a different photo |
| Model replied without an image | "The AI did not return an image this time. Please try again." |
| Daily cap reached | "Come back tomorrow" |
| Server unreachable / offline / >150 s | Dedicated messages; **Try again** and **Play without artwork** buttons |
| User presses **Cancel** or closes the tab | The browser request and the upstream Gemini call are aborted, so you stop paying for it |

Upstream error details (which can contain account information) are written to the server log only, never sent to the browser.

## 6. Known limits

* **Face likeness depends on the model.** The server sends the photo as an identity reference and
  instructs the model to keep the face recognisable, but no image model can guarantee it. Clear,
  front-facing, well-lit photos of one person work best. If likeness is weak, try a newer/larger
  Gemini image model via `GEMINI_IMAGE_MODEL`.
* **Text inside the image** (the quote panel) can occasionally be misspelled by the model. The exact
  quote is also shown as normal text under the image.
* **Limits are in memory.** Rate-limit counters and the daily cap reset when the process restarts and
  are per instance. For several instances, put a shared store (e.g. Redis) behind them or enforce limits at your gateway/CDN.
* Consider adding bot protection (e.g. Cloudflare Turnstile) in front of `/api/generate` if the site gets popular.
