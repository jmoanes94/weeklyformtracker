/**
 * Merge websites and test entries by id so concurrent edits from multiple users
 * are combined instead of the last write wiping the other user's changes.
 */

function itemSortKey(item) {
  return item?.createdAt ?? 0;
}

function pickNewerItem(existing, incoming, preferIncoming = false) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const tsExisting = itemSortKey(existing);
  const tsIncoming = itemSortKey(incoming);
  if (tsIncoming > tsExisting) return incoming;
  if (tsExisting > tsIncoming) return existing;
  return preferIncoming ? incoming : existing;
}

function mergeListById(currentList = [], incomingList = [], preferIncoming = false) {
  const byId = new Map();
  const order = [];

  for (const item of currentList) {
    if (!item?.id) continue;
    byId.set(item.id, item);
    order.push(item.id);
  }

  for (const item of incomingList) {
    if (!item?.id) continue;
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      order.push(item.id);
      continue;
    }
    byId.set(item.id, pickNewerItem(existing, item, preferIncoming));
  }

  return order.map((id) => byId.get(id));
}

export function mergeSharedData(current, incoming, options = {}) {
  const preferIncoming = Boolean(options.preferIncoming);
  const base = {
    websites: Array.isArray(current?.websites) ? current.websites : [],
    entries: Array.isArray(current?.entries) ? current.entries : [],
  };
  const next = {
    websites: Array.isArray(incoming?.websites) ? incoming.websites : [],
    entries: Array.isArray(incoming?.entries) ? incoming.entries : [],
  };

  return {
    websites: mergeListById(base.websites, next.websites, preferIncoming),
    entries: mergeListById(base.entries, next.entries, preferIncoming),
  };
}

function normalizeList(list = []) {
  return [...list]
    .filter((item) => item?.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => JSON.stringify(item));
}

export function sharedDataEquals(a, b) {
  const left = mergeSharedData(a, b);
  const right = mergeSharedData(b, a);
  return (
    JSON.stringify(normalizeList(left.websites)) ===
      JSON.stringify(normalizeList(right.websites)) &&
    JSON.stringify(normalizeList(left.entries)) ===
      JSON.stringify(normalizeList(right.entries))
  );
}
