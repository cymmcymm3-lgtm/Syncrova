import { useCallback, useState } from 'react';
import type { MediaViewerItem } from '../utils/mediaHelpers';

export const useMediaViewer = () => {
  const [items, setItems] = useState<MediaViewerItem[]>([]);
  const [initialIndex, setInitialIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  const open = useCallback((nextItems: MediaViewerItem[], index = 0) => {
    if (!nextItems.length) return;
    setItems(nextItems);
    setInitialIndex(Math.max(0, Math.min(index, nextItems.length - 1)));
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  return {
    close,
    initialIndex,
    items,
    open,
    visible
  };
};
