// ABOUTME: React hook that persists favorite Rex sessions in Raycast LocalStorage.
// ABOUTME: Wraps the storage-agnostic controller in src/favorites.ts and surfaces read failures as toasts.
import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalStorage, Toast, showToast } from "@raycast/api";
import { FAVORITES_STORAGE_KEY, createFavoritesController } from "./favorites";
import type { Item } from "./items";

export interface UseFavorites {
  /** Server-qualified ids in insertion order, including favorites whose host is offline. */
  favoriteIds: string[];
  isLoading: boolean;
  /** Rejects when the write fails, after restoring the previous ids. */
  toggleFavorite: (item: Item) => Promise<void>;
}

export function useFavorites(): UseFavorites {
  const controller = useMemo(
    () =>
      createFavoritesController({
        storage: {
          getItem: () => LocalStorage.getItem<string>(FAVORITES_STORAGE_KEY),
          setItem: (value) => LocalStorage.setItem(FAVORITES_STORAGE_KEY, value),
        },
        onLoadError: (error) => {
          showToast({
            style: Toast.Style.Failure,
            title: "Couldn't load favorites",
            message: error.message,
          }).catch(() => undefined);
        },
      }),
    [],
  );

  const [state, setState] = useState(() => ({
    favoriteIds: controller.getFavoriteIds(),
    isLoading: controller.isLoading(),
  }));

  useEffect(() => {
    const update = () => setState({ favoriteIds: controller.getFavoriteIds(), isLoading: controller.isLoading() });
    const unsubscribe = controller.subscribe(update);
    update();
    void controller.load();
    return unsubscribe;
  }, [controller]);

  const toggleFavorite = useCallback((item: Item) => controller.toggle(item), [controller]);

  return { favoriteIds: state.favoriteIds, isLoading: state.isLoading, toggleFavorite };
}
