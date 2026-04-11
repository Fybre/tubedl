/* ── TubeDL Frontend ──────────────────────────────────────── */
'use strict';

// ── Session ────────────────────────────────────────────────
// localStorage is device-local and never synced (unlike cookies via iCloud Keychain)
function getSessionId() {
  let id = localStorage.getItem('tubedl_session');
  if (!id) {
    id = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('tubedl_session', id);
  }
  return id;
}
const sessionId = getSessionId();

// ── State ──────────────────────────────────────────────────
const state = {
  results:          [],
  queue:            new Map(),
  currentVideo:     null,
  activeTab:        'video',
  ws:               null,
  deferredPrompt:   null,
  searchController: null,
  searchQuery:      '',
  searchLimit:      12,
  loadMoreController: null,
};

// ── DOM refs ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const searchForm    = $('searchForm');
const searchInput   = $('searchInput');
const resultsSection = $('resultsSection');
const resultsGrid   = $('resultsGrid');
const resultsTitle  = $('resultsTitle');
const resultsCount  = $('resultsCount');
const spinnerWrap   = $('spinnerWrap');
const stateBox      = $('stateBox');
const stateIcon     = $('stateIcon');
const stateMsg      = $('stateMsg');
const modalBackdrop = $('modalBackdrop');
const modalClose    = $('modalClose');
const modalThumb    = $('modalThumb');
const modalTitle    = $('modalTitle');
const modalChannel  = $('modalChannel');
const modalDuration = $('modalDuration');
const tabVideo      = $('tabVideo');
const tabAudio      = $('tabAudio');
const panelVideo    = $('panelVideo');
const panelAudio    = $('panelAudio');
const dlVideoBtn    = $('dlVideoBtn');
const dlAudioBtn    = $('dlAudioBtn');
const queueToggle   = $('queueToggle');
const queueBadge    = $('queueBadge');
const queueSidebar  = $('queueSidebar');
const queueList     = $('queueList');
const queueEmpty    = $('queueEmpty');
const queueClose    = $('queueClose');
const queueClearBtn = $('queueClearBtn');
const sidebarOverlay = $('sidebarOverlay');
const toastContainer = $('toastContainer');
const installBanner = $('installBanner');
const installBtn    = $('installBtn');
const installDismiss = $('installDismiss');

// ── Playlist modal refs ─────────────────────────────────────
const playlistBackdrop = $('playlistBackdrop');
const playlistHeading  = $('playlistHeading');
const playlistCountEl  = $('playlistCount');
const playlistList     = $('playlistList');
const playlistSpinner  = $('playlistSpinner');
const playlistQueueMp4 = $('playlistQueueMp4');
const playlistQueueMp3 = $('playlistQueueMp3');

// ── Settings modal refs ────────────────────────────────────
const settingsToggle   = $('settingsToggle');
const settingsBackdrop = $('settingsBackdrop');
const settingsClose    = $('settingsClose');
const settingsTabVideo = $('settingsTabVideo');
const settingsTabAudio = $('settingsTabAudio');
const settingsPanelVideo = $('settingsPanelVideo');
const settingsPanelAudio = $('settingsPanelAudio');
const saveSettingsBtn  = $('saveSettingsBtn');

// ── Settings Cookie Constants ──────────────────────────────
const SETTINGS_COOKIE = 'tubedl_settings';
const DEFAULT_SETTINGS = {
  mp4: { quality: 'best', sponsorBlock: false, subtitles: false, clipStart: '', clipEnd: '' },
  mp3: { format: 'mp3', quality: '0', sponsorBlock: false, clipStart: '', clipEnd: '' }
};

function getSettings() {
  try {
    const cookie = document.cookie.split('; ').find(r => r.startsWith(SETTINGS_COOKIE + '='));
    const parsed = cookie ? JSON.parse(decodeURIComponent(cookie.split('=')[1])) : {};
    return {
      mp4: { ...DEFAULT_SETTINGS.mp4, ...parsed.mp4 },
      mp3: { ...DEFAULT_SETTINGS.mp3, ...parsed.mp3 }
    };
  } catch { return DEFAULT_SETTINGS; }
}

function saveSettingsCookie(settings) {
  document.cookie = `${SETTINGS_COOKIE}=${encodeURIComponent(JSON.stringify(settings))};path=/;max-age=31536000`;
}

// ── Utility ────────────────────────────────────────────────
function formatDuration(secs) {
  if (!secs || secs < 0) return '';
  secs = Math.round(secs);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatViews(n) {
  if (!n) return '';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B views';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M views';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K views';
  return n + ' views';
}

function formatDate(d) {
  if (!d || d.length !== 8) return '';
  const y = d.slice(0, 4), m = d.slice(4, 6), day = d.slice(6, 8);
  return new Date(`${y}-${m}-${day}`).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Search ─────────────────────────────────────────────────
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  if (isYouTubeURL(q)) { handleYouTubeURL(q); return; }
  doSearch(q);
});

let searchDebounce;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (q.length < 3) return;
  if (isYouTubeURL(q)) return; // wait for explicit submit on URLs
  searchDebounce = setTimeout(() => doSearch(q), 600);
});

function isYouTubeURL(str) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(str);
}

function isPlaylistURL(str) {
  return /[?&]list=/.test(str) || /youtube\.com\/playlist/.test(str);
}

function handleYouTubeURL(url) {
  if (isPlaylistURL(url)) {
    openPlaylistModal(url);
  } else {
    // Single video URL — treat as a search term (yt-dlp handles it directly)
    doSearch(url);
  }
}

async function doSearch(query) {
  if (state.searchController) state.searchController.abort();
  state.searchController = new AbortController();

  // Reset pagination state for a new search
  state.searchQuery = query;
  state.searchLimit = 12;
  state.results     = [];

  showSpinner(true);
  hideState();
  resultsSection.hidden = true;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=12`, {
      signal: state.searchController.signal,
    });
    if (!res.ok) throw new Error('Search failed');
    const { results } = await res.json();
    state.results = results;

    if (!results.length) {
      showState('🔍', 'No results found. Try a different search.');
    } else {
      renderResults(results, query);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    showState('⚠️', `Search error: ${err.message}`);
  } finally {
    showSpinner(false);
  }
}

async function loadMore() {
  if (state.loadMoreController) state.loadMoreController.abort();
  state.loadMoreController = new AbortController();

  const loadMoreBtn = $('loadMoreBtn');
  loadMoreBtn.textContent = 'Loading…';
  loadMoreBtn.disabled = true;

  const newLimit = state.searchLimit + 12;

  try {
    const res = await fetch(
      `/api/search?q=${encodeURIComponent(state.searchQuery)}&limit=${newLimit}`,
      { signal: state.loadMoreController.signal }
    );
    if (!res.ok) throw new Error('Failed to load more');
    const { results } = await res.json();

    // Only the newly returned items (beyond what we already have)
    const newResults = results.slice(state.results.length);

    if (newResults.length === 0) {
      // Nothing new came back — we've hit the end
      $('loadMoreWrap').hidden = true;
      return;
    }

    state.searchLimit = newLimit;
    state.results = results;

    appendResults(newResults);

    // Hide button if this batch returned fewer than 12 new items
    $('loadMoreWrap').hidden = newResults.length < 12;
  } catch (err) {
    if (err.name === 'AbortError') return;
    toast(`Load more failed: ${err.message}`, 'error');
  } finally {
    loadMoreBtn.textContent = 'Load more';
    loadMoreBtn.disabled = false;
  }
}

function renderResults(results, query) {
  resultsTitle.textContent = `Results for "${query}"`;
  resultsCount.textContent = `${results.length} videos`;
  resultsGrid.innerHTML = '';
  resultsSection.hidden = false;

  appendResults(results);

  // Show "Load more" if we got a full page (might be more available)
  $('loadMoreWrap').hidden = results.length < 12;
}

function appendResults(results) {
  const offset = resultsGrid.querySelectorAll('.result-card').length;

  results.forEach((v) => {
    const div = document.createElement('div');
    div.innerHTML = resultCardHTML(v);
    const card = div.firstElementChild;
    resultsGrid.appendChild(card);

    // Card body click → download modal
    card.querySelector('.card-body')?.addEventListener('click', () => openModal(v));

    // All preview buttons (overlay + small action button)
    card.querySelectorAll('.btn-preview').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPreview(v);
      });
    });

    // Options button → open modal
    card.querySelector('.btn-options')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(v);
    });

    // Quick download buttons → use global settings
    card.querySelector('.btn-video')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const settings = getSettings();
      queueDownload(v, 'video', settings.mp4.quality, false, {
        subtitles: settings.mp4.subtitles,
        sponsorBlock: settings.mp4.sponsorBlock,
        clipStart: settings.mp4.clipStart || null,
        clipEnd: settings.mp4.clipEnd || null
      });
    });
    card.querySelector('.btn-audio')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const settings = getSettings();
      queueDownload(v, 'audio', null, false, {
        audioFormat: settings.mp3.format,
        audioQuality: settings.mp3.quality,
        sponsorBlock: settings.mp3.sponsorBlock,
        clipStart: settings.mp3.clipStart || null,
        clipEnd: settings.mp3.clipEnd || null
      });
    });
  });

  // Update count label
  const total = resultsGrid.querySelectorAll('.result-card').length;
  resultsCount.textContent = `${total} videos`;
}

function resultCardHTML(v) {
  const thumb = escapeHtml(v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`);
  const title = escapeHtml(v.title);
  const channel = escapeHtml(v.channel || '');
  const dur = formatDuration(v.duration);
  const views = formatViews(v.viewCount);
  const date = formatDate(v.uploadDate);

  return `
  <div class="result-card" tabindex="0" role="button" aria-label="${title}">
    <div class="card-thumb-wrap">
      <img class="card-thumb" src="${thumb}" alt="" loading="lazy"
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22><rect fill=%22%231e1e36%22 width=%2216%22 height=%229%22/></svg>'" />
      ${dur ? `<span class="card-duration">${dur}</span>` : ''}
      <div class="card-overlay">
        <button class="card-play-icon btn-preview" aria-label="Preview">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
      </div>
    </div>
    <div class="card-body">
      <p class="card-title">${title}</p>
      <p class="card-channel">${channel}</p>
      <div class="card-meta">
        ${views ? `<span>${views}</span>` : ''}
        ${date ? `<span>·</span><span>${date}</span>` : ''}
      </div>
    </div>
    <div class="card-actions">
      <button class="btn btn-preview-sm btn-sm btn-preview" aria-label="Preview">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <button class="btn btn-options btn-sm" title="More options" aria-label="More options">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      <button class="btn btn-video btn-sm">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
        Video
      </button>
      <button class="btn btn-audio btn-sm">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        Audio
      </button>
    </div>
  </div>`;
}

// ── Modal ──────────────────────────────────────────────────
function openModal(video, preferredTab = 'video') {
  state.currentVideo = video;
  modalThumb.src      = video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
  modalTitle.textContent   = video.title;
  modalChannel.textContent = video.channel || '';
  modalDuration.textContent = formatDuration(video.duration);

  // Load global settings as defaults
  const settings = getSettings();

  // Apply Video defaults
  const qualityRadio = document.querySelector(`input[name="quality"][value="${settings.mp4.quality}"]`);
  if (qualityRadio) qualityRadio.checked = true;
  $('optSubtitles').checked = settings.mp4.subtitles;
  $('optSponsorBlockV').checked = settings.mp4.sponsorBlock;
  $('clipStartV').value = settings.mp4.clipStart;
  $('clipEndV').value = settings.mp4.clipEnd;

  // Apply Audio defaults
  const formatRadio = document.querySelector(`input[name="audioFormat"][value="${settings.mp3.format}"]`);
  if (formatRadio) formatRadio.checked = true;
  const audioQualityRadio = document.querySelector(`input[name="audioQuality"][value="${settings.mp3.quality}"]`);
  if (audioQualityRadio) audioQualityRadio.checked = true;
  $('optSponsorBlockA').checked = settings.mp3.sponsorBlock;
  $('clipStartA').value = settings.mp3.clipStart;
  $('clipEndA').value = settings.mp3.clipEnd;

  // Collapse advanced sections
  document.querySelectorAll('.advanced-section[open]').forEach((d) => d.removeAttribute('open'));

  switchTab(preferredTab);
  modalBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalBackdrop.hidden = true;
  document.body.style.overflow = '';
  state.currentVideo = null;
}

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closePreview(); closeQueue(); closePlaylistModal(); closeSettings(); } });

// ── Preview ─────────────────────────────────────────────────
const previewBackdrop  = $('previewBackdrop');
const previewVideo     = $('previewVideo');
const previewLoading   = $('previewLoading');
const previewError     = $('previewError');
const previewErrorMsg  = $('previewErrorMsg');
const previewYtLink    = $('previewYtLink');
const previewTitleEl   = $('previewTitle');

function setPreviewState(s) {
  previewLoading.hidden = s !== 'loading';
  previewVideo.hidden   = s !== 'ready';
  previewError.hidden   = s !== 'error';
}

async function openPreview(video) {
  previewTitleEl.textContent = video.title;
  previewYtLink.href = `https://www.youtube.com/watch?v=${video.id}`;
  previewBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  setPreviewState('loading');

  try {
    const res = await fetch(`/api/stream/${video.id}`);
    if (!res.ok) throw new Error((await res.json()).error || 'Stream unavailable');
    const { videoUrl } = await res.json();
    previewVideo.src = videoUrl;
    setPreviewState('ready');
    previewVideo.play().catch(() => {}); // autoplay (may be blocked by browser policy)
  } catch (err) {
    previewErrorMsg.textContent = err.message || 'Could not load preview.';
    setPreviewState('error');
  }
}

function closePreview() {
  if (previewBackdrop.hidden) return;
  previewVideo.pause();
  previewVideo.src = '';   // release the stream
  previewBackdrop.hidden = true;
  document.body.style.overflow = '';
}

$('previewClose').addEventListener('click', closePreview);
previewBackdrop.addEventListener('click', (e) => { if (e.target === previewBackdrop) closePreview(); });

// ── Settings Modal ─────────────────────────────────────────
function openSettings() {
  settingsBackdrop.hidden = false;
  loadSettingsIntoModal();
}

function closeSettings() {
  settingsBackdrop.hidden = true;
}

function switchSettingsTab(tab) {
  settingsTabVideo.classList.toggle('active', tab === 'video');
  settingsTabAudio.classList.toggle('active', tab === 'audio');
  settingsPanelVideo.classList.toggle('hidden', tab !== 'video');
  settingsPanelAudio.classList.toggle('hidden', tab !== 'audio');
}

function loadSettingsIntoModal() {
  const s = getSettings();
  // Video settings
  const qualityRadio = document.querySelector(`input[name="defaultQuality"][value="${s.mp4.quality}"]`);
  if (qualityRadio) qualityRadio.checked = true;
  $('defaultSubtitles').checked = s.mp4.subtitles;
  $('defaultSponsorBlockV').checked = s.mp4.sponsorBlock;
  $('defaultClipStartV').value = s.mp4.clipStart;
  $('defaultClipEndV').value = s.mp4.clipEnd;
  // Audio settings
  const formatRadio = document.querySelector(`input[name="defaultAudioFormat"][value="${s.mp3.format}"]`);
  if (formatRadio) formatRadio.checked = true;
  const audioQualityRadio = document.querySelector(`input[name="defaultAudioQuality"][value="${s.mp3.quality}"]`);
  if (audioQualityRadio) audioQualityRadio.checked = true;
  $('defaultSponsorBlockA').checked = s.mp3.sponsorBlock;
  $('defaultClipStartA').value = s.mp3.clipStart;
  $('defaultClipEndA').value = s.mp3.clipEnd;
}

function handleSaveSettings() {
  const settings = {
    mp4: {
      quality: document.querySelector('input[name="defaultQuality"]:checked')?.value || 'best',
      subtitles: $('defaultSubtitles').checked,
      sponsorBlock: $('defaultSponsorBlockV').checked,
      clipStart: $('defaultClipStartV').value.trim(),
      clipEnd: $('defaultClipEndV').value.trim()
    },
    mp3: {
      format: document.querySelector('input[name="defaultAudioFormat"]:checked')?.value || 'mp3',
      quality: document.querySelector('input[name="defaultAudioQuality"]:checked')?.value || '0',
      sponsorBlock: $('defaultSponsorBlockA').checked,
      clipStart: $('defaultClipStartA').value.trim(),
      clipEnd: $('defaultClipEndA').value.trim()
    }
  };
  saveSettingsCookie(settings);
  closeSettings();
  toast('Default settings saved', 'success');
}

settingsToggle?.addEventListener('click', openSettings);
settingsClose?.addEventListener('click', closeSettings);
settingsBackdrop?.addEventListener('click', (e) => { if (e.target === settingsBackdrop) closeSettings(); });
settingsTabVideo?.addEventListener('click', () => switchSettingsTab('video'));
settingsTabAudio?.addEventListener('click', () => switchSettingsTab('audio'));
saveSettingsBtn?.addEventListener('click', handleSaveSettings);

// ── Download Modal Tabs ────────────────────────────────────
tabVideo.addEventListener('click', () => switchTab('video'));
tabAudio.addEventListener('click', () => switchTab('audio'));

function switchTab(tab) {
  state.activeTab = tab;
  tabVideo.classList.toggle('active', tab === 'video');
  tabAudio.classList.toggle('active', tab === 'audio');
  panelVideo.classList.toggle('hidden', tab !== 'video');
  panelAudio.classList.toggle('hidden', tab !== 'audio');
}

dlVideoBtn.addEventListener('click', () => {
  const quality = document.querySelector('input[name="quality"]:checked')?.value || 'best';
  const options = {
    subtitles:    !!$('optSubtitles')?.checked,
    sponsorBlock: !!$('optSponsorBlockV')?.checked,
    clipStart:    $('clipStartV')?.value.trim() || null,
    clipEnd:      $('clipEndV')?.value.trim()   || null,
  };
  queueDownload(state.currentVideo, 'video', quality, false, options);
  closeModal();
});

dlAudioBtn.addEventListener('click', () => {
  const options = {
    audioFormat:  document.querySelector('input[name="audioFormat"]:checked')?.value || 'mp3',
    audioQuality: document.querySelector('input[name="audioQuality"]:checked')?.value || '0',
    sponsorBlock: !!$('optSponsorBlockA')?.checked,
    clipStart:    $('clipStartA')?.value.trim() || null,
    clipEnd:      $('clipEndA')?.value.trim()   || null,
  };
  queueDownload(state.currentVideo, 'audio', null, false, options);
  closeModal();
});

// ── Download Queue ─────────────────────────────────────────
async function queueDownload(videoInfo, format, quality, silent = false, options = {}) {
  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoInfo, format, quality, sessionId, ...options }),
    });
    if (!res.ok) throw new Error('Failed to add download');
    if (!silent) {
      toast(`Added to queue: ${videoInfo.title.substring(0, 40)}…`, 'info');
      openQueue();
    }
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function cancelJob(id) {
  await fetch(`/api/queue/${id}/cancel`, { method: 'POST' });
}

async function retryJob(id) {
  await fetch(`/api/queue/${id}/retry`, { method: 'POST' });
}

async function removeJob(id) {
  await fetch(`/api/queue/${id}`, { method: 'DELETE' });
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isPWA() {
  return window.matchMedia('(display-mode: standalone)').matches || 
         window.navigator.standalone === true;
}

async function downloadFile(id) {
  const url = `/api/file/${id}`;
  const job = state.queue.get(id);

  if (isIOS()) {
    // Try Web Share API with file blob (iOS 15+, works in PWA and Safari)
    if (navigator.canShare) {
      toast('Preparing download…', 'info');
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('File not available');
        const blob = await response.blob();
        const ext  = blob.type.includes('audio') ? '.mp3' : '.mp4';
        const name = ((job?.title || 'download').replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 100)) + ext;
        const file = new File([blob], name, { type: blob.type });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return; // user dismissed share sheet
        // fall through to Safari open
      }
    }
    // Fallback: open URL in Safari — user taps Share → Save to Files
    window.open(url, '_blank');
    toast('Tap the Share button → Save to Files', 'info');
  } else {
    window.location.href = url;
  }
}

// ── Queue Sidebar ──────────────────────────────────────────
function openQueue() {
  queueSidebar.classList.add('open');
  sidebarOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeQueue() {
  queueSidebar.classList.remove('open');
  sidebarOverlay.classList.remove('active');
  document.body.style.overflow = '';
}
queueToggle.addEventListener('click', () => {
  queueSidebar.classList.contains('open') ? closeQueue() : openQueue();
});
queueClose.addEventListener('click', closeQueue);
sidebarOverlay.addEventListener('click', closeQueue);

queueClearBtn.addEventListener('click', async () => {
  const done = [...state.queue.values()].filter(
    (j) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled'
  );
  await Promise.all(done.map((j) => removeJob(j.id)));
});

// Save all completed files
$('queueSaveAllBtn').addEventListener('click', async () => {
  const completed = [...state.queue.values()].filter((j) => j.status === 'completed');
  if (!completed.length) { toast('No completed downloads to save', 'info'); return; }

  if (isIOS() && navigator.canShare) {
    // iOS: fetch all blobs then share in one sheet (loop is blocked after first gesture)
    toast(`Preparing ${completed.length} file${completed.length > 1 ? 's' : ''}…`, 'info');
    try {
      const files = await Promise.all(completed.map(async (job) => {
        const res = await fetch(`/api/file/${job.id}`);
        if (!res.ok) throw new Error('File not available');
        const blob = await res.blob();
        const ext  = blob.type.includes('audio') ? '.mp3' : '.mp4';
        const name = (job.title || 'download').replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 100) + ext;
        return new File([blob], name, { type: blob.type });
      }));
      if (navigator.canShare({ files })) {
        await navigator.share({ files });
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      // fall through to sequential fallback
    }
  }

  // Non-iOS: trigger downloads sequentially
  for (const job of completed) {
    const a = document.createElement('a');
    a.href = `/api/file/${job.id}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    await new Promise((r) => setTimeout(r, 300));
  }
  toast(`Saving ${completed.length} file${completed.length > 1 ? 's' : ''}…`, 'success');
});

// Download all completed files as a single ZIP
$('queueZipBtn').addEventListener('click', () => {
  const completed = [...state.queue.values()].filter((j) => j.status === 'completed');
  if (!completed.length) { toast('No completed downloads to zip', 'info'); return; }

  // Synchronous anchor click keeps the user gesture alive on iOS.
  // ZIP isn't shareable via Web Share API, so we skip that path entirely.
  toast(`Building ZIP for ${completed.length} file${completed.length > 1 ? 's' : ''}…`, 'info');
  const a = document.createElement('a');
  a.href = `/api/zip?sessionId=${encodeURIComponent(sessionId)}`;
  a.download = 'tubedl-downloads.zip';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// Queue all visible results with chosen format
$('queueAllMp4').addEventListener('click', () => queueAll('video', 'best'));
$('queueAllMp3').addEventListener('click', () => queueAll('audio'));

async function queueAll(format, quality) {
  if (!state.results.length) return;
  for (const video of state.results) {
    await queueDownload(video, format, quality, /* silent */ true);
  }
  toast(`Queued ${state.results.length} items as ${format === 'audio' ? 'Audio' : 'Video'}`, 'success');
  openQueue();
}

// ── Playlist modal ─────────────────────────────────────────
let _playlistItems = [];

async function openPlaylistModal(url) {
  _playlistItems = [];
  playlistHeading.textContent = 'Loading playlist…';
  playlistCountEl.textContent = '';
  playlistList.innerHTML = '';
  playlistSpinner.hidden = false;
  playlistQueueMp4.disabled = true;
  playlistQueueMp3.disabled = true;
  playlistBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';

  try {
    const res = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to load playlist');
    const { items } = await res.json();
    _playlistItems = items;

    playlistHeading.textContent = 'Playlist';
    playlistCountEl.textContent = `${items.length} video${items.length !== 1 ? 's' : ''}`;
    playlistSpinner.hidden = true;
    playlistQueueMp4.disabled = false;
    playlistQueueMp3.disabled = false;

    playlistList.innerHTML = '';
    items.forEach((v) => {
      const li = document.createElement('div');
      li.className = 'playlist-item';
      li.innerHTML = `
        <img class="playlist-item-thumb" src="${escapeHtml(v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`)}" alt="" loading="lazy" />
        <div class="playlist-item-info">
          <p class="playlist-item-title">${escapeHtml(v.title)}</p>
          <p class="playlist-item-meta">${escapeHtml(v.channel || '')}${v.duration ? ' · ' + formatDuration(v.duration) : ''}</p>
        </div>`;
      playlistList.appendChild(li);
    });
  } catch (err) {
    playlistSpinner.hidden = true;
    playlistHeading.textContent = 'Playlist';
    playlistList.innerHTML = `<p style="padding:1rem;color:var(--danger)">${escapeHtml(err.message)}</p>`;
  }
}

function closePlaylistModal() {
  if (playlistBackdrop?.hidden) return;
  playlistBackdrop.hidden = true;
  document.body.style.overflow = '';
}

async function queuePlaylist(format, quality) {
  if (!_playlistItems.length) return;
  playlistQueueMp4.disabled = true;
  playlistQueueMp3.disabled = true;
  for (const video of _playlistItems) {
    await queueDownload(video, format, quality, /* silent */ true);
  }
  toast(`Queued ${_playlistItems.length} items as ${format === 'audio' ? 'Audio' : 'Video'}`, 'success');
  closePlaylistModal();
  openQueue();
}

$('playlistClose')?.addEventListener('click', closePlaylistModal);
playlistBackdrop?.addEventListener('click', (e) => { if (e.target === playlistBackdrop) closePlaylistModal(); });
playlistQueueMp4?.addEventListener('click', () => queuePlaylist('video', 'best'));
playlistQueueMp3?.addEventListener('click', () => queuePlaylist('audio'));

// ── Queue helpers (shared by full-render and patch paths) ──
function statusChipHTML(status) {
  const map = { pending: 'Pending', downloading: 'Retrieving', processing: 'Processing', completed: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
  return `<span class="status-chip ${status}"><span class="dot"></span>${map[status] || status}</span>`;
}

function actionsHTML(status) {
  let h = '';
  if (status === 'completed')
    h += `<button class="icon-btn dl-btn" title="Save file"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>`;
  if (status === 'failed' || status === 'cancelled')
    h += `<button class="icon-btn retry-btn" title="Retry"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg></button>`;
  if (status === 'pending' || status === 'downloading' || status === 'processing')
    h += `<button class="icon-btn cancel-btn danger" title="Cancel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  if (status === 'completed' || status === 'failed' || status === 'cancelled')
    h += `<button class="icon-btn remove-btn danger" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>`;
  return h;
}

function attachCardActions(card, id) {
  card.querySelector('.dl-btn')?.addEventListener('click',     () => downloadFile(id));
  card.querySelector('.cancel-btn')?.addEventListener('click', () => cancelJob(id));
  card.querySelector('.retry-btn')?.addEventListener('click',  () => retryJob(id));
  card.querySelector('.remove-btn')?.addEventListener('click', () => removeJob(id));
}

function updateBadge() {
  const active = [...state.queue.values()].filter(
    (j) => j.status === 'pending' || j.status === 'downloading' || j.status === 'processing'
  ).length;
  queueBadge.textContent = active;
  queueBadge.hidden = active === 0;
}

function queueCardHTML(job) {
  const thumb    = escapeHtml(job.thumbnail || `https://i.ytimg.com/vi/${job.videoId}/hqdefault.jpg`);
  const title    = escapeHtml(job.title || 'Unknown');
  const progress = job.progress || 0;
  const errorMsg = (job.status === 'failed' && job.error)
    ? `<p class="card-error">${escapeHtml(job.error.substring(0, 120))}</p>` : '';
  const progressBar = (job.status === 'downloading') ? `
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill" style="width:${progress.toFixed(1)}%"></div></div>
      <div class="progress-meta">
        <span class="pct">${progress.toFixed(1)}%</span>
        <span class="spd">${job.speed ? job.speed + (job.eta ? ' · ETA ' + job.eta : '') : ''}</span>
      </div>
    </div>` : '';

  return `
  <div class="queue-card" data-id="${job.id}">
    <div class="queue-card-top">
      <img class="queue-thumb" src="${thumb}" alt="" loading="lazy" />
      <div class="queue-info">
        <p class="queue-card-title">${title}</p>
        <div class="queue-card-meta">
          <span class="format-tag ${job.format}">${job.format === 'audio' ? 'Audio' : 'Video'}</span>
          ${statusChipHTML(job.status)}
        </div>
        ${errorMsg}
      </div>
      <div class="queue-card-actions">${actionsHTML(job.status)}</div>
    </div>
    ${progressBar}
  </div>`;
}

// Full rebuild — only called on queue:init
function renderQueue() {
  const jobs = [...state.queue.values()].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  updateBadge();
  if (!jobs.length) {
    queueList.innerHTML = '';
    queueList.appendChild(queueEmpty);
    queueEmpty.style.display = '';
    return;
  }
  queueEmpty.style.display = 'none';
  queueList.innerHTML = jobs.map(queueCardHTML).join('');
  queueList.querySelectorAll('.queue-card').forEach((card) => {
    attachCardActions(card, card.dataset.id);
  });
}

// Insert a single new card at the top of the list
function insertJobCard(job) {
  updateBadge();
  queueEmpty.style.display = 'none';
  const div = document.createElement('div');
  div.innerHTML = queueCardHTML(job);
  const card = div.firstElementChild;
  queueList.insertBefore(card, queueList.firstChild);
  attachCardActions(card, job.id);
}

// Surgical in-place update — no card rebuild during progress ticks
function patchJobCard(job, prevStatus) {
  updateBadge();
  const card = queueList.querySelector(`[data-id="${job.id}"]`);
  if (!card) return;

  const statusChanged = prevStatus !== job.status;

  if (statusChanged) {
    // Swap status chip text/class only
    const chip = card.querySelector('.status-chip');
    if (chip) chip.outerHTML = statusChipHTML(job.status);

    // Swap action buttons (they differ by status)
    const actionsEl = card.querySelector('.queue-card-actions');
    actionsEl.innerHTML = actionsHTML(job.status);
    attachCardActions(card, job.id);

    // Show/remove error message
    const info = card.querySelector('.queue-info');
    let errEl = info.querySelector('.card-error');
    if (job.status === 'failed' && job.error) {
      if (!errEl) {
        errEl = document.createElement('p');
        errEl.className = 'card-error';
        info.appendChild(errEl);
      }
      errEl.textContent = job.error.substring(0, 120);
    } else {
      errEl?.remove();
    }
  }

  // Progress bar — only present while downloading
  if (job.status === 'downloading') {
    let wrap = card.querySelector('.progress-wrap');
    if (!wrap) {
      // First progress tick: inject the bar once
      wrap = document.createElement('div');
      wrap.className = 'progress-wrap';
      wrap.innerHTML = `
        <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
        <div class="progress-meta"><span class="pct">0%</span><span class="spd"></span></div>`;
      card.appendChild(wrap);
    }
    // Only touch the three values that actually change
    wrap.querySelector('.progress-fill').style.width = `${(job.progress || 0).toFixed(1)}%`;
    wrap.querySelector('.pct').textContent = `${(job.progress || 0).toFixed(1)}%`;
    wrap.querySelector('.spd').textContent = job.speed
      ? job.speed + (job.eta ? ' · ETA ' + job.eta : '') : '';
  } else {
    card.querySelector('.progress-wrap')?.remove();
  }
}

// Remove a single card from the list
function removeJobCard(id) {
  queueList.querySelector(`[data-id="${id}"]`)?.remove();
  updateBadge();
  if (!queueList.querySelector('.queue-card')) {
    queueList.appendChild(queueEmpty);
    queueEmpty.style.display = '';
  }
}

// ── WebSocket ──────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?sid=${encodeURIComponent(sessionId)}`);
  state.ws = ws;

  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'queue:init':
        state.queue.clear();
        msg.jobs.forEach((j) => state.queue.set(j.id, j));
        renderQueue();           // full rebuild only on init / reconnect
        break;
      case 'job:added':
        state.queue.set(msg.job.id, msg.job);
        insertJobCard(msg.job);  // insert one card at the top
        break;
      case 'job:updated': {
        const prev = state.queue.get(msg.job.id);
        state.queue.set(msg.job.id, msg.job);
        patchJobCard(msg.job, prev?.status);  // surgical update, no rebuild
        if (prev && prev.status !== 'completed' && msg.job.status === 'completed') {
          toast(`Downloaded: ${msg.job.title.substring(0, 40)}…`, 'success');
          notifyCompletion(msg.job.title);
        }
        break;
      }
      case 'job:removed':
        state.queue.delete(msg.id);
        removeJobCard(msg.id);   // remove one card
        break;
    }
  });

  ws.addEventListener('close', () => {
    setTimeout(connectWS, 3000);
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

// ── Notifications ──────────────────────────────────────────
// Request permission only on first download completion (requires user gesture context via WS event)
let notificationPermissionRequested = false;

async function notifyCompletion(title) {
  if (!('Notification' in window)) return;

  // Ask once, lazily, on first completed download
  if (!notificationPermissionRequested && Notification.permission === 'default') {
    notificationPermissionRequested = true;
    try { await Notification.requestPermission(); } catch (_) {}
  }

  if (Notification.permission === 'granted') {
    try {
      new Notification('TubeDL', {
        body: `Download complete: ${title}`,
        icon: '/icons/icon.svg',
      });
    } catch (_) {}
  }
}

// ── Toast ──────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(msg)}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut .3s ease forwards';
    el.addEventListener('animationend', () => el.remove());
  }, 3500);
}

// ── Spinner / State ────────────────────────────────────────
function showSpinner(show) { spinnerWrap.hidden = !show; }
function showState(icon, msg) {
  stateIcon.textContent = icon;
  stateMsg.textContent = msg;
  stateBox.hidden = false;
}
function hideState() { stateBox.hidden = true; }

// ── Load more ──────────────────────────────────────────────
$('loadMoreBtn').addEventListener('click', loadMore);

// ── PWA ────────────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.deferredPrompt = e;
  installBanner.hidden = false;
});

installBtn.addEventListener('click', async () => {
  if (!state.deferredPrompt) return;
  state.deferredPrompt.prompt();
  const { outcome } = await state.deferredPrompt.userChoice;
  if (outcome === 'accepted') installBanner.hidden = true;
  state.deferredPrompt = null;
});

installDismiss.addEventListener('click', () => {
  installBanner.hidden = true;
});

// ── Service Worker ─────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Init ───────────────────────────────────────────────────
connectWS();
renderQueue();
searchInput.focus();
