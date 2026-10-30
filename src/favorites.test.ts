// ABOUTME: Tests for favorite session parsing, toggling, partitioning and the persisted-storage controller.
// ABOUTME: Uses synthetic session ids only; no real Rex sessions or Raycast runtime are touched.
import { describe, expect, it } from "vitest";
import {
  createFavoritesController,
  isFavorite,
  parseFavorites,
  partitionFavorites,
  serializeFavorites,
  toggleFavorite,
  type FavoritesStorage,
} from "./favorites";
import { toRexItem, toSeshItems, toZoxideItems } from "./items";

const alpha = toRexItem({ session_id: "session:alpha", label: "alpha" }, 2);
const beta = toRexItem({ session_id: "session:beta", label: "beta" }, 1);
const alphaRenamed = toRexItem({ session_id: "session:alpha", label: "alpha renamed" }, 2);
const alphaOnStudio = toRexItem({ session_id: "session:alpha", label: "alpha" }, 3, "studio");
const [directory] = toZoxideItems(["/work/app"], "/work");
const [seshEntry] = toSeshItems([{ Name: "notes", Path: "/work/notes" }]);

function memoryStorage(initial?: string) {
  let value = initial;
  const writes: string[] = [];
  const storage: FavoritesStorage = {
    getItem: async () => value,
    setItem: async (next) => {
      writes.push(next);
      value = next;
    },
  };
  return { storage, writes, read: () => value };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("parseFavorites", () => {
  it("treats a missing or empty value as no favorites", () => {
    for (const raw of [undefined, null, ""]) {
      expect(parseFavorites(raw)).toEqual({ ok: true, ids: [] });
    }
  });

  it("reads ids in their saved insertion order", () => {
    expect(parseFavorites(JSON.stringify([beta.id, alpha.id]))).toEqual({ ok: true, ids: [beta.id, alpha.id] });
  });

  it("accepts an already parsed array", () => {
    expect(parseFavorites([alpha.id, beta.id])).toEqual({ ok: true, ids: [alpha.id, beta.id] });
  });

  it("drops duplicates but keeps the first occurrence's position", () => {
    expect(parseFavorites(JSON.stringify([alpha.id, beta.id, alpha.id]))).toEqual({
      ok: true,
      ids: [alpha.id, beta.id],
    });
  });

  it("rejects malformed JSON instead of silently ignoring it", () => {
    const result = parseFavorites("[not json");
    expect(result.ok).toBe(false);
  });

  it("rejects values that are not a list of ids", () => {
    expect(parseFavorites(JSON.stringify({ ids: [alpha.id] })).ok).toBe(false);
    expect(parseFavorites(JSON.stringify(alpha.id)).ok).toBe(false);
    expect(parseFavorites(JSON.stringify([alpha.id, 7])).ok).toBe(false);
    expect(parseFavorites(JSON.stringify([alpha.id, ""])).ok).toBe(false);
  });

  it("round-trips through serialization", () => {
    const ids = [alpha.id, beta.id];
    expect(parseFavorites(serializeFavorites(ids))).toEqual({ ok: true, ids });
  });
});

describe("toggleFavorite", () => {
  it("adds a new id at the end", () => {
    expect(toggleFavorite([alpha.id], beta.id)).toEqual([alpha.id, beta.id]);
  });

  it("removes a favorite while keeping the other entries in order", () => {
    expect(toggleFavorite([alpha.id, beta.id, alphaOnStudio.id], beta.id)).toEqual([alpha.id, alphaOnStudio.id]);
  });

  it("re-adds to the end, so insertion order is the favorite order", () => {
    expect(toggleFavorite([alpha.id, beta.id], alpha.id)).toEqual([beta.id]);
    expect(toggleFavorite([beta.id], alpha.id)).toEqual([beta.id, alpha.id]);
  });

  it("never mutates the list it was given", () => {
    const ids = [alpha.id];
    toggleFavorite(ids, beta.id);
    expect(ids).toEqual([alpha.id]);
  });

  it("toggling twice returns to the empty list without duplicates", () => {
    expect(toggleFavorite(toggleFavorite([], alpha.id), alpha.id)).toEqual([]);
  });

  it("reports membership by the exact server-qualified id", () => {
    expect(isFavorite([alpha.id], alpha.id)).toBe(true);
    expect(isFavorite([alpha.id], alphaOnStudio.id)).toBe(false);
  });
});

describe("partitionFavorites", () => {
  const items = [alphaOnStudio, directory, beta, alpha, seshEntry];

  it("keeps the incoming order in both partitions", () => {
    const { favorites, others } = partitionFavorites(items, [beta.id, alpha.id]);
    expect(favorites).toEqual([beta, alpha]);
    expect(others).toEqual([alphaOnStudio, directory, seshEntry]);
  });

  it("only favors open Rex sessions, even if a stored id collides with another kind", () => {
    const { favorites, others } = partitionFavorites([directory, seshEntry], [directory.id, seshEntry.id]);
    expect(favorites).toEqual([]);
    expect(others).toEqual([directory, seshEntry]);
  });

  it("does not confuse the same session id on two hosts", () => {
    const { favorites, others } = partitionFavorites([alpha, alphaOnStudio], [alphaOnStudio.id]);
    expect(favorites).toEqual([alphaOnStudio]);
    expect(others).toEqual([alpha]);
  });

  it("keeps a favorite after the session is renamed", () => {
    const { favorites } = partitionFavorites([alphaRenamed], [alpha.id]);
    expect(favorites).toEqual([alphaRenamed]);
  });

  it("leaves offline favorites in the id list but out of both visible partitions", () => {
    const favoriteIds = [beta.id, alpha.id];
    const { favorites, others } = partitionFavorites([alpha], favoriteIds);
    expect(favorites).toEqual([alpha]);
    expect(others).toEqual([]);
    expect(favoriteIds).toEqual([beta.id, alpha.id]);
  });

  it("returns every item as other when there are no favorites", () => {
    expect(partitionFavorites(items, [])).toEqual({ favorites: [], others: items });
  });
});

describe("createFavoritesController", () => {
  it("loads saved ids and reports loading until the read settles", async () => {
    const gate = deferred<string | undefined>();
    const controller = createFavoritesController({ storage: { getItem: () => gate.promise, setItem: async () => {} } });
    expect(controller.isLoading()).toBe(true);

    const loading = controller.load();
    expect(controller.isLoading()).toBe(true);
    gate.resolve(JSON.stringify([beta.id]));
    await loading;

    expect(controller.getFavoriteIds()).toEqual([beta.id]);
    expect(controller.isLoading()).toBe(false);
  });

  it("persists a toggle and keeps the previous favorites", async () => {
    const { storage, read } = memoryStorage(JSON.stringify([beta.id]));
    const controller = createFavoritesController({ storage });
    await controller.load();

    await controller.toggle(alpha);

    expect(controller.getFavoriteIds()).toEqual([beta.id, alpha.id]);
    expect(read()).toBe(JSON.stringify([beta.id, alpha.id]));
  });

  it("keeps insertion order when a favorite is removed and added again", async () => {
    const { storage, read } = memoryStorage(JSON.stringify([alpha.id, beta.id]));
    const controller = createFavoritesController({ storage });
    await controller.load();

    await controller.toggle(alpha);
    await controller.toggle(alpha);

    expect(JSON.parse(read() ?? "[]")).toEqual([beta.id, alpha.id]);
  });

  it("serializes rapid toggles so neither update is lost", async () => {
    const { storage, writes, read } = memoryStorage(JSON.stringify([]));
    const controller = createFavoritesController({ storage });
    await controller.load();

    await Promise.all([controller.toggle(alpha), controller.toggle(beta)]);

    expect(writes.map((value) => JSON.parse(value))).toEqual([[alpha.id], [alpha.id, beta.id]]);
    expect(JSON.parse(read() ?? "[]")).toEqual([alpha.id, beta.id]);
  });

  it("waits for the initial read before toggling", async () => {
    const gate = deferred<string | undefined>();
    const writes: string[] = [];
    const controller = createFavoritesController({
      storage: {
        getItem: () => gate.promise,
        setItem: async (value) => {
          writes.push(value);
        },
      },
    });

    const loading = controller.load();
    const toggling = controller.toggle(alpha);
    expect(writes).toEqual([]);

    gate.resolve(JSON.stringify([beta.id]));
    await Promise.all([loading, toggling]);

    expect(controller.getFavoriteIds()).toEqual([beta.id, alpha.id]);
    expect(writes).toEqual([JSON.stringify([beta.id, alpha.id])]);
  });

  it("ignores items that are not open Rex sessions", async () => {
    const { storage, writes } = memoryStorage(JSON.stringify([alpha.id]));
    const controller = createFavoritesController({ storage });
    await controller.load();

    await controller.toggle(directory);
    await controller.toggle(seshEntry);

    expect(controller.getFavoriteIds()).toEqual([alpha.id]);
    expect(writes).toEqual([]);
  });

  it("rolls back and rejects when the write fails", async () => {
    const stored = JSON.stringify([beta.id]);
    let writes = 0;
    const controller = createFavoritesController({
      storage: {
        getItem: async () => stored,
        setItem: async () => {
          writes += 1;
          throw new Error("disk full");
        },
      },
    });
    await controller.load();

    await expect(controller.toggle(alpha)).rejects.toThrow("disk full");

    expect(writes).toBe(1);
    expect(controller.getFavoriteIds()).toEqual([beta.id]);
  });

  it("keeps later toggles working after one write fails", async () => {
    const { storage, read } = memoryStorage(JSON.stringify([beta.id]));
    let failNext = true;
    const flaky: FavoritesStorage = {
      getItem: storage.getItem,
      setItem: async (value) => {
        if (failNext) {
          failNext = false;
          throw new Error("temporary failure");
        }
        await storage.setItem(value);
      },
    };
    const controller = createFavoritesController({ storage: flaky });
    await controller.load();

    await expect(controller.toggle(alpha)).rejects.toThrow("temporary failure");
    await controller.toggle(alpha);

    expect(controller.getFavoriteIds()).toEqual([beta.id, alpha.id]);
    expect(JSON.parse(read() ?? "[]")).toEqual([beta.id, alpha.id]);
  });

  it("surfaces a read failure and never writes over unread favorites", async () => {
    let writes = 0;
    const errors: Error[] = [];
    const controller = createFavoritesController({
      storage: {
        getItem: async () => {
          throw new Error("storage unavailable");
        },
        setItem: async () => {
          writes += 1;
        },
      },
      onLoadError: (error) => errors.push(error),
    });

    await controller.load();

    expect(controller.isLoading()).toBe(false);
    expect(errors.map((error) => error.message)).toEqual(["storage unavailable"]);
    await expect(controller.toggle(alpha)).rejects.toThrow("storage unavailable");
    expect(writes).toBe(0);
  });

  it("retries a failed read on the next toggle and merges with the saved favorites", async () => {
    let reads = 0;
    const writes: string[] = [];
    const controller = createFavoritesController({
      storage: {
        getItem: async () => {
          reads += 1;
          if (reads === 1) throw new Error("storage unavailable");
          return JSON.stringify([beta.id]);
        },
        setItem: async (value) => {
          writes.push(value);
        },
      },
    });

    await controller.load();
    await controller.toggle(alpha);

    expect(reads).toBe(2);
    expect(controller.getFavoriteIds()).toEqual([beta.id, alpha.id]);
    expect(writes).toEqual([JSON.stringify([beta.id, alpha.id])]);
  });

  it("treats a corrupt saved value as a read failure and protects it", async () => {
    let writes = 0;
    const errors: Error[] = [];
    const controller = createFavoritesController({
      storage: {
        getItem: async () => "definitely not json",
        setItem: async () => {
          writes += 1;
        },
      },
      onLoadError: (error) => errors.push(error),
    });

    await controller.load();

    expect(errors).toHaveLength(1);
    await expect(controller.toggle(alpha)).rejects.toThrow("Saved favorites are not valid JSON.");
    expect(writes).toBe(0);
  });

  it("notifies subscribers on changes and stops after unsubscribe", async () => {
    const { storage } = memoryStorage(JSON.stringify([]));
    const controller = createFavoritesController({ storage });
    let notifications = 0;
    const unsubscribe = controller.subscribe(() => {
      notifications += 1;
    });

    await controller.load();
    const afterLoad = notifications;
    await controller.toggle(alpha);
    expect(notifications).toBe(afterLoad + 1);

    unsubscribe();
    const beforeUnsubscribeToggle = notifications;
    await controller.toggle(beta);
    expect(notifications).toBe(beforeUnsubscribeToggle);
  });
});
