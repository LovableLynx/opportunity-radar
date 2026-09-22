// Applied before first paint so there's no flash of the wrong theme.
// Extracted to its own file, rather than an inline <script> in index.html,
// so the site's Content Security Policy (script-src 'self'
// https://cdnjs.cloudflare.com, no 'unsafe-inline') can allow it without
// weakening the policy for everything else. Must stay a plain classic
// script loaded synchronously in <head> (not deferred, not type="module")
// so it runs before the page paints.
try {
  var savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }
} catch (err) {}
