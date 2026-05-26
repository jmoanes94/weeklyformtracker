import { useState, useEffect, useMemo } from "react";

const HISTORY_KEY = "wp-form-test-history";
const WEBSITES_KEY = "wp-form-test-websites";

const MENU_ITEMS = [
  { id: "websites", label: "Websites" },
  { id: "logTest", label: "Log Test" },
  { id: "history", label: "History" },
];

const PAGE_SIZE_WEBSITES = 8;
const PAGE_SIZE_HISTORY = 10;

const STATUS_OPTIONS = [
  {
    value: "Working",
    label: "Working",
    badge: "badge-status-working",
    stat: "app-stat--working",
    mini: "status-mini--working",
  },
  {
    value: "Broken",
    label: "Broken",
    badge: "badge-status-broken",
    stat: "app-stat--broken",
    mini: "status-mini--broken",
  },
  {
    value: "Partial",
    label: "Partial",
    badge: "badge-status-partial",
    stat: "app-stat--partial",
    mini: "status-mini--partial",
  },
];

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeeklyTestForSite(entries, websiteId, excludeEntryId = null) {
  return entries.find(
    (e) =>
      e.websiteId === websiteId &&
      isInCurrentWeek(e.date) &&
      e.id !== excludeEntryId
  );
}

function weekStartISO() {
  const now = new Date();
  const day = now.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMonday);
  return monday.toISOString().slice(0, 10);
}

function isInCurrentWeek(isoDate) {
  return isoDate >= weekStartISO() && isoDate <= todayISO();
}

function countByStatus(entries) {
  return STATUS_OPTIONS.reduce((acc, opt) => {
    acc[opt.value] = entries.filter((e) => e.status === opt.value).length;
    return acc;
  }, {});
}

function computeStats(websites, entries) {
  const totalWebsites = websites.length;
  const weekEntries = entries.filter((e) => isInCurrentWeek(e.date));
  const testedSiteIds = new Set(weekEntries.map((e) => e.websiteId));
  const formsTested = websites.filter((w) => testedSiteIds.has(w.id)).length;
  const notFinishedYet = Math.max(0, totalWebsites - formsTested);

  return {
    totalWebsites,
    formsTested,
    notFinishedYet,
    totalTestsLogged: entries.length,
    testsThisWeek: weekEntries.length,
    testedSiteIds,
    statusCountsWeek: countByStatus(weekEntries),
    statusCountsAll: countByStatus(entries),
  };
}

function formatDisplayDate(isoDate) {
  const [y, m, d] = isoDate.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveHistory(entries) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
}

function saveWebsites(websites) {
  localStorage.setItem(WEBSITES_KEY, JSON.stringify(websites));
}

function statusStyle(status) {
  return STATUS_OPTIONS.find((o) => o.value === status)?.badge ?? "badge-muted";
}

function normalizeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function nameFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0] || url;
  }
}

function siteDisplay(site) {
  if (!site) return "Unknown site";
  if (site.url) return site.url.replace(/^https?:\/\//i, "");
  return site.name;
}

function matchesWebsiteSearch(site, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    site.name.toLowerCase().includes(q) ||
    (site.url ?? "").toLowerCase().includes(q)
  );
}

function countWeekTestsForSite(entries, websiteId) {
  return entries.filter(
    (e) => e.websiteId === websiteId && isInCurrentWeek(e.date)
  ).length;
}

function paginateItems(items, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    totalPages,
    items: items.slice(start, start + pageSize),
    startIndex: items.length === 0 ? 0 : start + 1,
    endIndex: Math.min(start + pageSize, items.length),
  };
}

function Pagination({ page, totalPages, onPageChange, totalItems, pageSize, itemLabel }) {
  if (totalItems === 0 || totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <nav aria-label="Pagination" className="pagination">
      <p className="pagination__info">
        Showing {start}–{end} of {totalItems} {itemLabel}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="btn-secondary btn-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <span className="min-w-[5.5rem] text-center text-sm font-medium text-stone-600">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="btn-secondary btn-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </nav>
  );
}

function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  variant = "danger",
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  const isWarning = variant === "warning";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-message"
    >
      <button
        type="button"
        className="modal-backdrop fixed inset-0"
        onClick={onCancel}
        aria-label="Close dialog"
      />
      <div className="modal-panel">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
            isWarning ? "bg-amber-100" : "bg-red-100"
          }`}
        >
          <svg
            className={`h-5 w-5 ${isWarning ? "text-amber-600" : "text-red-600"}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden="true"
          >
            {isWarning ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            )}
          </svg>
        </div>
        <h3 id="confirm-modal-title" className="mt-5 text-xl font-semibold text-stone-900">
          {title}
        </h3>
        <p id="confirm-modal-message" className="mt-2 text-sm leading-relaxed text-stone-600">
          {message}
        </p>
        <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={isWarning ? "btn-warning" : "btn-danger"}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function exportCSV(entries, websitesById) {
  const header = ["Date", "Website", "URL", "Form Status"];
  const rows = entries.map((e) => {
    const site = websitesById[e.websiteId];
    return [e.date, siteDisplay(site), site?.url ?? "", e.status];
  });
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${cell}"`).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `wp-form-tests-${todayISO()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [entries, setEntries] = useState(() => loadJSON(HISTORY_KEY, []));
  const [websites, setWebsites] = useState(() => loadJSON(WEBSITES_KEY, []));

  const [date, setDate] = useState(todayISO);
  const [websiteId, setWebsiteId] = useState("");
  const [status, setStatus] = useState("Working");
  const [formError, setFormError] = useState("");

  const [newSiteUrl, setNewSiteUrl] = useState("");
  const [siteError, setSiteError] = useState("");
  const [showAddWebsiteForm, setShowAddWebsiteForm] = useState(
    () => loadJSON(WEBSITES_KEY, []).length === 0
  );
  const [activeMenu, setActiveMenu] = useState("websites");
  const [showLogTestForm, setShowLogTestForm] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [toast, setToast] = useState(null);

  const [filterWebsiteId, setFilterWebsiteId] = useState("all");
  const [websiteSearch, setWebsiteSearch] = useState("");
  const [websitesPage, setWebsitesPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyWeekFilter, setHistoryWeekFilter] = useState("all");

  useEffect(() => {
    saveHistory(entries);
  }, [entries]);

  useEffect(() => {
    saveWebsites(websites);
  }, [websites]);

  useEffect(() => {
    if (!deleteModal) return;
    function onKeyDown(e) {
      if (e.key === "Escape") setDeleteModal(null);
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [deleteModal]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Keep form website select in sync when sites are added
  useEffect(() => {
    if (websites.length === 0) {
      setWebsiteId("");
      return;
    }
    if (!websiteId || !websites.some((w) => w.id === websiteId)) {
      setWebsiteId(websites[0].id);
    }
  }, [websites, websiteId]);

  const websitesById = useMemo(
    () => Object.fromEntries(websites.map((w) => [w.id, w])),
    [websites]
  );

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const dateCmp = b.date.localeCompare(a.date);
        if (dateCmp !== 0) return dateCmp;
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      }),
    [entries]
  );

  const searchQuery = websiteSearch.trim();

  const filteredWebsites = useMemo(
    () => websites.filter((w) => matchesWebsiteSearch(w, websiteSearch)),
    [websites, websiteSearch]
  );

  useEffect(() => {
    if (filterWebsiteId === "all" || !searchQuery) return;
    if (!filteredWebsites.some((w) => w.id === filterWebsiteId)) {
      setFilterWebsiteId("all");
    }
  }, [filterWebsiteId, searchQuery, filteredWebsites]);

  useEffect(() => {
    setWebsitesPage(1);
  }, [websiteSearch]);

  useEffect(() => {
    setHistoryPage(1);
  }, [filterWebsiteId, websiteSearch, historyWeekFilter]);

  // Keep selected site visible in the log form even when search narrows the list
  const websitesForSelect = useMemo(() => {
    if (!websiteId) return filteredWebsites;
    const selected = websites.find((w) => w.id === websiteId);
    if (!selected || filteredWebsites.some((w) => w.id === websiteId)) {
      return filteredWebsites;
    }
    return [selected, ...filteredWebsites];
  }, [websites, filteredWebsites, websiteId]);

  const stats = useMemo(
    () => computeStats(websites, entries),
    [websites, entries]
  );

  const weeklyDuplicateForForm = useMemo(
    () =>
      websiteId
        ? getWeeklyTestForSite(entries, websiteId, editingEntryId)
        : null,
    [entries, websiteId, editingEntryId]
  );

  const filteredEntries = useMemo(() => {
    let result = sortedEntries;
    if (historyWeekFilter === "week") {
      result = result.filter((e) => isInCurrentWeek(e.date));
    }
    if (filterWebsiteId !== "all") {
      result = result.filter((e) => e.websiteId === filterWebsiteId);
    }
    if (searchQuery) {
      result = result.filter((e) => {
        const site = websitesById[e.websiteId];
        return site ? matchesWebsiteSearch(site, websiteSearch) : false;
      });
    }
    return result;
  }, [
    sortedEntries,
    historyWeekFilter,
    filterWebsiteId,
    websiteSearch,
    searchQuery,
    websitesById,
  ]);

  const websitesPagination = useMemo(
    () => paginateItems(filteredWebsites, websitesPage, PAGE_SIZE_WEBSITES),
    [filteredWebsites, websitesPage]
  );

  const historyPagination = useMemo(
    () => paginateItems(filteredEntries, historyPage, PAGE_SIZE_HISTORY),
    [filteredEntries, historyPage]
  );

  const historyStatusCounts = useMemo(
    () => countByStatus(filteredEntries),
    [filteredEntries]
  );

  useEffect(() => {
    if (websitesPage !== websitesPagination.page) {
      setWebsitesPage(websitesPagination.page);
    }
  }, [websitesPage, websitesPagination.page]);

  useEffect(() => {
    if (historyPage !== historyPagination.page) {
      setHistoryPage(historyPagination.page);
    }
  }, [historyPage, historyPagination.page]);

  function handleAddWebsite(e) {
    e.preventDefault();
    setSiteError("");

    const urlInput = newSiteUrl.trim();
    if (!urlInput) {
      setSiteError("Website URL is required.");
      return;
    }

    const url = normalizeUrl(urlInput);
    const duplicate = websites.some(
      (w) => w.url && normalizeUrl(w.url).toLowerCase() === url.toLowerCase()
    );
    if (duplicate) {
      setSiteError("This website URL is already in your list.");
      return;
    }

    const site = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      name: nameFromUrl(url),
      url,
      createdAt: Date.now(),
    };

    setWebsites((prev) => [...prev, site]);
    setWebsiteId(site.id);
    setNewSiteUrl("");
    setShowAddWebsiteForm(false);
  }

  function closeAddWebsiteForm() {
    setShowAddWebsiteForm(false);
    setNewSiteUrl("");
    setSiteError("");
  }

  function requestRemoveWebsite(id) {
    const linkedCount = entries.filter((e) => e.websiteId === id).length;
    const site = websitesById[id];
    const message =
      linkedCount > 0
        ? `"${siteDisplay(site)}" will be removed from your list. ${linkedCount} existing test ${linkedCount === 1 ? "entry" : "entries"} will remain but appear under an unknown site.`
        : `"${siteDisplay(site)}" will be removed from your website list.`;

    setDeleteModal({
      type: "website",
      id,
      title: "Remove website?",
      message,
      confirmLabel: "Remove website",
    });
  }

  function confirmRemoveWebsite(id) {
    setWebsites((prev) => prev.filter((w) => w.id !== id));
    if (filterWebsiteId === id) setFilterWebsiteId("all");
    if (websiteId === id && websites.length > 1) {
      const remaining = websites.filter((w) => w.id !== id);
      setWebsiteId(remaining[0]?.id ?? "");
    }
  }

  function resetLogFormAfterSave() {
    setStatus("Working");
    setDate(todayISO());
    setShowLogTestForm(false);
    setEditingEntryId(null);
    setFormError("");
    setActiveMenu("history");
  }

  function performSaveEntry() {
    if (editingEntryId) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === editingEntryId ? { ...e, websiteId, date, status } : e
        )
      );
      setToast("Test entry updated.");
    } else {
      const entry = {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        websiteId,
        date,
        status,
        createdAt: Date.now(),
      };
      setEntries((prev) => [entry, ...prev]);
      setToast("Test entry saved.");
    }
    resetLogFormAfterSave();
  }

  function openLogTestForSite(siteId) {
    setEditingEntryId(null);
    setWebsiteId(siteId);
    setDate(todayISO());
    setStatus("Working");
    setFormError("");
    setActiveMenu("logTest");
    setShowLogTestForm(true);
  }

  function startEditEntry(id) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setEditingEntryId(id);
    setWebsiteId(entry.websiteId);
    setDate(entry.date);
    setStatus(entry.status);
    setFormError("");
    setActiveMenu("logTest");
    setShowLogTestForm(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError("");

    if (websites.length === 0) {
      setFormError("Add at least one website before logging a test.");
      return;
    }
    if (!date) {
      setFormError("Date is required.");
      return;
    }
    if (!websiteId) {
      setFormError("Select which website you tested.");
      return;
    }

    const existingWeekly = getWeeklyTestForSite(entries, websiteId, editingEntryId);
    if (existingWeekly) {
      const site = websitesById[websiteId];
      setDeleteModal({
        type: "duplicate-test",
        title: "Already tested this week",
        message: `${siteDisplay(site)} already has a test logged on ${formatDisplayDate(existingWeekly.date)}. Do you want to ${editingEntryId ? "save anyway" : "log another entry"}?`,
        confirmLabel: editingEntryId ? "Save anyway" : "Log anyway",
        variant: "warning",
      });
      return;
    }

    performSaveEntry();
  }

  function closeLogTestForm() {
    setShowLogTestForm(false);
    setEditingEntryId(null);
    setFormError("");
  }

  function requestClearAll() {
    if (entries.length === 0) return;
    setDeleteModal({
      type: "clear-all",
      title: "Clear all test history?",
      message: `This will permanently delete all ${entries.length} test ${entries.length === 1 ? "entry" : "entries"}. This action cannot be undone.`,
      confirmLabel: "Clear all",
    });
  }

  function requestDeleteEntry(id) {
    const entry = entries.find((e) => e.id === id);
    const site = entry ? websitesById[entry.websiteId] : null;
    setDeleteModal({
      type: "entry",
      id,
      title: "Delete test entry?",
      message: entry
        ? `This will permanently remove the test for ${siteDisplay(site)} recorded on ${formatDisplayDate(entry.date)}.`
        : "This will permanently remove the selected test entry.",
      confirmLabel: "Delete entry",
    });
  }

  function closeDeleteModal() {
    setDeleteModal(null);
  }

  function confirmModalAction() {
    if (!deleteModal) return;

    if (deleteModal.type === "website") {
      confirmRemoveWebsite(deleteModal.id);
    } else if (deleteModal.type === "entry") {
      setEntries((prev) => prev.filter((e) => e.id !== deleteModal.id));
      setToast("Test entry deleted.");
    } else if (deleteModal.type === "clear-all") {
      setEntries([]);
      setToast("All test history cleared.");
    } else if (deleteModal.type === "duplicate-test") {
      performSaveEntry();
      closeDeleteModal();
      return;
    }

    closeDeleteModal();
  }

  return (
    <div className="app-shell">
      <div className="app-shell__gradient" aria-hidden="true" />
      <div className="app-shell__glow" aria-hidden="true" />

      <div className="relative z-10 mx-auto max-w-[1200px] px-4 py-10 sm:px-8 sm:py-14 lg:px-10">
        <header className="page-header">
          <div className="page-header__inner">
            <div>
              <p className="eyebrow">WordPress Quality Assurance</p>
              <h1 className="page-header__title">Weekly Form Test Tracker</h1>
              <p className="page-header__desc">
                Manage client websites, record weekly form checks, and review test history.
                All data stays in your browser and can be exported as CSV.
              </p>
            </div>
            <div className="page-header__meta">
              <span className="page-header__pill">
                Week of {formatDisplayDate(weekStartISO())}
              </span>
              <span className="page-header__pill">
                {websites.length} {websites.length === 1 ? "site" : "sites"}
              </span>
            </div>
          </div>
        </header>

        <nav aria-label="Main menu" className="nav-tabs">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveMenu(item.id);
                if (item.id !== "logTest") {
                  setShowLogTestForm(false);
                  setEditingEntryId(null);
                }
              }}
              className={`nav-tab ${activeMenu === item.id ? "nav-tab--active" : ""}`}
              aria-current={activeMenu === item.id ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {websites.length > 0 && activeMenu === "websites" && (
          <section aria-label="Weekly test summary" className="stat-grid">
            <div className="app-stat app-stat--default">
              <p className="app-stat__label">All websites</p>
              <p className="app-stat__value">{stats.totalWebsites}</p>
              <p className="app-stat__meta">In your registry</p>
            </div>
            <div className="app-stat app-stat--success">
              <p className="app-stat__label">Tested this week</p>
              <p className="app-stat__value">{stats.formsTested}</p>
              <p className="app-stat__meta">
                {stats.testsThisWeek} {stats.testsThisWeek === 1 ? "log" : "logs"} saved
              </p>
            </div>
            <div className="app-stat app-stat--warning">
              <p className="app-stat__label">Not finished yet</p>
              <p className="app-stat__value">{stats.notFinishedYet}</p>
              <p className="app-stat__meta">Sites still to test</p>
            </div>
            <div className="app-stat app-stat--accent">
              <p className="app-stat__label">All-time tests</p>
              <p className="app-stat__value">{stats.totalTestsLogged}</p>
              <p className="app-stat__meta">Total form checks</p>
            </div>
          </section>
        )}

        {websites.length > 0 && activeMenu === "websites" && entries.length > 0 && (
          <section aria-label="Form status counts" className="stat-grid-3">
            {STATUS_OPTIONS.map((opt) => (
              <div key={opt.value} className={`app-stat ${opt.stat}`}>
                <p className="app-stat__label">{opt.label}</p>
                <p className="app-stat__value">{stats.statusCountsWeek[opt.value]}</p>
                <p className="app-stat__meta">
                  This week · {stats.statusCountsAll[opt.value]} all-time
                </p>
              </div>
            ))}
          </section>
        )}

        {activeMenu === "websites" && (
        <section aria-labelledby="websites-heading" className="app-card p-6 sm:p-8">
          <div className="section-header">
            <div>
              <h2 id="websites-heading" className="section-title">
                Websites Under Test
              </h2>
              <p className="section-desc">
                Register each site URL before scheduling weekly form checks.
              </p>
            </div>
            {!showAddWebsiteForm && websites.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAddWebsiteForm(true)}
                className="btn-primary shrink-0"
              >
                Add website
              </button>
            )}
          </div>

          {websites.length > 0 && (
            <div className="mt-6">
              <label htmlFor="website-search">Search websites</label>
              <div className="relative">
                <input
                  id="website-search"
                  type="search"
                  value={websiteSearch}
                  onChange={(e) => setWebsiteSearch(e.target.value)}
                  placeholder="Search by URL…"
                  className="input-field pr-16"
                />
                {websiteSearch && (
                  <button
                    type="button"
                    onClick={() => setWebsiteSearch("")}
                    className="btn-ghost absolute right-2 top-1/2 -translate-y-1/2"
                    aria-label="Clear search"
                  >
                    Clear
                  </button>
                )}
              </div>
              {searchQuery && (
                <p className="mt-2 text-xs text-stone-500">
                  {filteredWebsites.length} of {websites.length}{" "}
                  {websites.length === 1 ? "website" : "websites"} match
                </p>
              )}
            </div>
          )}

          {websites.length === 0 && !showAddWebsiteForm && (
            <button
              type="button"
              onClick={() => setShowAddWebsiteForm(true)}
              className="btn-primary mt-6"
            >
              Add website
            </button>
          )}

          {showAddWebsiteForm && (
            <form onSubmit={handleAddWebsite} className="app-panel mt-6 space-y-4">
              <div>
                <label htmlFor="site-url">Website URL</label>
                <input
                  id="site-url"
                  type="url"
                  value={newSiteUrl}
                  onChange={(e) => setNewSiteUrl(e.target.value)}
                  placeholder="https://example.com"
                  required
                  autoFocus
                  className="input-field"
                />
              </div>

              {siteError && (
                <p className="alert-error" role="alert">
                  {siteError}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn-primary">
                  Add website
                </button>
                <button type="button" onClick={closeAddWebsiteForm} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </form>
          )}

          {websites.length === 0 ? (
            <p className="empty-state">
              {showAddWebsiteForm
                ? "Enter a URL above and click Add website."
                : "No websites yet. Click Add website to get started."}
            </p>
          ) : filteredWebsites.length === 0 ? (
            <p className="empty-state">
              No websites match &ldquo;{websiteSearch}&rdquo;. Try a different URL.
            </p>
          ) : (
            <>
            <ul className="list-shell">
              {websitesPagination.items.map((site) => {
                const testCount = entries.filter((e) => e.websiteId === site.id).length;
                const testedThisWeek = stats.testedSiteIds.has(site.id);
                const weekCount = countWeekTestsForSite(entries, site.id);
                return (
                  <li key={site.id} className="list-row">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {site.url ? (
                          <a
                            href={site.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link-site max-w-full"
                          >
                            {site.url}
                          </a>
                        ) : (
                          <p className="font-semibold text-stone-900">{site.name}</p>
                        )}
                        <span
                          className={`badge ${
                            testedThisWeek ? "badge-success" : "badge-warning"
                          }`}
                        >
                          {testedThisWeek ? "Tested this week" : "Pending"}
                        </span>
                        <span className="badge badge-accent">
                          Week: {weekCount} {weekCount === 1 ? "test" : "tests"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-stone-500">
                        {testCount} all-time · {weekCount} logged this week
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {!testedThisWeek && (
                        <button
                          type="button"
                          onClick={() => openLogTestForSite(site.id)}
                          className="btn-primary btn-sm"
                        >
                          Log test
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => requestRemoveWebsite(site.id)}
                        className="btn-ghost-danger"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={websitesPagination.page}
              totalPages={websitesPagination.totalPages}
              onPageChange={setWebsitesPage}
              totalItems={filteredWebsites.length}
              pageSize={PAGE_SIZE_WEBSITES}
              itemLabel={filteredWebsites.length === 1 ? "website" : "websites"}
            />
            </>
          )}
        </section>
        )}

        {activeMenu === "logTest" && (
        <section aria-labelledby="log-form-heading" className="app-card p-6 sm:p-8">
          <div className="section-header">
            <div>
              <h2 id="log-form-heading" className="section-title">
                {editingEntryId ? "Edit Test Entry" : "Record Form Test"}
              </h2>
              {websites.length > 0 && stats.notFinishedYet > 0 && (
                <p className="section-desc text-amber-800">
                  {stats.notFinishedYet} {stats.notFinishedYet === 1 ? "site" : "sites"} remaining this week
                </p>
              )}
              {websites.length > 0 && stats.notFinishedYet === 0 && (
                <p className="section-desc text-emerald-700">
                  All sites tested for this week — great work.
                </p>
              )}
            </div>
          </div>

          {websites.length === 0 ? (
            <p className="alert alert-warning mt-6">
              Add a website on the Websites tab before logging a form test.
            </p>
          ) : !showLogTestForm ? (
            <div className="mt-6">
              <p className="text-sm text-stone-500">
                Open the form to log a weekly contact-form check for any registered site.
              </p>
              <button
                type="button"
                onClick={() => {
                  setEditingEntryId(null);
                  setShowLogTestForm(true);
                }}
                className="btn-primary mt-5"
              >
                Log test
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="app-panel mt-6 space-y-5">
              <div>
                <label htmlFor="test-website">Website tested</label>
                {searchQuery && websitesForSelect.length === 0 ? (
                  <p className="alert alert-warning mt-2">
                    No websites match your search. Clear the search or pick another site.
                  </p>
                ) : (
                  <select
                    id="test-website"
                    value={websiteId}
                    onChange={(e) => setWebsiteId(e.target.value)}
                    className="select-field"
                    required
                  >
                    {websitesForSelect.map((site) => (
                      <option key={site.id} value={site.id}>
                        {siteDisplay(site)}
                      </option>
                    ))}
                  </select>
                )}
                {searchQuery && websitesForSelect.length > 0 && (
                  <p className="mt-2 text-xs text-stone-500">
                    Showing {websitesForSelect.length} matching{" "}
                    {websitesForSelect.length === 1 ? "site" : "sites"}
                  </p>
                )}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="test-date">Date</label>
                  <input
                    id="test-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="input-field"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="form-status">Form status</label>
                  <select
                    id="form-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="select-field"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {weeklyDuplicateForForm && (
                <p className="alert alert-warning" role="status">
                  This site already has a test this week (
                  {formatDisplayDate(weeklyDuplicateForForm.date)}). Submitting will
                  {editingEntryId
                    ? " keep a duplicate unless you change the site or date."
                    : " create a second entry unless you confirm."}
                </p>
              )}

              {formError && (
                <p className="alert-error" role="alert">
                  {formError}
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button type="submit" className="btn-primary">
                  {editingEntryId ? "Save changes" : "Save test entry"}
                </button>
                <button type="button" onClick={closeLogTestForm} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
        )}

        {activeMenu === "history" && (
        <section aria-labelledby="history-heading" className="app-card p-6 sm:p-8">
          <div className="section-header">
            <div>
              <h2 id="history-heading" className="section-title">
                Test History
              </h2>
              <p className="section-desc">
                {filteredEntries.length === 0
                  ? "No entries yet."
                  : `${filteredEntries.length} ${filteredEntries.length === 1 ? "entry" : "entries"} — newest first`}
              </p>
              {entries.length > 0 && (
                <p className="mt-2 text-xs font-semibold text-violet-800">
                  {stats.testsThisWeek} {stats.testsThisWeek === 1 ? "test" : "tests"} logged this week
                  {historyWeekFilter === "week" ? " · filtered view" : ""}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => exportCSV(filteredEntries, websitesById)}
                disabled={filteredEntries.length === 0}
                className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={requestClearAll}
                disabled={entries.length === 0}
                className="btn-danger-outline"
              >
                Clear all
              </button>
            </div>
          </div>

          {filteredEntries.length > 0 && (
            <div
              aria-label="Status breakdown for filtered results"
              className="mt-6 grid grid-cols-3 gap-3"
            >
              {STATUS_OPTIONS.map((opt) => (
                <div key={opt.value} className={`status-mini ${opt.mini}`}>
                  <p className="status-mini__label">{opt.label}</p>
                  <p className="status-mini__value">{historyStatusCounts[opt.value]}</p>
                </div>
              ))}
            </div>
          )}

          {websites.length > 0 && entries.length > 0 && (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <label htmlFor="filter-website">Filter by website</label>
                <select
                  id="filter-website"
                  value={filterWebsiteId}
                  onChange={(e) => setFilterWebsiteId(e.target.value)}
                  className="select-field"
                >
                  <option value="all">All websites</option>
                  {(searchQuery ? filteredWebsites : websites).map((site) => (
                    <option key={site.id} value={site.id}>
                      {siteDisplay(site)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="block text-sm font-medium text-stone-700">Time range</span>
                <div className="segmented mt-1.5">
                  <button
                    type="button"
                    onClick={() => setHistoryWeekFilter("all")}
                    className={`segmented__btn ${
                      historyWeekFilter === "all" ? "segmented__btn--active" : ""
                    }`}
                  >
                    All time
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryWeekFilter("week")}
                    className={`segmented__btn ${
                      historyWeekFilter === "week" ? "segmented__btn--active" : ""
                    }`}
                  >
                    This week ({stats.testsThisWeek})
                  </button>
                </div>
              </div>
              {searchQuery && (
                <p className="text-xs text-stone-500 lg:col-span-2">
                  History also filtered by website search
                </p>
              )}
            </div>
          )}

          {filteredEntries.length === 0 ? (
            <p className="empty-state">
              {entries.length === 0
                ? "Log your first weekly form test above."
                : historyWeekFilter === "week"
                  ? "No tests logged this week for the current filters."
                : searchQuery
                  ? `No tests match "${websiteSearch}".`
                  : filterWebsiteId !== "all"
                    ? "No tests for this website yet."
                    : "No matching entries."}
            </p>
          ) : (
            <>
            <ul className="list-shell mt-6">
              {historyPagination.items.map((entry) => {
                const site = websitesById[entry.websiteId];
                const entryInCurrentWeek = isInCurrentWeek(entry.date);
                const siteWeekCount = countWeekTestsForSite(entries, entry.websiteId);
                return (
                  <li key={entry.id} className="list-row list-row--history">
                    <div className="min-w-0 flex-1">
                      {site?.url ? (
                        <a
                          href={site.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link-site block max-w-full"
                        >
                          {site.url}
                        </a>
                      ) : (
                        <p className="text-sm font-semibold text-violet-900">
                          {site?.name ?? "Unknown site"}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <time
                          dateTime={entry.date}
                          className="text-sm font-semibold text-stone-900"
                        >
                          {formatDisplayDate(entry.date)}
                        </time>
                        <span className={`badge ${statusStyle(entry.status)}`}>
                          {entry.status}
                        </span>
                        {entryInCurrentWeek && (
                          <span className="badge badge-accent">This week</span>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-stone-500">
                        Site week count: {siteWeekCount}{" "}
                        {siteWeekCount === 1 ? "test" : "tests"} this week
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => startEditEntry(entry.id)}
                        className="btn-ghost text-violet-800 hover:bg-violet-50 hover:text-violet-900"
                        aria-label={`Edit test for ${siteDisplay(site)} on ${entry.date}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDeleteEntry(entry.id)}
                        className="btn-ghost-danger"
                        aria-label={`Delete test for ${siteDisplay(site)} on ${entry.date}`}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={historyPagination.page}
              totalPages={historyPagination.totalPages}
              onPageChange={setHistoryPage}
              totalItems={filteredEntries.length}
              pageSize={PAGE_SIZE_HISTORY}
              itemLabel={filteredEntries.length === 1 ? "entry" : "entries"}
            />
            </>
          )}
        </section>
        )}

        <footer className="mt-12 border-t border-stone-200/80 pt-8 text-center text-xs font-medium tracking-wide text-stone-400">
          Data is stored locally in this browser only.
        </footer>
      </div>

      <ConfirmModal
        open={Boolean(deleteModal)}
        title={deleteModal?.title ?? ""}
        message={deleteModal?.message ?? ""}
        confirmLabel={deleteModal?.confirmLabel ?? "Delete"}
        variant={deleteModal?.variant ?? "danger"}
        onConfirm={confirmModalAction}
        onCancel={closeDeleteModal}
      />

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
