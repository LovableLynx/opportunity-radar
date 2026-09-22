// pdf.js 6.x ships as an ES module only (no UMD/global build on cdnjs), so
// it's imported here and attached to window for app.js (a plain classic
// script, not a module) to use. Extracted to its own file, rather than an
// inline <script type="module"> in index.html, so the site's Content
// Security Policy (script-src 'self' https://cdnjs.cloudflare.com, no
// 'unsafe-inline') can allow it without weakening the policy for
// everything else.
import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.worker.min.mjs';
window.pdfjsLib = pdfjsLib;
