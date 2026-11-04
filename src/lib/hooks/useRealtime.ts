'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { RealtimeEvent } from '@/lib/realtime';
import { clientLogger } from '@/lib/client-logger';

export interface UseRealtimeOptions {
  onMessageNew?: (event: Extract<RealtimeEvent, { type: 'message.new' }>) => void;
  onMessageStatus?: (event: Extract<RealtimeEvent, { type: 'message.status' }>) => void;
  onMessageReaction?: (event: Extract<RealtimeEvent, { type: 'message.reaction' }>) => void;
  onNotificationCount?: (event: Extract<RealtimeEvent, { type: 'notification.count' }>) => void;
  onConversationUpdated?: (event: Extract<RealtimeEvent, { type: 'conversation.updated' }>) => void;
  onChannelUpdated?: (event: Extract<RealtimeEvent, { type: 'channel.updated' }>) => void;
  onTemplateStatus?: (event: Extract<RealtimeEvent, { type: 'template.status' }>) => void;
  onAnyEvent?: (event: RealtimeEvent) => void;
  enabled?: boolean;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * useRealtime hook:
 * Connects to Server-Sent Events (SSE) `/api/events` with user's Firebase auth token.
 * Listens for live incoming messages, status updates, reactions, and notifications.
 */
export function useRealtime(options: UseRealtimeOptions = {}) {
  const { onMessageNew, onMessageStatus, onMessageReaction, onNotificationCount, onAnyEvent, enabled = true } = options;
  const { user, getIdToken, refreshDbUser } = useAuth();

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);

  // Keep latest callbacks in refs so EventSource event listeners never go stale
  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(async () => {
    if (!enabled || !user) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setStatus('disconnected');
      return;
    }

    try {
      setStatus('connecting');
      const token = await getIdToken();
      if (!token) {
        clientLogger.debug('useRealtime', 'No auth token available yet, waiting…');
        setStatus('disconnected');
        return;
      }

      // Close any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const sseUrl = `/api/events?token=${encodeURIComponent(token)}`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        setStatus('connected');
        reconnectAttempts.current = 0;
        clientLogger.info('useRealtime', 'Live updates connected (/api/events)');
      };

      // 1. New Message Event (inbound WhatsApp message, outbound message, or internal note)
      es.addEventListener('message.new', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          setLastEventTime(new Date());
          callbacksRef.current.onMessageNew?.(payload);
          callbacksRef.current.onAnyEvent?.(payload);
        } catch (err) {
          clientLogger.error('useRealtime', 'Could not handle message.new event', { err, data: e.data });
        }
      });

      // 2. Message Status Event (sent -> delivered -> read -> failed)
      es.addEventListener('message.status', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          setLastEventTime(new Date());
          callbacksRef.current.onMessageStatus?.(payload);
          callbacksRef.current.onAnyEvent?.(payload);
        } catch (err) {
          clientLogger.error('useRealtime', 'Could not handle message.status event', { err, data: e.data });
        }
      });

      // 3. Message Reaction Event (emoji added or removed)
      es.addEventListener('message.reaction', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          setLastEventTime(new Date());
          callbacksRef.current.onMessageReaction?.(payload);
          callbacksRef.current.onAnyEvent?.(payload);
        } catch (err) {
          clientLogger.error('useRealtime', 'Could not handle message.reaction event', { err, data: e.data });
        }
      });

      // 4. Notification Count Event
      es.addEventListener('notification.count', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          setLastEventTime(new Date());
          callbacksRef.current.onNotificationCount?.(payload);
          callbacksRef.current.onAnyEvent?.(payload);
        } catch (err) {
          clientLogger.error('useRealtime', 'Could not handle notification.count event', { err, data: e.data });
        }
      });

      // 5. Conversation Updated Event (AI/human mode, assignee, status, tags)
      es.addEventListener('conversation.updated', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          setLastEventTime(new Date());
          callbacksRef.current.onConversationUpdated?.(payload);
          callbacksRef.current.onAnyEvent?.(payload);
        } catch (err) {
          clientLogger.error('useRealtime', 'Could not handle conversation.updated event', { err, data: e.data });
        }
      });

      // 6. Channel Updated Event (a channel was connected, reconnected or disconnected)
      es.addEventListener('channel.updated', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          setLastEventTime(new Date());
          callbacksRef.current.onChannelUpdated?.(payload);
          callbacksRef.current.onAnyEvent?.(payload);
        } catch (err) {
          clientLogger.error('useRealtime', 'Could not handle channel.updated event', { err, data: e.data });
        }
      });

      // 7. Permissions Updated Event
      es.addEventListener('permissions.updated', () => {
        try {
          refreshDbUser?.();
        } catch {}
      });

      // 7. Template Status Event (Meta approved, rejected, paused or disabled a template)
      es.addEventListener('template.status', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          setLastEventTime(new Date());
          callbacksRef.current.onTemplateStatus?.(payload);
          callbacksRef.current.onAnyEvent?.(payload);
        } catch (err) {
          clientLogger.error('useRealtime', 'Could not handle template.status event', { err, data: e.data });
        }
      });

      // Generic Message Handler fallback
      es.onmessage = (e: MessageEvent) => {
        if (!e.data || e.data.startsWith(':')) return; // Ignore SSE comments/ping
        try {
          const payload = JSON.parse(e.data);
          setLastEventTime(new Date());
          if (payload.type === 'message.new') {
            callbacksRef.current.onMessageNew?.(payload);
          } else if (payload.type === 'message.status') {
            callbacksRef.current.onMessageStatus?.(payload);
          } else if (payload.type === 'message.reaction') {
            callbacksRef.current.onMessageReaction?.(payload);
          } else if (payload.type === 'notification.count') {
            callbacksRef.current.onNotificationCount?.(payload);
          } else if (payload.type === 'conversation.updated') {
            callbacksRef.current.onConversationUpdated?.(payload);
          } else if (payload.type === 'channel.updated') {
            callbacksRef.current.onChannelUpdated?.(payload);
          } else if (payload.type === 'permissions.updated') {
            refreshDbUser?.();
          } else if (payload.type === 'template.status') {
            callbacksRef.current.onTemplateStatus?.(payload);
          }
          callbacksRef.current.onAnyEvent?.(payload);
        } catch {}
      };

      es.onerror = (err) => {
        setStatus('error');
        es.close();
        eventSourceRef.current = null;

        // Exponential backoff reconnect: min 2s, max 15s
        const backoff = Math.min(1000 * Math.pow(1.5, reconnectAttempts.current) + Math.random() * 1000, 15000);
        reconnectAttempts.current += 1;
        clientLogger.warn('useRealtime', `Live updates disconnected — reconnecting in ${Math.round(backoff / 1000)}s`, {
          attempt: reconnectAttempts.current,
        });

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, backoff);
      };
    } catch (err) {
      clientLogger.error('useRealtime', 'Failed to open live updates connection', err);
      setStatus('error');
    }
  }, [enabled, user, getIdToken]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setStatus('disconnected');
    };
  }, [connect]);

  return {
    status,
    isConnected: status === 'connected',
    lastEventTime,
    reconnect: connect,
  };
}
