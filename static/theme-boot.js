/* theme-boot.js — Added 2026-08-22 with the terminal palette.
 *
 * Loaded SYNCHRONOUSLY in <head>, before first paint. Two reasons it is a separate
 * file rather than an inline <script>:
 *
 *   1. The site's CSP is `script-src 'self'` with no 'unsafe-inline', so an inline
 *      boot script is silently blocked — the page would render, the theme would not
 *      apply, and nothing would appear in any log.
 *   2. brief.js loads at the end of <body>, which is too late: the paper palette
 *      would paint first and flash to terminal.
 *
 * Before this existed, brief.js WROTE localStorage on toggle and nothing ever read it
 * back — a saved preference silently evaporated on the next page load.
 *
 * Precedence: an explicit choice always beats the OS. Only a visitor who has never
 * toggled follows prefers-color-scheme.
 */
(function () {
    var el = document.documentElement;
    var saved = null;
    try {
        saved = localStorage.getItem('if-theme');
    } catch (e) {
        /* private mode, blocked storage, or a browser that throws on access —
           fall through to the OS preference rather than breaking the page. */
    }
    var theme = (saved === 'paper' || saved === 'terminal')
        ? saved
        : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'terminal' : 'paper');
    el.setAttribute('data-theme', theme);

    /* Keep the browser's own chrome (scrollbars, form controls, address bar tint) in
       step with the palette. The <meta> tags in layout.html carry the paper defaults
       so a no-JS visitor still gets a coherent page. */
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'terminal' ? '#12100B' : '#F4EFE4');
})();
