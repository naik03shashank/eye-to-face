/* Where the backend lives.
   - Served by the same Node server (default):   leave as ''.
   - Frontend on a different host (Netlify, Vercel, Cloudflare Pages...): set to the backend URL,
     e.g. 'https://eye-to-face-api.onrender.com' and add this site's origin to CORS_ORIGIN on the backend.
   Never put an API key here: this file is public. */
window.E2F_API_BASE = '';
