/* InsightForge reader interactions — Added 2026-08-19.
   No dependencies; degrades to a fully readable document without JS. */
(function () {
    'use strict';

    var doc = document;
    var stories = Array.prototype.slice.call(doc.querySelectorAll('.story'));
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------------------------------------------------------- theme */
    var toggle = doc.getElementById('theme-toggle');
    function setTheme(t) {
        doc.documentElement.setAttribute('data-theme', t);
        try { localStorage.setItem('if-theme', t); } catch (e) {}
    }
    if (toggle) {
        toggle.addEventListener('click', function () {
            var cur = doc.documentElement.getAttribute('data-theme');
            setTheme(cur === 'paper' ? 'terminal' : 'paper');
        });
    }

    /* ------------------------------------------------- reading progress */
    var progress = doc.getElementById('progress');
    if (progress) {
        var onScroll = function () {
            var h = doc.documentElement;
            var max = h.scrollHeight - h.clientHeight;
            progress.style.width = max > 0 ? (h.scrollTop / max) * 100 + '%' : '0';
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    /* ------------------------------------------------ source expanders */
    doc.addEventListener('click', function (e) {
        var btn = e.target.closest('.src-more');
        if (!btn) return;
        var list = btn.closest('.story__sources');
        var extras = list.querySelectorAll('.is-extra');
        var opening = extras.length && extras[0].hidden;
        Array.prototype.forEach.call(extras, function (li) { li.hidden = !opening; });
        btn.textContent = opening ? 'fewer' : '+' + btn.getAttribute('data-count') + ' more';
    });

    /* ---------------------------------------------------- section spy */
    var tocLinks = Array.prototype.slice.call(doc.querySelectorAll('[data-toc]'));
    var sections = Array.prototype.slice.call(doc.querySelectorAll('.section'));
    if (tocLinks.length && sections.length && 'IntersectionObserver' in window) {
        var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var id = entry.target.id;
                tocLinks.forEach(function (a) {
                    a.classList.toggle('is-active', a.getAttribute('data-toc') === id);
                });
            });
        }, { rootMargin: '-15% 0px -70% 0px' });
        sections.forEach(function (s) { spy.observe(s); });
    }

    /* ------------------------------------------------------ reveal-in */
    if (!reduceMotion && 'IntersectionObserver' in window) {
        var revealTargets = doc.querySelectorAll('.story, .ov-panel, .part-divider');
        var revealer = new IntersectionObserver(function (entries, obs) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-in');
                    obs.unobserve(entry.target);
                }
            });
        }, { rootMargin: '0px 0px -8% 0px' });
        Array.prototype.forEach.call(revealTargets, function (el, i) {
            el.classList.add('reveal');
            el.style.transitionDelay = Math.min(i % 6, 5) * 45 + 'ms';
            revealer.observe(el);
        });
    }

    /* --------------------------------------------------------- filter */
    var input = doc.getElementById('filter-input');
    var status = doc.getElementById('filter-status');
    var empty = doc.getElementById('empty-state');
    var dirChips = Array.prototype.slice.call(doc.querySelectorAll('[data-filter-dir]'));
    var activeDirs = [];

    function applyFilter() {
        var q = (input && input.value || '').trim().toLowerCase();
        var shown = 0;
        stories.forEach(function (story) {
            var matchesText = !q || story.textContent.toLowerCase().indexOf(q) > -1;
            var matchesDir = !activeDirs.length ||
                activeDirs.indexOf(story.getAttribute('data-direction')) > -1;
            var show = matchesText && matchesDir;
            story.hidden = !show;
            if (show) shown++;
        });
        // Hide sections (and their headers) that have no visible stories
        sections.forEach(function (sec) {
            var any = sec.querySelector('.story:not([hidden])');
            sec.hidden = !any;
        });
        Array.prototype.forEach.call(doc.querySelectorAll('.part-divider'), function (pd) {
            var next = pd.nextElementSibling, any = false;
            while (next && !next.classList.contains('part-divider')) {
                if (next.classList.contains('section') && !next.hidden) { any = true; break; }
                next = next.nextElementSibling;
            }
            pd.hidden = !any;
        });
        if (empty) empty.hidden = shown !== 0;
        if (status) {
            status.textContent = (q || activeDirs.length)
                ? shown + ' of ' + stories.length + ' stories'
                : '';
        }
    }

    if (input) input.addEventListener('input', applyFilter);
    dirChips.forEach(function (chip) {
        chip.addEventListener('click', function () {
            var dir = chip.getAttribute('data-filter-dir');
            var i = activeDirs.indexOf(dir);
            if (i > -1) { activeDirs.splice(i, 1); } else { activeDirs.push(dir); }
            chip.setAttribute('aria-pressed', i > -1 ? 'false' : 'true');
            applyFilter();
        });
    });

    /* ------------------------------------------------------- keyboard */
    var cursor = -1;
    function setCursor(i) {
        stories.forEach(function (s) { s.classList.remove('is-cursor'); });
        cursor = i;
        if (stories[i]) stories[i].classList.add('is-cursor');
    }
    function move(delta) {
        var visible = stories.filter(function (s) { return !s.hidden; });
        if (!visible.length) return;
        var currentVisibleIdx = visible.indexOf(stories[cursor]);
        var next = visible[Math.max(0, Math.min(visible.length - 1, currentVisibleIdx + delta))];
        if (currentVisibleIdx === -1) next = visible[0];
        setCursor(stories.indexOf(next));
        next.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    }

    doc.addEventListener('keydown', function (e) {
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
            if (e.key === 'Escape') { e.target.value = ''; applyFilter(); e.target.blur(); }
            return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'j') { e.preventDefault(); move(1); }
        else if (e.key === 'k') { e.preventDefault(); move(-1); }
        else if (e.key === '/') { e.preventDefault(); if (input) input.focus(); }
        else if (e.key === 't') {
            setTheme(doc.documentElement.getAttribute('data-theme') === 'paper' ? 'terminal' : 'paper');
        }
    });
})();
