/* Added 2026-10-24: local-only archive browser. Untrusted text never enters HTML. */
'use strict';
const base = '/Egyptforum2026/';
const $ = id => document.getElementById(id);
function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function link(text, url, download = false) {
  const a = node('a', text); a.href = url;
  if (download) a.download = '';
  else { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  return a;
}
function time(seconds) {
  const n = Math.floor(seconds);
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(x => String(x).padStart(2, '0')).join(':');
}
function button(text, action, cls) {
  const b = node('button', text, cls); b.type = 'button'; b.addEventListener('click', action); return b;
}
// Added 2026-10-24: real links retain native copy/open-in-new-tab behavior.
function archiveLink(text, hash, cls) {
  const a = node('a', text, cls); a.href = hash;
  a.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
    event.preventDefault(); navigate(hash);
  });
  return a;
}
// Clean only the reading display; original captions remain the evidence/download.
function cleanReadingText(text) {
  return text.replace(/>>/g, ' ')
    .replace(/\[(?:موسيقى|تصفيق|music|applause)\]/giu, ' ')
    .replace(/(^|[^\p{L}\p{N}_])(?:ا{2,}|آ{2,}|أ{2,}|إ{2,}|[اآأإ]?م{3,}|uh+|um+|erm+|err{1,})(?=$|[^\p{L}\p{N}_])/giu, '$1')
    .replace(/\s+/g, ' ').trim();
}
// Search across visual paragraph breaks, keeping the full matching paragraphs.
function readingParagraphs(passage, query) {
  const paragraphs = passage.paragraphs.map(p => ({...p, readingText: cleanReadingText(p.text)}));
  if (!query) return paragraphs.filter(p => p.readingText);
  let joined = '', ranges = [];
  for (const paragraph of paragraphs) {
    if (joined) joined += ' ';
    const start = joined.length; joined += paragraph.readingText;
    ranges.push({paragraph, start, end: joined.length});
  }
  const text = joined.toLocaleLowerCase(); const selected = new Set();
  for (let offset = text.indexOf(query); offset >= 0; offset = text.indexOf(query, offset + 1)) {
    for (const range of ranges) {
      if (range.start < offset + query.length && range.end > offset && range.paragraph.readingText) selected.add(range.paragraph);
    }
  }
  return paragraphs.filter(p => selected.has(p));
}
// Added 2026-10-24: reading layout groups captions without changing their evidence.
let transcriptMode = 'reading';
function readingPassages(segments) {
  const passages = [];
  for (const segment of segments) {
    let passage = passages[passages.length - 1];
    // Both public attribution and original voice boundaries remain intact.
    const sameVoice = passage && passage.speaker_id === segment.speaker_id &&
      passage.speaker_label === segment.speaker_label &&
      passage.source_speaker_label === segment.source_speaker_label;
    if (!sameVoice || segment.start - passage.end > 3) {
      passage = {start: segment.start, end: segment.end, speaker_id: segment.speaker_id,
        speaker_label: segment.speaker_label, source_speaker_label: segment.source_speaker_label,
        paragraphs: []};
      passages.push(passage);
    }
    passage.end = Math.max(passage.end, segment.end);
    let paragraph = passage.paragraphs[passage.paragraphs.length - 1];
    // These are reading breaks only. Never cut, rewrite or deduplicate a caption.
    if (!paragraph || paragraph.text.length + segment.text.length + 1 > 800 ||
        segment.start - paragraph.start >= 60) {
      paragraph = {start: segment.start, end: segment.end, text: '', segments: [], flags: []};
      passage.paragraphs.push(paragraph);
    }
    paragraph.segments.push(segment);
    paragraph.text += (paragraph.text ? ' ' : '') + segment.text;
    paragraph.end = Math.max(paragraph.end, segment.end);
    paragraph.flags = [...new Set([...paragraph.flags, ...(segment.flags || [])])];
  }
  return passages;
}
function transcriptTargetIndex(segments, start, personId = null) {
  // Exact source anchors take priority over the long display tail of an earlier caption.
  const exact = s => Math.round(s.start * 1000) === Math.round(start * 1000);
  const contains = s => s.start <= start && s.end > start;
  for (const match of [s => exact(s) && personId && s.speaker_id === personId,
                       exact, s => contains(s) && personId && s.speaker_id === personId, contains]) {
    const index = segments.findIndex(match);
    if (index >= 0) return index;
  }
  const following = segments.findIndex(s => s.start >= start);
  return following >= 0 ? following : Math.max(0, segments.length - 1);
}
let archive, day, selected, generation = 0, peoplePage = 0, activePersonId = null;
function setView(view) {
  const people = view === 'people';
  $('people-view').hidden = !people; $('programme-view').hidden = people;
  $('people-tab').setAttribute('aria-pressed', String(people));
  $('programme-tab').setAttribute('aria-pressed', String(!people));
  if (people) { generation++; $('detail').replaceChildren(); }
}
// Skip within the visible view without creating a separate browser-history entry.
const skipLink = document.querySelector('a.skip');
if (skipLink) skipLink.addEventListener('click', event => {
  event.preventDefault();
  const target = $('people-view').hidden ? $('session') : $('person-detail');
  target.focus({preventScroll: true}); target.scrollIntoView({behavior: 'smooth'});
});
$('people-tab').addEventListener('click', () => navigate('#people'));
$('programme-tab').addEventListener('click', () => { if (archive) navigate(`#slot-${selected || archive.slots[0].id}`); });
function coverageText(slot) {
  return slot.recording_ids.length ? 'Recording located' :
    slot.coverage_status === 'pending_publication' ? 'Recording pending' : 'Recording not located';
}
try { if (localStorage.getItem('archive-theme') === 'terminal') document.documentElement.dataset.theme = 'terminal'; } catch (_) { /* Storage is optional. */ }
function themeLabel() {
  const terminal = document.documentElement.dataset.theme === 'terminal';
  $('theme').textContent = terminal ? 'Paper view' : 'Terminal view';
  $('theme').setAttribute('aria-label', `Switch to ${terminal ? 'paper' : 'terminal'} theme`);
}
themeLabel();
$('theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'terminal' ? 'paper' : 'terminal';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('archive-theme', next); } catch (_) { /* Storage is optional. */ }
  themeLabel();
});
function renderSlots() {
  const q = $('search').value.trim().toLocaleLowerCase();
  const coverage = $('coverage').value;
  const matches = archive.slots.filter(s => (!day || s.date === day) &&
    `${s.titleA || ''} ${s.titleE || ''} ${s.hallA || ''}`.toLocaleLowerCase().includes(q) &&
    (coverage === 'all' || (coverage === 'available' ? s.recording_ids.length :
      coverage === 'pending' ? s.coverage_status === 'pending_publication' :
      !s.recording_ids.length && s.coverage_status !== 'pending_publication')));
  $('slots').replaceChildren(); $('empty').hidden = !!matches.length;
  for (const s of matches) {
    const b = archiveLink('', `#slot-${s.id}`, 'slot');
    b.setAttribute('aria-current', String(selected === s.id));
    const meta = node('span', `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)} · ${s.date}`, 'slot-meta');
    const title = node('span', s.titleA, 'slot-title'); title.lang = 'ar'; title.dir = 'rtl';
    const state = node('span', coverageText(s), s.recording_ids.length ? 'status' : 'status missing');
    b.append(meta, title, state); $('slots').append(b);
  }
}
function sessionNavigation(slot) {
  const nav = node('nav', undefined, 'session-navigation'); nav.setAttribute('aria-label', 'Navigate programme sessions');
  const ordered = [...archive.slots].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`) || a.id - b.id);
  const index = ordered.findIndex(s => s.id === slot.id);
  const adjacent = (other, label) => {
    const a = archiveLink('', `#slot-${other.id}`, 'adjacent-session');
    a.append(node('span', label, 'nav-direction'));
    const title = node('span', other.titleA, 'nav-session-title'); title.lang = 'ar'; title.dir = 'auto'; a.append(title); return a;
  };
  if (index > 0) nav.append(adjacent(ordered[index - 1], '← Previous session'));
  nav.append(archiveLink(`Day programme · ${slot.date}`, `#day-${slot.date}`, 'day-programme-link'));
  if (index + 1 < ordered.length) nav.append(adjacent(ordered[index + 1], 'Next session →'));
  return nav;
}
function selectSlot(slot, focus = false, jump = null, autoplay = false) {
  setView('programme');
  selected = slot.id; generation++; renderSlots();
  const detail = $('detail'); detail.replaceChildren();
  const h = node('h2', slot.titleA); h.id = 'session-title'; h.lang = 'ar'; h.dir = 'rtl';
  const meta = node('p', `${slot.date} · ${slot.startTime.slice(0, 5)}–${slot.endTime.slice(0, 5)} · Africa/Cairo`, 'meta');
  const hall = node('p', slot.hallA, 'hall'); hall.dir = 'auto';
  detail.append(sessionNavigation(slot), h, meta, hall);
  const records = slot.recording_ids.map(id => archive.recordings.find(r => r.id === id)).filter(Boolean);
  if (!records.length) {
    detail.append(node('div', slot.coverage_status === 'pending_publication' ?
      'Recording pending publication. The scheduled session remains in the programme.' :
      'Recording not located in this archive. Parallel sessions are kept separate.', 'gap'));
  } else {
    const choice = node('div', undefined, 'recording-choice'); choice.setAttribute('aria-label', 'Source recordings');
    const mount = node('div');
    const choose = r => {
      for (const b of choice.children) b.setAttribute('aria-pressed', String(b.dataset.id === r.id));
      renderRecording(r, mount, slot, jump && jump.recording_id === r.id ? jump : null, autoplay);
    };
    for (const [i, r] of records.entries()) {
      const b = button(`Source ${i + 1} · ${r.channel || 'Publisher unavailable'}`, () => navigate(recordingHash(r.id, 0), {autoplay: true}));
      b.dataset.id = r.id; choice.append(b);
    }
    detail.append(choice, mount); choose(records.find(r => jump && jump.recording_id === r.id) || records[0]);
  }
  if (focus) { $('session').focus({preventScroll: true}); if (innerWidth < 800 || !jump) $('session').scrollIntoView({behavior: 'smooth'}); }
}
// Added 2026-10-24: v2 reader (design 6.8). Used only when data/<id>-v2.json exists; v1 is unchanged.
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function arDigits(n) { return String(n).replace(/\d/g, d => AR_DIGITS[Number(d)]); }
function v2Minutes(seconds) { return Math.max(1, Math.floor(seconds / 60 + 0.5)); }
function v2Summary(section) {
  const n = v2Minutes(section.end - section.start);
  return `[${section.type_ar}، ${arDigits(n)} ${n === 1 ? 'دقيقة' : 'دقائق'}] ${section.type_en}, ${n} min`;
}
function v2Speaker(speaker) {
  return speaker.person_id ? {ar: speaker.display_ar, en: speaker.display_en} :
    {ar: speaker.role_label_ar, en: speaker.role_label_en};
}
// Repaired words are marked by [start, end) UTF-16 ranges; text is always set as text nodes.
function v2Sentence(sentence, showOriginal) {
  const span = node('span', undefined, 'v2-sentence');
  if (showOriginal) { span.append(document.createTextNode(sentence.original_text)); return span; }
  let at = 0;
  for (const [a, b] of sentence.marks || []) {
    if (a < at || b > sentence.text.length || b <= a) continue;
    if (a > at) span.append(document.createTextNode(sentence.text.slice(at, a)));
    span.append(node('mark', sentence.text.slice(a, b), 'repaired')); at = b;
  }
  if (at < sentence.text.length) span.append(document.createTextNode(sentence.text.slice(at)));
  return span;
}
function v2Passage(p, byId, r) {
  const article = node('article', undefined, 'v2-passage'); article.id = `p-${p.id}`; article.dataset.start = String(p.start);
  const head = node('header', undefined, 'passage-heading');
  const who = v2Speaker(p.speaker); const name = node('span', undefined, 'v2-speaker');
  const ar = node('strong', who.ar, 'v2-speaker-ar'); ar.dir = 'rtl'; ar.lang = 'ar'; name.append(ar);
  if (who.en) { const en = node('small', who.en, 'v2-speaker-en'); en.dir = 'ltr'; en.lang = 'en'; name.append(en); }
  const seek = button(`Play ${time(p.start)}`, () => navigate(recordingHash(r.id, p.start), {autoplay: true}), 'passage-time');
  seek.setAttribute('aria-label', `Play passage at ${time(p.start)}`);
  head.append(name, seek); article.append(head);
  if (p.replies_to && byId.get(p.replies_to)) {
    const target = byId.get(p.replies_to), t = v2Speaker(target.speaker);
    const reply = button(`↩ رد على ${t.ar} · reply to ${t.en || t.ar}`, () => {
      const t2 = byId.get(p.replies_to), el = t2.element;
      if (t2.fold && t2.fold.tag === 'details') t2.fold.open = true;
      if (el) el.scrollIntoView({behavior: 'smooth'});
    }, 'v2-reply'); reply.setAttribute('aria-label', `Reply to ${t.en || t.ar}`);
    article.append(reply);
  }
  const body = node('p', undefined, 'reading-paragraph v2-body'); body.dir = 'rtl'; body.lang = 'ar'; body.tabIndex = 0;
  body.setAttribute('role', 'button');
  let original = false;
  const draw = () => {
    body.setAttribute('aria-pressed', String(original));
    body.className = 'reading-paragraph v2-body' + (original ? ' showing-original' : '');
    const parts = [];
    for (const [i, s] of p.sentences.entries()) { if (i) parts.push(document.createTextNode(' ')); parts.push(v2Sentence(s, original)); }
    body.replaceChildren(...parts);
    note.textContent = original ? 'الأصل: التعليقات الأصلية · Original captions. Tap to return to the repaired text.' :
      (p.repairs && p.repairs.length ? 'النص المصحح · Repaired text; marked words changed. Tap for original captions.' : 'Tap for original captions.');
  };
  const note = node('small', '', 'v2-note');
  const toggle = () => { original = !original; draw(); };
  body.addEventListener('click', toggle);
  body.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { if (e.preventDefault) e.preventDefault(); toggle(); } });
  draw(); article.append(body, note);
  return article;
}
function renderV2(doc, mount, r, jump) {
  mount.replaceChildren(node('h3', 'النص المصحح · Repaired transcript'));
  const cov = doc.coverage || {};
  if (typeof cov.named_share === 'number') {
    const pct = Math.round(cov.named_share * 100);
    mount.append(node('p', `نسبة الكلمات المنسوبة لمتحدث مسمى: ${arDigits(pct)}٪ · ${pct}% of live-speech words named (agent-checked / فحص آلي)`, 'v2-coverage'));
  }
  mount.append(node('p', 'النص الأصلي هو ترجمة يوتيوب التلقائية دون علامات تغيير المتحدث (>>) · Original = YouTube auto-captions, speaker-change marks (>>) omitted (agent-checked).', 'v2-coverage'));
  mount.append(node('p', 'يُعرض النص المصحح افتراضيا، والكلمات المصححة مظللة، والتعليقات الأصلية بنقرة واحدة. · Repaired text by default; repaired words are marked; original captions are one tap away.', 'reader-hint'));
  const links = node('p', undefined, 'v2-downloads');
  for (const [key, label] of [['reading_txt', 'قراءة · Reading TXT'], ['timed_txt', 'نص مؤقت · Timed TXT'], ['srt', 'SRT'], ['vtt', 'VTT']])
    if (typeof (doc.downloads || {})[key] === 'string' && doc.downloads[key].startsWith(`${base}`)) { links.append(link(label, doc.downloads[key], true), document.createTextNode(' ')); }
  if (links.children.length) mount.append(links);
  const byId = new Map(doc.passages.map(p => [p.id, p]));
  const list = node('div', undefined, 'v2-transcript'); mount.append(list);
  const sections = [...doc.sections].sort((a, b) => a.start - b.start);
  let focus = null;
  const target = jump ? (doc.passages.filter(p => p.start <= jump.start + 0.001).pop() || doc.passages[0]) : null;
  for (const s of sections) {
    const passages = doc.passages.filter(p => p.section_id === s.id);
    let holder = list;
    if (s.folded) {
      holder = node('details', undefined, 'v2-folded'); holder.dataset.type = s.type;
      const summary = node('summary', v2Summary(s)); summary.dir = 'auto'; holder.append(summary); list.append(holder);
    } else if (passages.length) {
      const label = node('div', `${s.type_ar} · ${s.type_en}`, 'section-label v2-section'); label.dir = 'auto'; list.append(label);
    }
    for (const p of passages) {
      const el = v2Passage(p, byId, r); p.element = el; p.fold = s.folded ? holder : null; holder.append(el);
      if (p === target) { focus = el; if (s.folded) holder.open = true; }
    }
  }
  if (focus) { focus.className += ' selected-intervention'; focus.scrollIntoView({behavior: 'smooth'}); }
  if (doc.gaps && doc.gaps.length) {
    const gaps = node('details', undefined, 'v2-gaps');
    gaps.append(node('summary', `قائمة الفجوات (${arDigits(doc.gaps.length)}) · Gap list: ${doc.gaps.length} live passages without a name`));
    const ul = node('ul');
    for (const g of doc.gaps) ul.append(node('li', `${g.time} · ${g.section} · ${g.role_label} · ${g.reason}`));
    gaps.append(ul); mount.append(gaps);
  }
}
async function fetchV2(id) {
  // Modified 2026-10-24: "-v2" not ".v2": the publisher allows one dot per file name.
  try {
    const res = await fetch(`${base}data/${id}-v2.json`); if (!res.ok) return null;
    const doc = await res.json();
    return doc && doc.format === 'v2' && Array.isArray(doc.passages) && Array.isArray(doc.sections) ? doc : null;
  } catch (_) { return null; }
}
async function renderRecording(r, mount, slot, jump = null, autoplay = false) {
  const token = ++generation;
  mount.replaceChildren();
  const label = node('div', 'RECORDING / ORIGINAL SOURCE', 'section-label');
  const title = node('h3', r.title || r.id); title.dir = 'auto';
  const published = r.upload_date ? `${r.upload_date.slice(0,4)}-${r.upload_date.slice(4,6)}-${r.upload_date.slice(6,8)}` : 'unavailable';
  const metadata = node('p', `Publisher: ${r.channel || 'unavailable'} · Uploaded: ${published}${r.duration_seconds ? ' · ' + time(r.duration_seconds) : ''}`, 'meta');
  mount.append(label, title, metadata, link('Open source on YouTube ↗', r.url));
  const shared = archive.slots.filter(s => s.recording_ids.includes(r.id)).length;
  mount.append(node('p', shared > 1 ? `Recording-based transcript. This upload is linked to ${shared} programme slots. Exact slot boundaries are unverified; selecting a continuation does not imply a known start offset.` : r.coverage, 'coverage-note'));
  const player = node('iframe'); player.title = `Source recording: ${r.title || r.id}`;
  player.src = `https://www.youtube-nocookie.com/embed/${r.id}${jump ? '?start=' + Math.floor(jump.start) + (autoplay ? '&autoplay=1' : '') : ''}`; player.loading = 'lazy';
  player.allow = 'encrypted-media; fullscreen; picture-in-picture'; player.allowFullscreen = true;
  player.referrerPolicy = 'strict-origin-when-cross-origin'; player.className = 'player'; mount.append(player);
  const playerStatus = node('p', jump ? `Source loaded at ${time(jump.start)}. Playback may require pressing play.` : 'Select a transcript timestamp to load the source at that point.', 'subtle'); playerStatus.setAttribute('aria-live', 'polite'); mount.append(playerStatus);
  if (jump && jump.type === 'source_named_turn') {
    mount.append(node('p', jump.caption_status === 'spans_boundary' ?
      'Source-attributed turn; caption spans its boundary. The caption text keeps its original voice label.' :
      'Source-attributed turn; no complete caption segment is assigned to this person.', 'source-turn-note'));
    const evidence = node('details', undefined, 'turn-evidence'); evidence.append(node('summary', 'Turn attribution sources'));
    for (const source of jump.evidence || []) evidence.append(link(source.label || 'Source evidence ↗', source.url));
    if (jump.evidence && jump.evidence.length) mount.append(evidence);
  }
  // Video context is separate from person profiles and never becomes an avatar.
  const context = (archive.context_frames || []).filter(f => f.recording_id === r.id &&
    f.image_kind === 'context_frame' && f.depicted_person_relation === 'unverified');
  if (context.length) {
    const section = node('details', undefined, 'video-context');
    section.append(node('summary', `Video context · ${context.length} frames`));
    section.append(node('p', 'Source video frames. Who is shown, and their relation to the speaking voice, are unverified.', 'subtle'));
    const grid = node('div', undefined, 'context-grid'); const pager = node('div', undefined, 'pager');
    section.append(grid, pager); let contextPage = 0;
    function renderContext() {
      grid.replaceChildren(); pager.replaceChildren();
      for (const frame of context.slice(contextPage * 8, (contextPage + 1) * 8)) {
        const figure = node('figure'); const image = node('img');
        image.src = frame.image_url; image.alt = `Video context at ${time(frame.frame_time)}. Person shown is unverified.`;
        image.loading = 'lazy'; image.width = 480; image.height = 270;
        const caption = node('figcaption');
        caption.append(button(`Play at ${time(frame.frame_time)}`, () => {
          navigate(recordingHash(r.id, frame.frame_time), {autoplay: true});
        }, 'timestamp'), link('Source frame ↗', frame.source_url));
        figure.append(image, caption); grid.append(figure);
      }
      if (context.length > 8) {
        const previous = button('Previous frames', () => { contextPage--; renderContext(); }); previous.disabled = contextPage === 0;
        const next = button('Next frames', () => { contextPage++; renderContext(); }); next.disabled = (contextPage + 1) * 8 >= context.length;
        pager.append(previous, next);
      }
    }
    // Decode and mount images only when the reader opens the context section.
    let mounted = false;
    section.addEventListener('toggle', () => { if (section.open && !mounted) { mounted = true; renderContext(); } });
    mount.append(section);
  }
  if (!Object.keys(r.downloads).length) { mount.append(node('div', 'Transcript pending. No validated public transcript is available for download.', 'gap')); return; }
  const downloads = node('div', undefined, 'downloads');
  downloads.append(node('span', 'DOWNLOAD /'));
  for (const [ext, url] of Object.entries(r.downloads)) downloads.append(link(ext.toUpperCase(), url, true));
  mount.append(downloads, node('p', `${r.transcript_status === 'partial' ? 'Partial transcript. ' : ''}Automatic transcript · ${r.diarization_status === 'complete_chunk_local' ? 'Voices grouped within each processing chunk.' : r.diarization_status === 'complete' ? 'Voices grouped within this recording.' : 'Speaker separation pending.'} Names follow source-based attributions.`, 'review-note'));
  const related = (archive.people || []).filter(p => p.interventions.some(i => i.recording_id === r.id));
  const voices = node('div', undefined, 'recording-people');
  for (const p of related.filter(p => p.named)) {
    const b = button('', () => openPerson(p.id), 'person-chip'); b.append(avatar(p), node('span', personName(p))); voices.append(b);
  }
  if (jump && jump.person_id) {
    const p = (archive.people || []).find(p => p.id === jump.person_id);
    if (p) mount.append(button(`View profile · ${personName(p)}`, () => openPerson(p.id), 'profile-return'));
  }
  if (voices.children.length) mount.append(voices);
  const transcript = node('section', undefined, 'transcript'); mount.append(transcript);
  transcript.append(node('p', 'Loading transcript…'));
  try {
    // Added 2026-10-24: v2 recordings render from data/<id>-v2.json; all others use the v1 reader below.
    const v2 = await fetchV2(r.id); if (token !== generation) return;
    if (v2) { renderV2(v2, transcript, r, jump); return; }
    const res = await fetch(`${base}data/${r.id}.json`); if (!res.ok) throw new Error('Unavailable');
    const doc = await res.json(); if (token !== generation) return;
    transcript.replaceChildren(node('h3', 'Original Arabic transcript'));
    const mode = node('div', undefined, 'reader-modes'); mode.setAttribute('role', 'group'); mode.setAttribute('aria-label', 'Transcript display');
    const readingButton = button('Reading view', () => { transcriptMode = 'reading'; renderText(); });
    const timedButton = button('Timed captions', () => { transcriptMode = 'timed'; page = targetPage(); renderText(); });
    mode.append(readingButton, timedButton);
    const hint = node('p', 'Reading copy: clear hesitations, music/applause labels and caption arrows removed. Wording is otherwise unchanged. Timed captions and downloads retain the original text.', 'reader-hint');
    const controls = node('div', undefined, 'transcript-controls');
    const searchControl = node('div');
    const searchLabel = node('label', 'Find words in this recording'); searchLabel.htmlFor = 'transcript-search';
    const search = node('input'); search.id = 'transcript-search'; search.type = 'search'; search.placeholder = 'Search original Arabic text…'; search.dir = 'auto';
    searchControl.append(searchLabel, search);
    const counts = node('p', '', 'subtle'); counts.setAttribute('aria-live', 'polite');
    const rows = node('div'); const pager = node('div', undefined, 'pager');
    const voiceControl = node('div');
    const voiceLabel = node('label', 'Speaker'); voiceLabel.htmlFor = 'transcript-speaker';
    const voiceFilter = node('select'); voiceFilter.id = 'transcript-speaker';
    const allVoices = node('option', 'All voices'); allVoices.value = ''; voiceFilter.append(allVoices);
    for (const p of related) { const option = node('option', personName(p)); option.value = p.id; voiceFilter.append(option); }
    voiceControl.append(voiceLabel, voiceFilter); controls.append(searchControl, voiceControl);
    transcript.append(mode, hint, controls, counts, rows, pager);
    const passages = readingPassages(doc.segments);
    const target = jump && doc.segments[transcriptTargetIndex(doc.segments, jump.start, jump.person_id)];
    const matchesVoice = s => !voiceFilter.value || s.speaker_id === voiceFilter.value;
    const query = () => search.value.trim().toLocaleLowerCase();
    const timedMatches = () => doc.segments.filter(s => s.text.toLocaleLowerCase().includes(query()) && matchesVoice(s));
    function targetPage() {
      const index = timedMatches().indexOf(target);
      return Math.max(0, Math.floor(index / 80));
    }
    let page = targetPage();
    function speakerHeading(passage, cls) {
      const label = passage.speaker_label || 'Unassigned voice';
      return passage.speaker_id ? button(label, () => openPerson(passage.speaker_id), cls + ' speaker-link') : node('span', label, cls);
    }
    function renderText() {
      readingButton.setAttribute('aria-pressed', String(transcriptMode === 'reading'));
      timedButton.setAttribute('aria-pressed', String(transcriptMode === 'timed'));
      rows.replaceChildren(); pager.replaceChildren(); pager.hidden = transcriptMode === 'reading';
      rows.className = transcriptMode === 'reading' ? 'transcript-prose' : 'transcript-captions';
      if (transcriptMode === 'reading') {
        // Filter after grouping, so a search never joins distant speech together.
        const visible = passages.filter(matchesVoice).map(p => ({...p,
          paragraphs: readingParagraphs(p, query())
        })).filter(p => p.paragraphs.length);
        const paragraphCount = visible.reduce((total, p) => total + p.paragraphs.length, 0);
        counts.textContent = query() || voiceFilter.value ? `${paragraphCount.toLocaleString()} matching paragraphs · Clear filters to read the full transcript.` :
          'Full transcript · Continuous reading · Playback times are source-relative.';
        for (const passage of visible) {
          const article = node('article', undefined, 'reading-passage');
          const heading = node('header', undefined, 'passage-heading');
          const first = passage.paragraphs[0];
          const seek = button(`Play ${time(first.start)}`, () => navigate(recordingHash(r.id, first.start), {autoplay: true}), 'passage-time');
          seek.setAttribute('aria-label', `Play passage at ${time(first.start)}`);
          heading.append(speakerHeading(passage, 'passage-speaker'), seek); article.append(heading);
          const flags = [...new Set(passage.paragraphs.flatMap(p => p.flags))];
          if (flags.length) {
            const notes = node('details', undefined, 'passage-notes');
            notes.append(node('summary', 'Attribution notes'), node('p', flags.join(' · ').replaceAll('_', ' ') + '. These flags apply to some captions in this passage; exact boundaries are available in Timed captions.'));
            article.append(notes);
          }
          for (const paragraph of passage.paragraphs) {
            const text = node('p', paragraph.readingText, 'reading-paragraph'); text.dir = 'auto'; text.lang = 'ar';
            if (paragraph.segments.includes(target)) text.classList.add('selected-intervention');
            article.append(text);
          }
          rows.append(article);
        }
        if (!visible.length) rows.append(node('p', 'No paragraphs match these filters.', 'gap'));
        return;
      }
      const matches = timedMatches();
      const pages = Math.max(1, Math.ceil(matches.length / 80)); page = Math.min(page, pages - 1);
      counts.textContent = `${matches.length.toLocaleString()} original captions · Page ${page + 1} of ${pages}. Timestamps are source-relative.`;
      for (const s of matches.slice(page * 80, (page + 1) * 80)) {
        const row = node('article', undefined, 'segment');
        const seek = button(time(s.start), () => {
          navigate(recordingHash(r.id, s.start), {autoplay: true});
        }, 'timestamp'); seek.setAttribute('aria-label', `Play source at ${time(s.start)}`);
        const body = node('div'); body.append(speakerHeading(s, 'speaker'));
        if (s === target) row.classList.add('selected-intervention');
        if (s.flags.length) body.append(node('span', s.flags.join(' · ').replaceAll('_', ' '), 'flags'));
        const text = node('p', s.text); text.dir = 'auto'; text.lang = 'ar'; body.append(text); row.append(seek, body); rows.append(row);
      }
      if (!matches.length) rows.append(node('p', 'No captions match these filters.', 'gap'));
      const previous = button('Previous captions', () => { page--; renderText(); }); previous.disabled = page === 0;
      const next = button('Next captions', () => { page++; renderText(); }); next.disabled = page + 1 >= pages;
      pager.append(previous, next);
    }
    search.addEventListener('input', () => { page = 0; renderText(); });
    voiceFilter.addEventListener('change', () => { page = 0; renderText(); }); renderText();

  } catch (_) {
    if (token === generation) transcript.replaceChildren(node('p', 'Transcript could not load. Use a download above or reload the page.', 'gap'));
  }
}
function personName(person) { return person.name_ar || person.name_en || 'Unassigned voice'; }
function avatar(person) {
  if (person.portrait) {
    const image = node('img'); image.src = person.portrait.url; image.width = 64; image.height = 64;
    image.alt = `Portrait: ${personName(person)}`; image.loading = 'lazy'; image.className = 'person-avatar'; return image;
  }
  const name = person.name_en || person.name_ar || '';
  const letters = person.named ? name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('') : 'VOICE';
  const placeholder = node('span', letters, 'person-avatar avatar-placeholder'); placeholder.setAttribute('aria-hidden', 'true'); return placeholder;
}
function renderPeople() {
  const q = $('people-search').value.trim().toLocaleLowerCase();
  const kind = $('people-kind').value;
  const people = (archive.people || []).filter(p => (kind === 'all' || (kind === 'named' ? p.named : !p.named)) &&
    `${p.name_ar || ''} ${p.name_en || ''} ${p.role || ''} ${p.tags.join(' ')} ${p.recording_id || ''}`.toLocaleLowerCase().includes(q));
  const pages = Math.max(1, Math.ceil(people.length / 20)); peoplePage = Math.min(peoplePage, pages - 1);
  $('people-count').textContent = `${people.length} profiles · Page ${peoplePage + 1} of ${pages}`;
  $('people-list').replaceChildren(); $('people-pager').replaceChildren();
  for (const p of people.slice(peoplePage * 20, (peoplePage + 1) * 20)) {
    const card = button('', () => openPerson(p.id), 'person-card'); card.setAttribute('aria-current', String(activePersonId === p.id));
    const body = node('span'); const name = node('strong', personName(p)); name.dir = 'auto';
    body.append(name, node('span', p.role || (p.named ? 'Source-attributed person' : p.recording_id), 'person-role'),
      node('span', `${p.recording_count} recording${p.recording_count === 1 ? '' : 's'} · ${p.intervention_count} attributed passages`, 'person-count'));
    card.append(avatar(p), body); $('people-list').append(card);
  }
  const previous = button('Previous', () => { peoplePage--; renderPeople(); }); previous.disabled = peoplePage === 0;
  const next = button('Next', () => { peoplePage++; renderPeople(); }); next.disabled = peoplePage + 1 >= pages;
  $('people-pager').append(previous, next);
}
// Added 2026-10-25: one router owns linkable views and browser history.
let lastAppliedHash = null;
function recordingHash(id, start, personId = null, exactMilliseconds = null) {
  const milliseconds = exactMilliseconds === null ? Math.round(start * 1000) : exactMilliseconds;
  return `#recording-${id}-at-${milliseconds}${personId ? '-person-' + personId : ''}`;
}
function resolveRoute(hash) {
  if (hash === '#people') return {hash, view: 'people'};
  const person = hash.match(/^#person-([A-Za-z0-9_-]+)$/);
  if (person && (archive.people || []).some(p => p.id === person[1]))
    return {hash, view: 'person', id: person[1]};
  const date = hash.match(/^#day-(\d{4}-\d{2}-\d{2})$/);
  const daySlot = date && archive.slots.find(s => s.date === date[1]);
  if (daySlot) return {hash, view: 'day', slot: daySlot};
  const recording = hash.match(/^#recording-([A-Za-z0-9_-]{11})-at-(\d+)(?:-person-([A-Za-z0-9_-]+))?$/);
  if (recording) {
    const id = recording[1], ms = Number(recording[2]), start = ms / 1000;
    const source = archive.recordings.find(r => r.id === id);
    const slot = archive.slots.find(s => s.recording_ids.includes(id));
    if (source && slot && Number.isSafeInteger(ms) && start >= 0 &&
        (!source.duration_seconds || start <= source.duration_seconds)) {
      const matches = (archive.people || []).filter(p => !recording[3] || p.id === recording[3])
        .flatMap(p => p.interventions).filter(i => i.recording_id === id && Math.round(i.start * 1000) === ms);
      // Reuse only an actual public passage, preserving its type, bounds and evidence.
      const sourceTurns = matches.filter(i => i.type === 'source_named_turn');
      // A broader continuity attribution may share a start with a saved short turn.
      // Existing links retain the original source-only bounds/evidence.
      const passage = matches.length === 1 ? matches[0] :
        sourceTurns.length === 1 ? sourceTurns[0] : null;
      return {hash: recordingHash(id, start, passage && recording[3] ? passage.person_id : null, ms),
        view: 'recording', slot, jump: passage || {recording_id: id, start}};
    }
  }
  // Added 2026-10-24: #t=<seconds> deep link into the current (or first) session's recording.
  const deep = hash.match(/^#t=(\d+(?:\.\d+)?)$/);
  if (deep) {
    const current = archive.slots.find(s => s.id === selected) || archive.slots[0];
    if (current && current.recording_ids[0]) return resolveRoute(recordingHash(current.recording_ids[0], Number(deep[1])));
  }
  const slotMatch = hash.match(/^#slot-(\d+)$/);
  const slot = archive.slots.find(s => slotMatch && s.id === Number(slotMatch[1])) || archive.slots[0];
  return {hash: `#slot-${slot.id}`, view: 'slot', slot};
}
function applyRoute(route, autoplay = false) {
  if (route.view === 'people') {
    activePersonId = null; setView('people'); renderPeople();
    $('person-detail').replaceChildren(node('p', 'Select a profile to browse its interventions.'));
    return;
  }
  if (route.view === 'person') {
    $('people-search').value = ''; $('people-kind').value = 'all'; peoplePage = 0;
    renderPerson(route.id); return;
  }
  day = route.slot.date; $('search').value = ''; $('coverage').value = 'all';
  const dates = [...new Set(archive.slots.map(s => s.date))].sort();
  for (const [i, b] of [...$('days').children].entries()) b.setAttribute('aria-current', dates[i] === day ? 'date' : 'false');
  selectSlot(route.slot, true, route.jump || null, autoplay);
}
function navigate(hash, {replace = false, autoplay = false} = {}) {
  if (!archive) return;
  const route = resolveRoute(hash);
  if (replace) history.replaceState(null, '', route.hash);
  else if (location.hash !== route.hash) history.pushState(null, '', route.hash);
  lastAppliedHash = location.hash;
  applyRoute(route, autoplay);
}
function restoreRoute() {
  // The native skip link is a DOM anchor, not an archive route.
  if (location.hash === '#session') {
    if (archive && $('programme-view').hidden) {
      const slot = archive.slots.find(s => s.id === selected) || archive.slots[0];
      applyRoute({view: 'slot', slot});
    }
    $('session').focus({preventScroll: true});
    return;
  }
  if (!archive || lastAppliedHash === location.hash) return;
  lastAppliedHash = location.hash;
  // Browser restoration never writes history or starts playback automatically.
  applyRoute(resolveRoute(location.hash));
}
window.addEventListener('popstate', restoreRoute);
window.addEventListener('hashchange', restoreRoute);
function openIntervention(intervention) {
  navigate(recordingHash(intervention.recording_id, intervention.start, intervention.person_id), {autoplay: true});
}
function openPerson(id) { navigate(`#person-${id}`); }
function renderPerson(id) {
  const person = (archive.people || []).find(p => p.id === id); if (!person) return;
  activePersonId = id; setView('people'); renderPeople();
  const mount = $('person-detail'); mount.replaceChildren();
  const head = node('div', undefined, 'profile-head'); const names = node('div');
  const title = node('h2', personName(person)); title.dir = 'auto'; names.append(title);
  if (person.name_ar && person.name_en) names.append(node('p', person.name_en, 'profile-english'));
  if (person.role) { const role = node('p', person.role, 'profile-role'); role.dir = 'auto'; names.append(role); }
  head.append(avatar(person), names); mount.append(head);
  if (person.role_source_url) mount.append(link('Position source ↗', person.role_source_url));
  const tags = node('div', undefined, 'profile-tags'); for (const tag of person.tags) tags.append(node('span', tag)); mount.append(tags);
  mount.append(node('p', `${person.recording_count} recording${person.recording_count === 1 ? '' : 's'} / ${person.intervention_count} attributed passages`, 'profile-metrics'));
  mount.append(node('p', person.named ? 'Names follow source-based introductions, self-identification or written names. Attributed passages are text ranges or bounded source turns; they do not count distinct speeches.' :
    person.attribution === 'unassigned_segments' ? 'Unassigned segments in one recording. This group may contain more than one voice.' :
    'An anonymous voice cluster within one recording. This profile does not establish a named identity or link the voice to another recording.', 'subtle'));
  if (person.name_spelling_status === 'as_stated_in_source_transcript') {
    const note = node('p', 'Name and position follow the automatic source transcript.', 'subtle');
    if (person.name_source_url) note.append(document.createTextNode(' '), link('Name source', person.name_source_url));
    mount.append(note);
  }
  if (person.portrait) {
    const photo = node('p', undefined, 'subtle'); photo.append(node('span', person.portrait.caption || 'Source-supplied portrait'), document.createTextNode(' · '), link('Image source ↗', person.portrait.source_url)); mount.append(photo);
  }
  const evidence = new Map();
  for (const intervention of person.interventions) for (const e of intervention.evidence) evidence.set(e.url, e);
  if (evidence.size) {
    const sources = node('details'); sources.append(node('summary', 'Attribution sources'));
    const list = node('ul'); for (const e of evidence.values()) { const item = node('li'); item.append(link(e.label || 'Source evidence ↗', e.url)); list.append(item); } sources.append(list); mount.append(sources);
  }
  const heading = node('h3', 'Attributed passages across recordings'); mount.append(heading);
  const list = node('div'); const pager = node('div', undefined, 'pager'); const count = node('p', '', 'subtle'); count.setAttribute('aria-live', 'polite'); mount.append(count, list, pager);
  const recordingOrder = new Map(archive.recordings.map((r, i) => [r.id, i]));
  const interventions = [...person.interventions].sort((a, b) => recordingOrder.get(a.recording_id) - recordingOrder.get(b.recording_id) || a.start - b.start);
  let page = 0;
  function renderInterventions() {
    const pages = Math.max(1, Math.ceil(interventions.length / 30)); list.replaceChildren(); pager.replaceChildren();
    count.textContent = `Page ${page + 1} of ${pages} · Source-relative timestamps`;
    let lastRecording;
    for (const intervention of interventions.slice(page * 30, (page + 1) * 30)) {
      const recording = archive.recordings.find(r => r.id === intervention.recording_id);
      if (lastRecording !== recording.id) { const h = node('h4', recording.title || recording.id, 'intervention-recording'); h.dir = 'auto'; list.append(h); lastRecording = recording.id; }
      const item = button('', () => openIntervention(intervention), 'intervention');
      item.append(node('span', `${time(intervention.start)}–${time(intervention.end)}`, 'intervention-time'),
        node('span', `${recording.channel || recording.id} · Play passage ↗`)); list.append(item);
      if (intervention.type === 'source_named_turn') {
        list.append(node('p', intervention.caption_status === 'spans_boundary' ?
          'Source-attributed turn; caption spans its boundary.' :
          'Source-attributed turn; no complete caption segment.', 'source-turn-note'));
        if (intervention.source_url) list.append(link('Open source-attributed turn ↗', intervention.source_url));
      }
    }
    const previous = button('Previous passages', () => { page--; renderInterventions(); }); previous.disabled = page === 0;
    const next = button('Next passages', () => { page++; renderInterventions(); }); next.disabled = page + 1 >= pages;
    pager.append(previous, next);
  }
  renderInterventions();
  mount.focus({preventScroll: true}); if (innerWidth < 800) mount.scrollIntoView({behavior: 'smooth'});
}

async function init() {
  try {
    const response = await fetch(base + 'data/archive.json'); if (!response.ok) throw new Error('Unavailable');
    archive = await response.json();
    const available = archive.recordings.filter(r => Object.keys(r.downloads).length).length;
    $('metrics').textContent = `6 DAYS / ${archive.slots.length} PROGRAMME SLOTS / ${archive.recordings.length} PUBLIC RECORDINGS / ${available} TRANSCRIPTS`;
    $('all-downloads').hidden = available === 0;
    $('date-notice').textContent = archive.date_notice;
    $('people-search').addEventListener('input', () => { peoplePage = 0; renderPeople(); });
    $('people-kind').addEventListener('change', () => { peoplePage = 0; renderPeople(); });
    renderPeople();
    const dates = [...new Set(archive.slots.map(s => s.date))].sort();
    for (const [i, date] of dates.entries()) {
      const b = archiveLink(`Day ${i + 1} · ${date.slice(8)} Oct`, `#day-${date}`, 'day-link');
      b.setAttribute('aria-current', 'false'); $('days').append(b);
    }
    $('search').addEventListener('input', () => { if ($('search').value) { day = null; for (const b of $('days').children) b.setAttribute('aria-current', 'false'); } renderSlots(); });
    $('coverage').addEventListener('change', renderSlots);
    navigate(location.hash, {replace: true});
  } catch (_) { $('metrics').textContent = 'Archive could not load. Please reload the page.'; }
}
init();
