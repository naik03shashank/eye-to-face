'use strict';
/* Gemini client. The API key is read from the environment here and nowhere else;
   it is sent only to Google in the x-goog-api-key header and never returned to clients. */
const crypto = require('crypto');
const { GENRES } = require('./genres');

class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const cfg = () => ({
  key: process.env.GEMINI_API_KEY || '',
  base: (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
  imageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-preview-05-20',
  textModel: process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
  aspect: process.env.GEMINI_ASPECT === undefined ? '2:3' : process.env.GEMINI_ASPECT, // set empty to disable
  timeoutMs: +process.env.GEMINI_TIMEOUT_MS || 110000,
  retryBaseMs: process.env.RETRY_BASE_MS === undefined ? 1500 : +process.env.RETRY_BASE_MS,
  hfToken: process.env.HF_TOKEN || '',
});

const sleep = (ms, signal) =>
  new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal && signal.addEventListener('abort', () => { clearTimeout(t); rej(new AppError(499, 'cancelled', 'Request cancelled.')); }, { once: true });
  });

/* One call to generateContent with retry on transient upstream failures. */
async function callModel(model, body, { signal, retries = 2 } = {}) {
  const c = cfg();
  if (!c.key) throw new AppError(503, 'not_configured', 'The AI service is not configured yet.');
  const url = `${c.base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal && signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(new Error('timeout')), c.timeoutMs);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': c.key },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      lastStatus = r.status;
      if (r.ok) return await r.json();
      if ((r.status === 429 || r.status >= 500) && attempt < retries) {
        await sleep(c.retryBaseMs * 2 ** attempt, signal);
        continue;
      }
      // Log upstream detail server-side only; never forward it to the browser.
      const detail = await r.text().catch(() => '');
      console.error(`[gemini] ${model} HTTP ${r.status}: ${detail.slice(0, 300).replace(/\s+/g, ' ')}`);
      if (r.status === 429) throw new AppError(429, 'busy', 'The AI studio is very busy right now. Please try again in a minute.', { retryAfter: 60 });
      if (r.status === 401 || r.status === 403) throw new AppError(503, 'not_configured', 'The AI service is temporarily unavailable.');
      // API_KEY_INVALID comes back as HTTP 400 — treat it like an auth failure, not a bad photo
      if (r.status === 400 && /API_KEY_INVALID|API key not valid/i.test(detail))
        throw new AppError(503, 'not_configured', 'The AI service is not configured. Please set a valid GEMINI_API_KEY on the server.');
      if (r.status === 400) throw new AppError(502, 'upstream_rejected', 'The AI model could not process this photo. Try a different, clearer photo.');
      throw new AppError(503, 'upstream_unavailable', 'The AI service is temporarily unavailable. Please try again shortly.', { retryAfter: 30 });
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (signal && signal.aborted) throw new AppError(499, 'cancelled', 'Request cancelled.');
      if (attempt < retries) { await sleep(c.retryBaseMs * 2 ** attempt, signal).catch(() => {}); continue; }
      const timedOut = ac.signal.aborted;
      throw new AppError(timedOut ? 504 : 503, timedOut ? 'timeout' : 'upstream_unavailable',
        timedOut ? 'The AI model took too long. Please try again.' : 'Could not reach the AI service. Please try again.', { retryAfter: 15 });
    } finally {
      clearTimeout(timer);
      signal && signal.removeEventListener('abort', onAbort);
    }
  }
  throw new AppError(503, 'upstream_unavailable', `The AI service is unavailable (${lastStatus}).`);
}

/* 1) A fresh scene plan + original quote for every request. Falls back to the genre bank. */
async function planScenes(name, G, seed, signal) {
  const pick = (a) => a[crypto.randomInt(a.length)];
  const shots = ['intimate close-up', 'wide establishing shot', 'medium shot over the shoulder', 'low angle', 'profile in motion'];
  const fallback = () => ({
    quote: pick(G.q),
    panels: shots.map((shot) => ({ shot, scene: pick(G.places), outfit: pick(G.wear), light: pick(G.light) })),
  });
  try {
    const out = await callModel(cfg().textModel, {
      contents: [{
        parts: [{
          text: `You are the art director of a cinematic novel moodboard. Genre: ${name}. World and look: ${G.look}. ` +
            `Return ONLY JSON: {"quote":"an ORIGINAL novel-style line, 6-14 words, not from any existing book, film or song","panels":[5 objects {"shot":"camera framing","scene":"specific location and action","outfit":"what the heroine wears (empty for panel 3)","light":"lighting"}]}. ` +
            `Panels 1, 2 and 4 show the same young woman (the heroine) in different moments (close-up, wide, medium). Panel 3 is a face-less story detail (hand, object, armour, flower, key). Panel 5 is the quote panel. ` +
            `Be specific, surprising, avoid cliches. Creative seed: ${seed}.`,
        }],
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 1.1 },
    }, { signal, retries: 1 });
    const txt = (((out.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || '').join('') || '';
    const j = JSON.parse(txt);
    const quote = String(j.quote || '').replace(/[\r\n"]+/g, ' ').trim().slice(0, 140);
    const panels = (Array.isArray(j.panels) ? j.panels : []).slice(0, 5).map((p) => ({
      shot: String(p.shot || '').slice(0, 80), scene: String(p.scene || '').slice(0, 160),
      outfit: String(p.outfit || '').slice(0, 100), light: String(p.light || '').slice(0, 80),
    }));
    if (quote && panels.length >= 4) return { quote, panels };
  } catch (e) {
    if (e.code === 'cancelled') throw e;
    console.warn('[plan] falling back to genre bank:', e.code || e.message);
  }
  return fallback();
}

function buildPrompt(name, G, plan, seed) {
  const ps = plan.panels.map((p, i) =>
    `Panel ${i + 1}${i === 2 ? ' (story detail, no face)' : i === 4 ? ' (quote panel)' : ''}: ` +
    [p.shot, p.scene, p.outfit && `she wears ${p.outfit}`, p.light].filter(Boolean).join(', ') + '.').join(' ');
  return (
    `The attached photo is the identity reference for the heroine. Create ONE vertical 2:3 cinematic multi-scene NOVEL MOODBOARD for the genre "${name}", ` +
    `in the style of a dark, elegant Pinterest aesthetic collage: 5 photographic or painterly panels of different sizes and shapes, tightly arranged with thin gaps, like film stills from one story. ` +
    `The heroine in panels 1, 2 and 4 must be the SAME woman as in the attached photo: keep her exact face, facial structure, skin tone, eyes and hair recognisable, ` +
    `but dressed and lit for the story world, as a character living inside the scene (not a pasted cut-out, not a filter on the photo). ` +
    `World and look: ${G.look}. ${ps} ` +
    `In the quote panel, set this exact short text in refined serif type on aged paper or dark stone: "${plan.quote}". Spell it exactly. ` +
    `No other text, no logos, no watermarks, no face-in-circle stickers, no UI. Compose this moodboard in a completely new and unique way; creative seed ${seed}.`
  );
}

async function generateHFImage(prompt, signal) {
  const c = cfg();
  if (!c.hfToken) throw new AppError(503, 'not_configured', 'No HF_TOKEN configured.');
  const models = [
    'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
    'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-xl-base-1.0'
  ];
  for (const url of models) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.hfToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Eye-To-Face-App/1.0'
        },
        body: JSON.stringify({ inputs: prompt }),
        signal
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        console.warn(`[hf] ${url} HTTP ${r.status}: ${errText.slice(0, 150)}`);
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 5000) {
        const mime = r.headers.get('content-type') || 'image/jpeg';
        return { image: buf.toString('base64'), mime };
      }
    } catch (e) {
      if (signal && signal.aborted) throw e;
      console.warn(`[hf] error on ${url}:`, e.message);
    }
  }
  throw new AppError(503, 'upstream_unavailable', 'The AI image service is currently busy. Please try again shortly.');
}

/* 2) The actual image generation, with the user's photo as identity reference. */
async function generateMoodboard({ genre, image, mime, signal }) {
  if (!Object.prototype.hasOwnProperty.call(GENRES, genre)) throw new AppError(400, 'bad_genre', 'Unknown genre.');
  const G = GENRES[genre];
  const seed = crypto.randomBytes(6).toString('hex');
  const plan = await planScenes(genre, G, seed, signal);
  const prompt = buildPrompt(genre, G, plan, seed);
  const c = cfg();

  // Try Gemini image model first if configured
  if (c.key && !c.hfToken) {
    try {
      const generationConfig = { responseModalities: ['IMAGE'], temperature: 1 };
      if (c.aspect) generationConfig.imageConfig = { aspectRatio: c.aspect };
      const out = await callModel(c.imageModel, {
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: image } }] }],
        generationConfig,
      }, { signal });

      if (out.promptFeedback && out.promptFeedback.blockReason)
        throw new AppError(422, 'blocked', 'The AI safety filters declined this photo or prompt. Try a different, clearer photo of a single face.');
      const cand = (out.candidates || [])[0] || {};
      const parts = (cand.content && cand.content.parts) || [];
      const img = parts.map((p) => p.inlineData || p.inline_data).find(Boolean);
      if (img && img.data) {
        return { image: img.data, mime: img.mimeType || img.mime_type || 'image/png', quote: plan.quote };
      }
    } catch (err) {
      console.warn('[gemini image error]:', err.code || err.message);
      if (!c.hfToken) throw err;
    }
  }

  // Free AI generation via Hugging Face Flux / SDXL
  if (c.hfToken) {
    console.log('[image-gen] generating free AI moodboard via Hugging Face FLUX/SDXL...');
    const hfPrompt = `Cinematic novel moodboard collage, genre ${genre}: ${G.look}. ${plan.panels.map(p => p.shot + ' ' + p.scene).join(', ')}. Fine art photography, 8k resolution, elegant masterpiece.`;
    const hfImg = await generateHFImage(hfPrompt, signal);
    return { image: hfImg.image, mime: hfImg.mime, quote: plan.quote };
  }

  throw new AppError(503, 'not_configured', 'Please set HF_TOKEN in your .env for free AI image generation.');
}

module.exports = { generateMoodboard, AppError, cfg };
