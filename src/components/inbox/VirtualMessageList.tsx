'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/** Distance from the bottom (px) that still counts as "reading the latest messages" */
const BOTTOM_THRESHOLD = 80;
/** Distance from the top (px) at which the next older batch is requested */
const LOAD_OLDER_THRESHOLD = 300;
const HEADER_KEY = '__thread-header';

interface VirtualMessageListProps<T extends { id: string }> {
  /** Messages in chronological order (oldest first) */
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Scrolls with the thread above the first message (loading indicator, AI summary) */
  header?: React.ReactNode;
  hasMore: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  /** A newly appended item that should scroll the thread down even when reading history (e.g. the agent's own send) */
  shouldScrollToNewItem?: (item: T) => boolean;
  /** Scrolls the item with this id into the middle of the view; a new `nonce` repeats the same request */
  scrollRequest?: { id: string; nonce: number } | null;
}

/**
 * Chat thread that only mounts the rows in view (plus overscan).
 * Row 0 is the header; message rows are measured as they render, so media and long texts size correctly.
 * Remount it per conversation (`key`) so the scroll state starts fresh.
 */
export function VirtualMessageList<T extends { id: string }>({
  items,
  renderItem,
  header,
  hasMore,
  isLoadingOlder,
  onLoadOlder,
  shouldScrollToNewItem,
  scrollRequest,
}: VirtualMessageListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevRef = useRef<{ firstId?: string; lastId?: string; scrollHeight: number }>({ scrollHeight: 0 });

  const virtualizer = useVirtualizer({
    count: items.length + 1,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (index === 0 ? 40 : 76),
    getItemKey: (index) => (index === 0 ? HEADER_KEY : items[index - 1].id),
    overscan: 8,
    paddingStart: 16,
    paddingEnd: 16,
  });

  const totalSize = virtualizer.getTotalSize();

  // Runs before paint so the user never sees the thread jump
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevRef.current;
    const firstId = items[0]?.id;
    const lastId = items[items.length - 1]?.id;

    const prepended = Boolean(prev.firstId && firstId !== prev.firstId && items.some((m) => m.id === prev.firstId));
    const appended = Boolean(lastId && lastId !== prev.lastId);

    if (prepended) {
      // An older batch was inserted above: keep the same message under the reader's eyes
      el.scrollTop += el.scrollHeight - prev.scrollHeight;
    } else if (isAtBottomRef.current || (appended && shouldScrollToNewItem?.(items[items.length - 1]))) {
      // Follow new messages and content that grows at the bottom (e.g. an image finishing loading)
      el.scrollTop = el.scrollHeight;
      isAtBottomRef.current = true;
    }

    prevRef.current = { firstId, lastId, scrollHeight: el.scrollHeight };
  }, [items, totalSize, shouldScrollToNewItem]);

  // Jump to a message (e.g. the one a reply quotes); row 0 is the header
  useEffect(() => {
    if (!scrollRequest) return;
    const index = items.findIndex((m) => m.id === scrollRequest.id);
    if (index === -1) return;
    isAtBottomRef.current = false;
    virtualizer.scrollToIndex(index + 1, { align: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new request scrolls, not new items
  }, [scrollRequest]);

  const maybeLoadOlder = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || isLoadingOlder) return;
    if (el.scrollTop < LOAD_OLDER_THRESHOLD) onLoadOlder();
  }, [hasMore, isLoadingOlder, onLoadOlder]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    maybeLoadOlder();
  };

  // A batch that doesn't fill the pane (or a finished load still near the top) fetches the next one
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || isLoadingOlder) return;
    if (el.scrollHeight <= el.clientHeight) onLoadOlder();
    else maybeLoadOlder();
  }, [hasMore, isLoadingOlder, items.length, onLoadOlder, maybeLoadOlder]);

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto" style={{ overflowAnchor: 'none' }}>
      <div className="relative w-full" style={{ height: totalSize }}>
        {virtualizer.getVirtualItems().map((row) => (
          // `top` instead of `transform`: no stacking context per row, so popovers (reaction picker) overlap neighbouring rows
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className={`absolute left-0 w-full px-4 ${row.index === 0 ? '' : 'pb-3'}`}
            style={{ top: row.start }}
          >
            {row.index === 0 ? header : renderItem(items[row.index - 1], row.index - 1)}
          </div>
        ))}
      </div>
    </div>
  );
}
