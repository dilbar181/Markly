/* ══════════════════════════════════════════════════════════════════
   MARKLY — script.js
   Bookmark Manager | Pure Vanilla JS
   Features: CRUD, Search, Filter, Sort, Dark Mode, Import/Export,
             Drag & Drop, Keyboard Shortcuts, Favicon, Toast, LocalStorage
══════════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────
   1. STATE & STORAGE
───────────────────────────────────────── */

/** @type {{ id:string, title:string, url:string, tags:string[], notes:string, created_at:number }[]} */
let bookmarks = [];
let activeCategory = 'all';   // 'all' or a tag string
let currentView    = 'grid';  // 'grid' | 'list'
let sortMode       = 'newest';
let searchQuery    = '';
let editingId      = null;    // null = add mode, string = edit mode
let pendingDeleteId = null;
let tempTags       = [];      // tags in the modal form
let dragSrcIdx     = null;    // drag-and-drop source index

const STORAGE_KEY = 'markly_bookmarks_v2';
const PREF_KEY    = 'markly_prefs';

/** Load bookmarks from localStorage */
function loadBookmarks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    bookmarks = raw ? JSON.parse(raw) : [];
  } catch (e) {
    bookmarks = [];
  }
}

/** Persist bookmarks to localStorage */
function saveBookmarks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

/** Load UI preferences (theme, view, sort) */
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.theme)    document.documentElement.setAttribute('data-theme', p.theme);
    if (p.view)     setView(p.view, false);
    if (p.sort)     { sortMode = p.sort; dom.sortSelect.value = p.sort; }
  } catch (e) {}
}

/** Save UI preferences */
function savePrefs() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  localStorage.setItem(PREF_KEY, JSON.stringify({ theme, view: currentView, sort: sortMode }));
}

/* ─────────────────────────────────────────
   2. DOM ELEMENT REFERENCES
───────────────────────────────────────── */
const dom = {
  grid:             document.getElementById('bookmark-grid'),
  emptyState:       document.getElementById('empty-state'),
  emptyTitle:       document.getElementById('empty-title'),
  emptyDesc:        document.getElementById('empty-desc'),
  sidebarCategories:document.getElementById('sidebar-categories'),
  sidebarTags:      document.getElementById('sidebar-tags'),
  countAll:         document.getElementById('count-all'),
  pageTitle:        document.getElementById('page-title'),
  searchInput:      document.getElementById('search-input'),
  searchClear:      document.getElementById('search-clear'),
  sortSelect:       document.getElementById('sort-select'),
  viewGrid:         document.getElementById('view-grid'),
  viewList:         document.getElementById('view-list'),
  btnOpenModal:     document.getElementById('btn-open-modal'),
  btnEmptyAdd:      document.getElementById('btn-empty-add'),
  btnExport:        document.getElementById('btn-export'),
  btnImport:        document.getElementById('btn-import'),
  importFileInput:  document.getElementById('import-file-input'),
  btnTheme:         document.getElementById('btn-theme'),
  sidebarToggle:    document.getElementById('sidebar-toggle'),
  sidebar:          document.getElementById('sidebar'),
  // Modal
  modalOverlay:     document.getElementById('modal-overlay'),
  modalTitle:       document.getElementById('modal-title'),
  modalClose:       document.getElementById('modal-close'),
  btnCancel:        document.getElementById('btn-cancel'),
  btnSave:          document.getElementById('btn-save'),
  inputTitle:       document.getElementById('input-title'),
  inputUrl:         document.getElementById('input-url'),
  inputTags:        document.getElementById('input-tags'),
  tagChips:         document.getElementById('tag-chips'),
  inputNotes:       document.getElementById('input-notes'),
  // Confirm modal
  confirmOverlay:   document.getElementById('confirm-overlay'),
  confirmCancel:    document.getElementById('confirm-cancel'),
  confirmDelete:    document.getElementById('confirm-delete'),
  confirmName:      document.getElementById('confirm-bookmark-name'),
};

/* ─────────────────────────────────────────
   3. UTILITY HELPERS
───────────────────────────────────────── */

/** Generate a compact unique ID */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Format a timestamp into a readable date */
function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)   return 'Baru saja';
  if (diff < 3600) return `${Math.floor(diff/60)} menit lalu`;
  if (diff < 86400)return `${Math.floor(diff/3600)} jam lalu`;
  if (diff < 604800)return `${Math.floor(diff/86400)} hari lalu`;
  return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
}

/** Extract hostname from a URL string */
function getHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

/** Get favicon URL via Google's public service */
function getFaviconUrl(url) {
  try {
    const origin = new URL(url).origin;
    return `https://www.google.com/s2/favicons?domain=${origin}&sz=32`;
  } catch { return null; }
}

/** Escape HTML to safely insert user content */
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/** Wrap matched query in <mark> for search highlight */
function highlight(text, query) {
  if (!query) return escHtml(text);
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return escHtml(text).replace(re, '<mark>$1</mark>');
}

/** Collect all unique tags from bookmarks */
function allTags() {
  const set = new Set();
  bookmarks.forEach(b => b.tags.forEach(t => set.add(t)));
  return [...set].sort((a,b) => a.localeCompare(b));
}

/** Tag color palette (deterministic) */
const TAG_COLORS = ['#6c8cff','#ff7eb3','#4fd69c','#f5a623','#a78bfa','#38bdf8','#fb923c','#34d399'];
function tagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash + tag.charCodeAt(i)) % TAG_COLORS.length;
  return TAG_COLORS[hash];
}

/* ─────────────────────────────────────────
   4. FILTER, SORT & SEARCH
───────────────────────────────────────── */

/** Return filtered + sorted bookmarks based on current state */
function getFilteredBookmarks() {
  let list = [...bookmarks];

  // Filter by category/tag
  if (activeCategory !== 'all') {
    list = list.filter(b => b.tags.includes(activeCategory));
  }

  // Search
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    list = list.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q) ||
      (b.notes || '').toLowerCase().includes(q) ||
      b.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  // Sort
  switch (sortMode) {
    case 'newest':  list.sort((a,b) => b.created_at - a.created_at); break;
    case 'oldest':  list.sort((a,b) => a.created_at - b.created_at); break;
    case 'az':      list.sort((a,b) => a.title.localeCompare(b.title)); break;
    case 'za':      list.sort((a,b) => b.title.localeCompare(a.title)); break;
  }

  return list;
}

/* ─────────────────────────────────────────
   5. RENDER
───────────────────────────────────────── */

/** Main render: sidebar + grid */
function render() {
  renderSidebar();
  renderGrid();
}

/** Render sidebar categories and tags */
function renderSidebar() {
  const tags = allTags();
  dom.countAll.textContent = bookmarks.length;

  // Update "Semua" active state
  const allItem = dom.sidebarCategories.querySelector('[data-category="all"]');
  if (allItem) allItem.classList.toggle('active', activeCategory === 'all');

  // Render tag list
  dom.sidebarTags.innerHTML = tags.map(tag => {
    const count = bookmarks.filter(b => b.tags.includes(tag)).length;
    const color = tagColor(tag);
    const active = activeCategory === tag;
    return `
      <li class="nav-item ${active ? 'active' : ''}" data-category="${escHtml(tag)}" role="button" tabindex="0">
        <span class="tag-dot" style="background:${color}"></span>
        <span class="nav-text">${escHtml(tag)}</span>
        <span class="nav-count">${count}</span>
      </li>`;
  }).join('');

  // Bind tag click events
  dom.sidebarTags.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => selectCategory(el.dataset.category));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') selectCategory(el.dataset.category); });
  });
}

/** Render the bookmark grid */
function renderGrid() {
  const list = getFilteredBookmarks();
  const q = searchQuery.trim();

  if (list.length === 0) {
    dom.grid.innerHTML = '';
    dom.emptyState.classList.remove('hidden');
    if (q || activeCategory !== 'all') {
      dom.emptyTitle.textContent = 'Tidak ada hasil';
      dom.emptyDesc.textContent  = 'Coba ubah kata kunci atau pilih kategori lain.';
    } else {
      dom.emptyTitle.textContent = 'Belum ada bookmark';
      dom.emptyDesc.textContent  = 'Klik tombol "Tambah Bookmark" untuk menyimpan link pertamamu.';
    }
    return;
  }

  dom.emptyState.classList.add('hidden');

  dom.grid.innerHTML = list.map((b, idx) => {
    const faviconUrl = getFaviconUrl(b.url);
    const host = getHost(b.url);
    const initials = (b.title || '?').slice(0,2).toUpperCase();
    const tags = b.tags.map(t =>
      `<span class="tag-chip" data-tag="${escHtml(t)}" style="--dot:${tagColor(t)}">${escHtml(t)}</span>`
    ).join('');

    return `
    <div class="bookmark-card" data-id="${b.id}" draggable="true" data-idx="${idx}">
      <div class="card-header">
        <div class="card-favicon" id="favicon-${b.id}">
          ${faviconUrl
            ? `<img src="${faviconUrl}" alt="" onerror="this.parentElement.textContent='${initials}'" />`
            : initials}
        </div>
        <div class="card-meta">
          <div class="card-title" title="${escHtml(b.title)}">${highlight(b.title, q)}</div>
          <div class="card-url">${highlight(host, q)}</div>
        </div>
        <div class="card-actions">
          <button class="card-btn edit-btn" data-id="${b.id}" title="Edit" aria-label="Edit bookmark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="card-btn delete btn-delete" data-id="${b.id}" title="Hapus" aria-label="Hapus bookmark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
      ${b.notes ? `<div class="card-body"><p class="card-notes">${highlight(escHtml(b.notes), q)}</p></div>` : ''}
      <div class="card-footer">
        <div class="card-tags">${tags}</div>
        <span class="card-date">${fmtDate(b.created_at)}</span>
      </div>
      <a class="card-link" href="${escHtml(b.url)}" target="_blank" rel="noopener noreferrer">
        Buka link
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>
    </div>`;
  }).join('');

  // Bind card events
  dom.grid.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.id); });
  });
  dom.grid.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openConfirm(btn.dataset.id); });
  });
  dom.grid.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', e => { e.stopPropagation(); selectCategory(chip.dataset.tag); });
  });

  // Drag & drop bindings
  initDragDrop();
}

/* ─────────────────────────────────────────
   6. CATEGORY NAVIGATION
───────────────────────────────────────── */

function selectCategory(cat) {
  activeCategory = cat;
  dom.pageTitle.textContent = cat === 'all' ? 'Semua Bookmark' : `#${cat}`;
  // Update sidebar active
  dom.sidebarCategories.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.category === cat));
  dom.sidebarTags.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.category === cat));
  renderGrid();
}

/* ─────────────────────────────────────────
   7. MODAL: ADD / EDIT
───────────────────────────────────────── */

function openAddModal() {
  editingId = null;
  tempTags  = [];
  dom.modalTitle.textContent = 'Tambah Bookmark';
  dom.inputTitle.value  = '';
  dom.inputUrl.value    = '';
  dom.inputNotes.value  = '';
  dom.inputTags.value   = '';
  renderTagPills();
  dom.modalOverlay.classList.remove('hidden');
  dom.inputTitle.focus();
  dom.inputTitle.classList.remove('error');
  dom.inputUrl.classList.remove('error');
}

function openEditModal(id) {
  const b = bookmarks.find(b => b.id === id);
  if (!b) return;
  editingId = id;
  tempTags  = [...b.tags];
  dom.modalTitle.textContent = 'Edit Bookmark';
  dom.inputTitle.value  = b.title;
  dom.inputUrl.value    = b.url;
  dom.inputNotes.value  = b.notes || '';
  dom.inputTags.value   = '';
  renderTagPills();
  dom.modalOverlay.classList.remove('hidden');
  dom.inputTitle.focus();
  dom.inputTitle.classList.remove('error');
  dom.inputUrl.classList.remove('error');
}

function closeModal() {
  dom.modalOverlay.classList.add('hidden');
  editingId = null;
  tempTags  = [];
}

/** Save bookmark (add or edit) */
function saveBookmark() {
  const title = dom.inputTitle.value.trim();
  const url   = dom.inputUrl.value.trim();
  let valid   = true;

  dom.inputTitle.classList.remove('error');
  dom.inputUrl.classList.remove('error');

  if (!title) { dom.inputTitle.classList.add('error'); dom.inputTitle.focus(); valid = false; }
  if (!url || !isValidUrl(url)) {
    dom.inputUrl.classList.add('error');
    if (valid) dom.inputUrl.focus();
    valid = false;
    if (!url) {
      showToast('URL tidak boleh kosong', 'error');
    } else {
      showToast('Format URL tidak valid', 'error');
    }
  }
  if (!valid) return;

  if (editingId) {
    // Edit
    const idx = bookmarks.findIndex(b => b.id === editingId);
    if (idx !== -1) {
      bookmarks[idx] = { ...bookmarks[idx], title, url, tags: tempTags, notes: dom.inputNotes.value.trim() };
    }
    showToast('Bookmark diperbarui ✓', 'success');
  } else {
    // Add
    const newBookmark = {
      id: uid(),
      title,
      url,
      tags: tempTags,
      notes: dom.inputNotes.value.trim(),
      created_at: Date.now(),
    };
    bookmarks.unshift(newBookmark);
    showToast('Bookmark ditambahkan ✓', 'success');
  }

  saveBookmarks();
  closeModal();
  render();
}

function isValidUrl(str) {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

/* ─────────────────────────────────────────
   8. TAG MANAGEMENT IN MODAL
───────────────────────────────────────── */

/** Render tag pills inside the modal tag input */
function renderTagPills() {
  const existing = dom.tagChips.querySelectorAll('.tag-pill');
  existing.forEach(el => el.remove());

  tempTags.forEach(tag => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${escHtml(tag)}<button class="tag-pill-remove" aria-label="Hapus tag ${escHtml(tag)}">×</button>`;
    pill.querySelector('.tag-pill-remove').addEventListener('click', () => {
      tempTags = tempTags.filter(t => t !== tag);
      renderTagPills();
    });
    dom.tagChips.appendChild(pill);
  });
}

/** Add a tag from the input field */
function addTag(raw) {
  const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
  if (!tag || tempTags.includes(tag) || tempTags.length >= 8) return;
  tempTags.push(tag);
  dom.inputTags.value = '';
  renderTagPills();
}

/* ─────────────────────────────────────────
   9. DELETE
───────────────────────────────────────── */

function openConfirm(id) {
  const b = bookmarks.find(b => b.id === id);
  if (!b) return;
  pendingDeleteId = id;
  dom.confirmName.textContent = `"${b.title}"`;
  dom.confirmOverlay.classList.remove('hidden');
}

function closeConfirm() {
  dom.confirmOverlay.classList.add('hidden');
  pendingDeleteId = null;
}

function deleteBookmark() {
  if (!pendingDeleteId) return;
  bookmarks = bookmarks.filter(b => b.id !== pendingDeleteId);
  saveBookmarks();
  closeConfirm();
  // If active category now empty, reset to all
  if (activeCategory !== 'all' && !bookmarks.some(b => b.tags.includes(activeCategory))) {
    selectCategory('all');
  }
  render();
  showToast('Bookmark dihapus', 'info');
}

/* ─────────────────────────────────────────
   10. DARK MODE TOGGLE
───────────────────────────────────────── */

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  savePrefs();
}

/* ─────────────────────────────────────────
   11. VIEW TOGGLE
───────────────────────────────────────── */

function setView(v, save = true) {
  currentView = v;
  dom.grid.classList.toggle('view-list', v === 'list');
  dom.viewGrid.classList.toggle('active', v === 'grid');
  dom.viewGrid.setAttribute('aria-pressed', String(v === 'grid'));
  dom.viewList.classList.toggle('active', v === 'list');
  dom.viewList.setAttribute('aria-pressed', String(v === 'list'));
  if (save) savePrefs();
}

/* ─────────────────────────────────────────
   12. IMPORT / EXPORT
───────────────────────────────────────── */

function exportBookmarks() {
  const data = JSON.stringify(bookmarks, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `markly-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`${bookmarks.length} bookmark diekspor`, 'success');
}

function importBookmarks(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('Format tidak valid');
      // Validate & sanitize
      const valid = data.filter(b => b.id && b.title && b.url);
      // Merge (avoid duplicates by id)
      const existingIds = new Set(bookmarks.map(b => b.id));
      const newOnes = valid.filter(b => !existingIds.has(b.id));
      bookmarks = [...bookmarks, ...newOnes];
      saveBookmarks();
      render();
      showToast(`${newOnes.length} bookmark diimpor`, 'success');
    } catch (err) {
      showToast('Gagal import: format tidak valid', 'error');
    }
  };
  reader.readAsText(file);
  // Reset input
  dom.importFileInput.value = '';
}

/* ─────────────────────────────────────────
   13. DRAG & DROP (reorder in grid view)
───────────────────────────────────────── */

function initDragDrop() {
  const cards = dom.grid.querySelectorAll('.bookmark-card');
  cards.forEach(card => {
    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragover',  onDragOver);
    card.addEventListener('dragleave', onDragLeave);
    card.addEventListener('drop',      onDrop);
    card.addEventListener('dragend',   onDragEnd);
  });
}

function onDragStart(e) {
  dragSrcIdx = parseInt(this.dataset.idx, 10);
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.classList.add('drag-over');
}

function onDragLeave() {
  this.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  const destIdx = parseInt(this.dataset.idx, 10);
  if (dragSrcIdx === null || dragSrcIdx === destIdx) return;

  const filtered = getFilteredBookmarks();
  const srcId    = filtered[dragSrcIdx]?.id;
  const destId   = filtered[destIdx]?.id;

  if (!srcId || !destId) return;

  // Reorder in main bookmarks array
  const srcGlobal  = bookmarks.findIndex(b => b.id === srcId);
  const destGlobal = bookmarks.findIndex(b => b.id === destId);
  const [moved] = bookmarks.splice(srcGlobal, 1);
  bookmarks.splice(destGlobal, 0, moved);

  saveBookmarks();
  renderGrid();
}

function onDragEnd() {
  dom.grid.querySelectorAll('.bookmark-card').forEach(c => {
    c.classList.remove('dragging', 'drag-over');
  });
  dragSrcIdx = null;
}

/* ─────────────────────────────────────────
   14. TOAST NOTIFICATIONS
───────────────────────────────────────── */

/**
 * Show a toast message
 * @param {string} msg
 * @param {'success'|'error'|'info'} type
 */
function showToast(msg, type = 'info') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const container = document.getElementById('toast-container');

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('exit');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  setTimeout(remove, 2800);
}

/* ─────────────────────────────────────────
   15. SIDEBAR RESPONSIVE TOGGLE
───────────────────────────────────────── */

function toggleSidebar() {
  dom.sidebar.classList.toggle('open');
}

/* ─────────────────────────────────────────
   16. EVENT LISTENERS
───────────────────────────────────────── */

function attachEvents() {
  // ── Modal open/close ──
  dom.btnOpenModal.addEventListener('click', openAddModal);
  dom.btnEmptyAdd.addEventListener('click', openAddModal);
  dom.modalClose.addEventListener('click', closeModal);
  dom.btnCancel.addEventListener('click', closeModal);
  dom.modalOverlay.addEventListener('click', e => { if (e.target === dom.modalOverlay) closeModal(); });

  // ── Save ──
  dom.btnSave.addEventListener('click', saveBookmark);

  // ── Tag input ──
  dom.inputTags.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(dom.inputTags.value);
    }
    if (e.key === 'Backspace' && dom.inputTags.value === '' && tempTags.length > 0) {
      tempTags.pop();
      renderTagPills();
    }
  });
  dom.inputTags.addEventListener('blur', () => {
    if (dom.inputTags.value.trim()) addTag(dom.inputTags.value);
  });

  // ── Search ──
  dom.searchInput.addEventListener('input', () => {
    searchQuery = dom.searchInput.value;
    dom.searchClear.classList.toggle('hidden', !searchQuery);
    renderGrid();
  });
  dom.searchClear.addEventListener('click', () => {
    searchQuery = '';
    dom.searchInput.value = '';
    dom.searchClear.classList.add('hidden');
    dom.searchInput.focus();
    renderGrid();
  });

  // ── Sort ──
  dom.sortSelect.addEventListener('change', () => {
    sortMode = dom.sortSelect.value;
    savePrefs();
    renderGrid();
  });

  // ── View toggle ──
  dom.viewGrid.addEventListener('click', () => setView('grid'));
  dom.viewList.addEventListener('click', () => setView('list'));

  // ── Theme ──
  dom.btnTheme.addEventListener('click', toggleTheme);

  // ── Sidebar categories (Semua) ──
  dom.sidebarCategories.querySelector('[data-category="all"]').addEventListener('click', () => selectCategory('all'));

  // ── Sidebar toggle (mobile) ──
  dom.sidebarToggle.addEventListener('click', toggleSidebar);
  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', e => {
    if (window.innerWidth <= 768 &&
        dom.sidebar.classList.contains('open') &&
        !dom.sidebar.contains(e.target) &&
        e.target !== dom.sidebarToggle) {
      dom.sidebar.classList.remove('open');
    }
  });

  // ── Export / Import ──
  dom.btnExport.addEventListener('click', exportBookmarks);
  dom.btnImport.addEventListener('click', () => dom.importFileInput.click());
  dom.importFileInput.addEventListener('change', e => importBookmarks(e.target.files[0]));

  // ── Confirm delete ──
  dom.confirmCancel.addEventListener('click', closeConfirm);
  dom.confirmDelete.addEventListener('click', deleteBookmark);
  dom.confirmOverlay.addEventListener('click', e => { if (e.target === dom.confirmOverlay) closeConfirm(); });

  // ── Enter to save in modal ──
  [dom.inputTitle, dom.inputUrl, dom.inputNotes].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveBookmark(); } });
  });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    // Ctrl+B → Add bookmark
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      openAddModal();
    }
    // Ctrl+K → Focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      dom.searchInput.focus();
      dom.searchInput.select();
    }
    // Esc → Close modal
    if (e.key === 'Escape') {
      if (!dom.modalOverlay.classList.contains('hidden')) closeModal();
      if (!dom.confirmOverlay.classList.contains('hidden')) closeConfirm();
    }
  });
}

/* ─────────────────────────────────────────
   17. SEED DATA (first run only)
───────────────────────────────────────── */

function seedData() {
  if (bookmarks.length > 0) return; // Don't seed if data exists

  bookmarks = [
    {
      id: uid(),
      title: 'MDN Web Docs',
      url: 'https://developer.mozilla.org',
      tags: ['dev', 'docs'],
      notes: 'Referensi lengkap untuk HTML, CSS, dan JavaScript.',
      created_at: Date.now() - 86400000 * 3,
    },
    {
      id: uid(),
      title: 'Figma',
      url: 'https://figma.com',
      tags: ['design', 'tools'],
      notes: 'Tool desain UI/UX kolaboratif berbasis browser.',
      created_at: Date.now() - 86400000 * 2,
    },
    {
      id: uid(),
      title: 'GitHub',
      url: 'https://github.com',
      tags: ['dev', 'tools'],
      notes: 'Platform hosting kode dan kolaborasi pengembang.',
      created_at: Date.now() - 86400000,
    },
    {
      id: uid(),
      title: 'CSS-Tricks',
      url: 'https://css-tricks.com',
      tags: ['dev', 'css'],
      notes: 'Artikel dan tutorial tentang CSS modern.',
      created_at: Date.now() - 3600000 * 5,
    },
    {
      id: uid(),
      title: 'Dribbble',
      url: 'https://dribbble.com',
      tags: ['design', 'inspiration'],
      notes: 'Portofolio dan inspirasi desain dari seluruh dunia.',
      created_at: Date.now() - 3600000 * 2,
    },
    {
      id: uid(),
      title: 'Vercel',
      url: 'https://vercel.com',
      tags: ['dev', 'hosting'],
      notes: 'Platform deploy frontend yang cepat dan mudah.',
      created_at: Date.now() - 1800000,
    },
  ];
  saveBookmarks();
}

/* ─────────────────────────────────────────
   18. INIT
───────────────────────────────────────── */

function init() {
  loadBookmarks();
  seedData();         // Populate demo data on first run
  loadPrefs();
  attachEvents();
  render();
}

// Bootstrap the app
document.addEventListener('DOMContentLoaded', init);

