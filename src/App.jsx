import { useState, useEffect, useMemo } from "react";

const HISTORY_KEY = "wp-form-test-history";
const WEBSITES_KEY = "wp-form-test-websites";

const MENU_ITEMS = [
  { id: "websites", label: "Websites" },
  { id: "logTest", label: "Log Test" },
  { id: "history", label: "History" },
];

const STATUS_OPTIONS = [
  { value: "Working", label: "Working", color: "bg-emerald-100 text-emerald-800 ring-emerald-600/20" },
  { value: "Broken", label: "Broken", color: "bg-red-100 text-red-800 ring-red-600/20" },
  { value: "Partial", label: "Partial", color: "bg-amber-100 text-amber-800 ring-amber-600/20" },
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
  return STATUS_OPTIONS.find((o) => o.value === status)?.color ?? "bg-slate-100 text-slate-800 ring-slate-600/20";
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
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        onClick={onCancel}
        aria-label="Close dialog"
      />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full ${
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
        <h3 id="confirm-modal-title" className="mt-4 text-lg font-semibold text-slate-900">
          {title}
        </h3>
        <p id="confirm-modal-message" className="mt-2 text-sm leading-relaxed text-slate-600">
          {message}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              isWarning
                ? "bg-amber-600 hover:bg-amber-500 focus:ring-amber-500"
                : "bg-red-600 hover:bg-red-500 focus:ring-red-500"
            }`}
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
  }, [sortedEntries, filterWebsiteId, websiteSearch, searchQuery, websitesById]);

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
    <div className="app-shell font-sans">
      <div className="app-shell__gradient" aria-hidden="true" />
      <div className="app-shell__glow" aria-hidden="true" />
      <div className="app-shell__grid" aria-hidden="true" />

      <div className="relative z-10 mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="mb-8 border-b border-indigo-100/80 pb-8 text-center sm:mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
            WordPress Quality Assurance
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Weekly Form Test Tracker
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-[15px]">
            Manage client websites, record weekly form checks, and review test history.
            All data is stored locally in your browser and may be exported as CSV.
          </p>
        </header>

        <nav
          aria-label="Main menu"
          className="app-card mb-6 flex gap-1 p-1.5"
        >
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
              className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium tracking-wide transition ${
                activeMenu === item.id
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              }`}
              aria-current={activeMenu === item.id ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {websites.length > 0 && activeMenu === "websites" && (
          <section
            aria-label="Weekly test summary"
            className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4"
          >
            <div className="app-stat-card px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                All websites
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{stats.totalWebsites}</p>
            </div>
            <div className="app-stat-card border-emerald-200/60 bg-emerald-50/90 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">
                Tested this week
              </p>
              <p className="mt-1 text-2xl font-semibold text-emerald-800">{stats.formsTested}</p>
              <p className="mt-0.5 text-xs text-emerald-600">
                {stats.testsThisWeek} {stats.testsThisWeek === 1 ? "log" : "logs"} saved
              </p>
            </div>
            <div className="app-stat-card border-amber-200/60 bg-amber-50/90 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-amber-700">
                Not finished yet
              </p>
              <p className="mt-1 text-2xl font-semibold text-amber-800">{stats.notFinishedYet}</p>
              <p className="mt-0.5 text-xs text-amber-600">sites still to test</p>
            </div>
            <div className="app-stat-card border-indigo-200/60 bg-indigo-50/90 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-indigo-700">
                All-time tests
              </p>
              <p className="mt-1 text-2xl font-semibold text-indigo-800">{stats.totalTestsLogged}</p>
              <p className="mt-0.5 text-xs text-indigo-600">total form checks</p>
            </div>
          </section>
        )}

        {activeMenu === "websites" && (
        <section
          aria-labelledby="websites-heading"
          className="app-card p-5 sm:p-6"
        >
          <h2 id="websites-heading" className="text-lg font-semibold text-slate-900">
            Websites Under Test
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            Register each site URL before scheduling weekly form checks.
          </p>

          {websites.length > 0 && (
            <div className="mt-4">
              <label htmlFor="website-search" className="block text-sm font-medium text-slate-700">
                Search websites
              </label>
              <div className="relative mt-1">
                <input
                  id="website-search"
                  type="search"
                  value={websiteSearch}
                  onChange={(e) => setWebsiteSearch(e.target.value)}
                  placeholder="Search by URL…"
                  className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-9 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                {websiteSearch && (
                  <button
                    type="button"
                    onClick={() => setWebsiteSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Clear search"
                  >
                    Clear
                  </button>
                )}
              </div>
              {searchQuery && (
                <p className="mt-1.5 text-xs text-slate-500">
                  {filteredWebsites.length} of {websites.length}{" "}
                  {websites.length === 1 ? "website" : "websites"} match
                </p>
              )}
            </div>
          )}

          {!showAddWebsiteForm ? (
            <button
              type="button"
              onClick={() => setShowAddWebsiteForm(true)}
              className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:w-auto"
            >
              Add website
            </button>
          ) : (
            <form
              onSubmit={handleAddWebsite}
              className="mt-4 space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4"
            >
              <div>
                <label htmlFor="site-url" className="block text-sm font-medium text-slate-700">
                  Website URL
                </label>
                <input
                  id="site-url"
                  type="url"
                  value={newSiteUrl}
                  onChange={(e) => setNewSiteUrl(e.target.value)}
                  placeholder="https://example.com"
                  required
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              {siteError && (
                <p className="text-sm text-red-600" role="alert">
                  {siteError}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  Add website
                </button>
                <button
                  type="button"
                  onClick={closeAddWebsiteForm}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {websites.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              {showAddWebsiteForm
                ? "Enter a URL above and click Add website."
                : "No websites yet. Click Add website to get started."}
            </p>
          ) : filteredWebsites.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              No websites match &ldquo;{websiteSearch}&rdquo;. Try a different URL.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100">
              {filteredWebsites.map((site) => {
                const testCount = entries.filter((e) => e.websiteId === site.id).length;
                const testedThisWeek = stats.testedSiteIds.has(site.id);
                const weekCount = entries.filter(
                  (e) => e.websiteId === site.id && isInCurrentWeek(e.date)
                ).length;
                return (
                  <li
                    key={site.id}
                    className="flex flex-col gap-2 px-3 py-3 first:rounded-t-lg last:rounded-b-lg sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {site.url ? (
                          <a
                            href={site.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate font-medium text-indigo-600 hover:underline"
                          >
                            {site.url}
                          </a>
                        ) : (
                          <p className="font-medium text-slate-900">{site.name}</p>
                        )}
                        <span
                          className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                            testedThisWeek
                              ? "bg-emerald-100 text-emerald-800 ring-emerald-600/20"
                              : "bg-amber-100 text-amber-800 ring-amber-600/20"
                          }`}
                        >
                          {testedThisWeek ? "Tested this week" : "Not finished yet"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {testCount} all-time · {weekCount} this week
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-center">
                      {!testedThisWeek && (
                        <button
                          type="button"
                          onClick={() => openLogTestForSite(site.id)}
                          className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-indigo-500"
                        >
                          Log test
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => requestRemoveWebsite(site.id)}
                        className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        )}

        {activeMenu === "logTest" && (
        <section
          aria-labelledby="log-form-heading"
          className="app-card p-5 sm:p-6"
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="log-form-heading" className="text-lg font-semibold text-slate-900">
              {editingEntryId ? "Edit Test Entry" : "Record Form Test"}
            </h2>
            {websites.length > 0 && stats.notFinishedYet > 0 && (
              <p className="text-sm text-amber-700">
                {stats.notFinishedYet} {stats.notFinishedYet === 1 ? "site" : "sites"} left this week
              </p>
            )}
          </div>

          {websites.length === 0 ? (
            <p className="mt-3 text-sm text-amber-700 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              Add a website on the Websites menu before logging a form test.
            </p>
          ) : !showLogTestForm ? (
            <>
              <p className="mt-3 text-sm text-slate-500">
                Click the button below to open the test form.
              </p>
              <button
                type="button"
                onClick={() => {
                  setEditingEntryId(null);
                  setShowLogTestForm(true);
                }}
                className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:w-auto"
              >
                Log Test
              </button>
            </>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="mt-4 space-y-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4"
            >
              <div>
                <label htmlFor="test-website" className="block text-sm font-medium text-slate-700">
                  Website tested
                </label>
                {searchQuery && websitesForSelect.length === 0 ? (
                  <p className="mt-2 text-sm text-amber-700 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                    No websites match your search. Clear the search above or pick another site.
                  </p>
                ) : (
                  <select
                    id="test-website"
                    value={websiteId}
                    onChange={(e) => setWebsiteId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
                  <p className="mt-1 text-xs text-slate-500">
                    Showing {websitesForSelect.length} matching{" "}
                    {websitesForSelect.length === 1 ? "site" : "sites"} (use search above to narrow)
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="test-date" className="block text-sm font-medium text-slate-700">
                    Date
                  </label>
                  <input
                    id="test-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="form-status" className="block text-sm font-medium text-slate-700">
                    Form status
                  </label>
                  <select
                    id="form-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
                <p
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                  role="status"
                >
                  This site already has a test this week (
                  {formatDisplayDate(weeklyDuplicateForForm.date)}). Submitting will
                  {editingEntryId ? " keep a duplicate unless you change the site or date." : " create a second entry unless you confirm."}
                </p>
              )}

              {formError && (
                <p className="text-sm text-red-600" role="alert">
                  {formError}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  {editingEntryId ? "Save changes" : "Save test entry"}
                </button>
                <button
                  type="button"
                  onClick={closeLogTestForm}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
        )}

        {activeMenu === "history" && (
        <section
          aria-labelledby="history-heading"
          className="app-card p-5 sm:p-6"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="history-heading" className="text-lg font-semibold text-slate-900">
                Test History
              </h2>
              <p className="text-sm leading-relaxed text-slate-500">
                {filteredEntries.length === 0
                  ? "No entries yet."
                  : `${filteredEntries.length} ${filteredEntries.length === 1 ? "entry" : "entries"} — newest first`}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => exportCSV(filteredEntries, websitesById)}
                disabled={filteredEntries.length === 0}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={requestClearAll}
                disabled={entries.length === 0}
                className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear all
              </button>
            </div>
          </div>

          {websites.length > 0 && entries.length > 0 && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="filter-website" className="block text-sm font-medium text-slate-700">
                  Filter by website
                </label>
                <select
                  id="filter-website"
                  value={filterWebsiteId}
                  onChange={(e) => setFilterWebsiteId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="all">All websites</option>
                  {(searchQuery ? filteredWebsites : websites).map((site) => (
                    <option key={site.id} value={site.id}>
                      {siteDisplay(site)}
                    </option>
                  ))}
                </select>
              </div>
              {searchQuery && (
                <p className="text-xs text-slate-500 sm:pb-2">
                  History also filtered by search above
                </p>
              )}
            </div>
          )}

          {filteredEntries.length === 0 ? (
            <p className="mt-6 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              {entries.length === 0
                ? "Log your first weekly form test above."
                : searchQuery
                  ? `No tests match "${websiteSearch}".`
                  : filterWebsiteId !== "all"
                    ? "No tests for this website yet."
                    : "No matching entries."}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {filteredEntries.map((entry) => {
                const site = websitesById[entry.websiteId];
                return (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-3 py-4 first:pt-2 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      {site?.url ? (
                        <a
                          href={site.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold text-indigo-700 hover:underline truncate block"
                        >
                          {site.url}
                        </a>
                      ) : (
                        <p className="text-sm font-semibold text-indigo-700">
                          {site?.name ?? "Unknown site"}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <time
                          dateTime={entry.date}
                          className="text-sm font-semibold text-slate-900"
                        >
                          {formatDisplayDate(entry.date)}
                        </time>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyle(entry.status)}`}
                        >
                          {entry.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2 self-start">
                      <button
                        type="button"
                        onClick={() => startEditEntry(entry.id)}
                        className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
                        aria-label={`Edit test for ${siteDisplay(site)} on ${entry.date}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDeleteEntry(entry.id)}
                        className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-red-600"
                        aria-label={`Delete test for ${siteDisplay(site)} on ${entry.date}`}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        )}

        <footer className="mt-8 text-center text-xs font-medium tracking-wide text-slate-400">
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
        <div
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
