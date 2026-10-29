// ABOUTME: Pure helpers for persisted favorite Rex sessions: parsing, serializing, toggling and partitioning items.
// ABOUTME: Also builds a storage-agnostic controller that serializes writes so rapid toggles never lose updates.
import type { Item } from "./items";

/** LocalStorage key holding a JSON array of server-qualified item ids. */
export const FAVORITES_STORAGE_KEY = "favoriteSessionIds";

export type FavoritesParseResult = { ok: true; ids: string[] } | { ok: false; error: Error };

/** Only open Rex sessions can be favorited; sesh entries and directories cannot. */
export function canFavorite(item: Item): boolean {
  return item.kind === "rex";
}

/**
 * Read the persisted value. A missing value means no favorites, but a malformed value is an
 * error: guessing would let a later write replace favorites we never really read.
 */
export function parseFavorites(raw: unknown): FavoritesParseResult {
  if (raw === undefined || raw === null || raw === "") return { ok: true, ids: [] };

  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: new Error("Saved favorites are not valid JSON.") };
    }
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: new Error("Saved favorites must be a list of session ids.") };
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      return { ok: false, error: new Error("Saved favorites must contain only non-empty session ids.") };
    }
    if (!seen.has(entry)) {
      seen.add(entry);
      ids.push(entry);
    }
  }
  return { ok: true, ids };
}

export function serializeFavorites(ids: readonly string[]): string {
  return JSON.stringify(ids);
}

export function isFavorite(ids: readonly string[], id: string): boolean {
  return ids.includes(id);
}

/** Add at the end or remove in place; existing entries keep their insertion order and never repeat. */
export function toggleFavorite(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((favorite) => favorite !== id) : [...ids, id];
}

export interface FavoritePartition {
  favorites: Item[];
  others: Item[];
}

/**
 * Split items for the Favorites and Open Sessions sections while keeping the incoming order.
 * Ids without a visible item (offline hosts, filtered hosts) simply stay in the persisted list.
 */
export function partitionFavorites(items: Item[], favoriteIds: readonly string[]): FavoritePartition {
  const favoriteSet = new Set(favoriteIds);
  const favorites: Item[] = [];
  const others: Item[] = [];
  for (const item of items) {
    if (canFavorite(item) && favoriteSet.has(item.id)) {
      favorites.push(item);
    } else {
      others.push(item);
    }
  }
  return { favorites, others };
}

/** The two LocalStorage calls the controller needs, injected so tests can run without Raycast. */
export interface FavoritesStorage {
  getItem(): Promise<string | undefined>;
  setItem(value: string): Promise<void>;
}

export interface FavoritesControllerOptions {
  storage: FavoritesStorage;
  /** Called once per failed read, so the command can surface it without losing saved state. */
  onLoadError?: (error: Error) => void;
}

export type FavoritesListener = () => void;

export interface FavoritesController {
  getFavoriteIds(): string[];
  isLoading(): boolean;
  load(): Promise<void>;
  toggle(item: Item): Promise<void>;
  subscribe(listener: FavoritesListener): () => void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Owns the favorite ids for one command. Reads happen once (retried after a failure); writes are
 * queued one at a time behind the latest in-memory ids, so a fast second toggle builds on the
 * first. A failed write restores the previous ids and rejects so the caller can show the error.
 */
export function createFavoritesController(options: FavoritesControllerOptions): FavoritesController {
  const { storage, onLoadError } = options;
  const listeners = new Set<FavoritesListener>();
  let ids: string[] = [];
  let status: "idle" | "loading" | "loaded" | "error" = "idle";
  let loadError: Error | undefined;
  let loadPromise: Promise<void> | undefined;
  let writeQueue: Promise<unknown> = Promise.resolve();

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  function startLoad(): Promise<void> {
    status = "loading";
    notify();
    loadPromise = (async () => {
      try {
        const parsed = parseFavorites(await storage.getItem());
        if (!parsed.ok) throw parsed.error;
        ids = parsed.ids;
        loadError = undefined;
        status = "loaded";
      } catch (error) {
        // The ids stay empty and unwritten: a failed read must never become a destructive write.
        loadError = toError(error);
        status = "error";
        onLoadError?.(loadError);
      } finally {
        loadPromise = undefined;
        notify();
      }
    })();
    return loadPromise;
  }

  function load(): Promise<void> {
    if (status === "loaded") return Promise.resolve();
    if (loadPromise) return loadPromise;
    return startLoad();
  }

  async function ensureLoaded(): Promise<void> {
    if (status !== "loaded") await load();
    if (status !== "loaded") throw loadError ?? new Error("Favorites could not be loaded.");
  }

  async function applyToggle(item: Item): Promise<void> {
    await ensureLoaded();
    const previous = ids;
    const next = toggleFavorite(previous, item.id);
    ids = next;
    notify();
    try {
      await storage.setItem(serializeFavorites(next));
    } catch (error) {
      ids = previous;
      notify();
      throw toError(error);
    }
  }

  return {
    getFavoriteIds: () => [...ids],
    isLoading: () => status === "idle" || status === "loading",
    load,
    toggle(item: Item): Promise<void> {
      if (!canFavorite(item) || !item.id) return Promise.resolve();
      const operation = writeQueue.then(() => applyToggle(item));
      // Keep later operations running after a rejection; the caller still receives that rejection.
      writeQueue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    subscribe(listener: FavoritesListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
