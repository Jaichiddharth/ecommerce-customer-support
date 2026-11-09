'use client';

import React, { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  addEdge,
  reconnectEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ConnectionLineType,
  type Connection,
  type Node,
  type Edge,
  type OnConnect,
  type OnReconnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './automation-builder.css';

import { NODE_TYPES } from './AutomationNode';
import { EDGE_TYPES } from './AutomationEdge';
import { FlowPalette } from './FlowPalette';
import { ConfigPanel } from './ConfigPanel';
import { NodePicker } from './NodePicker';
import { BuilderHeader } from './BuilderHeader';
import { CanvasControls } from './CanvasControls';
import { DRAG_TYPE } from './NodeCatalogList';
import { BuilderContext, type BuilderActions, type PickerRequest } from './builder-context';
import { themeOf } from './palette-config';
import {
  NODE_WIDTH, appendAfter, createNode, freeHandles, insertOnEdge, newEdgeId, styleEdge,
} from './graph-ops';
import type { AutomationNodeData, WorkflowGraph } from './flow-types';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { toApiError } from '@/lib/api/api-error';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { nodeConfigIssues, validateAutomation, type AutomationIssue } from '@/lib/automation/validate';
import { AutomationIssuesPanel, type IssuesIntent } from './AutomationIssuesPanel';

// ─── Constants ────────────────────────────────────────────────────────────────

// Before automations were stored per workspace, the builder kept one graph in this browser.
// It is only read now so the listing can offer a one-time import (see loadLegacyBrowserAutomation).
const STORAGE_KEY = 'unocx_flow_graph';
const SERVER_ID_KEY = 'unocx_flow_automation_id';

/** Undo steps kept in memory. */
const HISTORY_LIMIT = 50;

/** Strips React Flow UI state (and the builder's `_` render fields) so only the graph the runtime needs is sent. */
const toServerGraph = (nodes: Node[], edges: Edge[]) => ({
  nodes: nodes.map(({ id, type, position, data }) => ({
    id,
    type,
    position,
    data: Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !k.startsWith('_'))),
  })),
  edges: edges.map(({ id, source, target, sourceHandle, targetHandle, label }) => ({
    id, source, target, sourceHandle, targetHandle, label: typeof label === 'string' ? label : undefined,
  })),
});

// ─── Default demo graph ───────────────────────────────────────────────────────

const INITIAL_NODES: Node[] = [
  {
    id: 'n1',
    type: 'trigger_incoming_message',
    position: { x: 352, y: 48 },
    data: { type: 'trigger_incoming_message', label: 'Incoming Message', configured: true },
  },
  {
    id: 'n2',
    type: 'condition_if_else',
    position: { x: 352, y: 208 },
    data: {
      type: 'condition_if_else',
      label: 'Check Keyword',
      attribute: 'message',
      operator: 'contains',
      value: 'help',
      configured: true,
    },
  },
  {
    id: 'n3',
    type: 'action_send_message',
    position: { x: 176, y: 400 },
    data: {
      type: 'action_send_message',
      label: 'Send Auto-Reply',
      messageContent: 'Hello! How can we help you today?',
      configured: true,
    },
  },
  {
    id: 'n4',
    type: 'action_assign_conversation',
    position: { x: 528, y: 400 },
    data: {
      type: 'action_assign_conversation',
      label: 'Assign to Support',
      assignTo: 'support',
      configured: true,
    },
  },
  {
    id: 'n5',
    type: 'flow_end',
    position: { x: 352, y: 576 },
    data: { type: 'flow_end', label: 'End Workflow' },
  },
];

const INITIAL_EDGES: Edge[] = [
  { id: 'e1', source: 'n1', target: 'n2' },
  { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'true' },
  { id: 'e3', source: 'n2', target: 'n4', sourceHandle: 'false' },
  { id: 'e4', source: 'n3', target: 'n5' },
  { id: 'e5', source: 'n4', target: 'n5' },
].map(styleEdge);

/** Starting canvas for a new automation: a single trigger to build from. */
const NEW_AUTOMATION_NODES: Node[] = [
  {
    id: 'n1',
    type: 'trigger_incoming_message',
    position: { x: 352, y: 80 },
    data: { type: 'trigger_incoming_message', label: 'Incoming Message', configured: true },
  },
];

// ─── Persistence helpers ──────────────────────────────────────────────────────

function loadSaved(): { nodes: Node[]; edges: Edge[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const g: WorkflowGraph = JSON.parse(raw);
    if (!g.nodes?.length) return null;
    return { nodes: g.nodes as unknown as Node[], edges: g.edges as unknown as Edge[] };
  } catch {
    return null;
  }
}

/**
 * The graph saved in this browser by the earlier single-automation builder, if it was never
 * stored in the workspace. Returned once so the listing can import it.
 */
export function loadLegacyBrowserAutomation(): { nodes: Node[]; edges: Edge[] } | null {
  try {
    if (localStorage.getItem(SERVER_ID_KEY)) return null; // already saved to the workspace
  } catch {
    return null;
  }
  return loadSaved();
}

export function forgetLegacyBrowserAutomation() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SERVER_ID_KEY);
  } catch { /* ignore */ }
}

export { toServerGraph };

/** Issues the server returned with a VALIDATION_ERROR (activation checks that need the database). */
function readServerIssues(raw: unknown): AutomationIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((i): AutomationIssue[] => {
    if (typeof i === 'string') return [{ nodeId: null, message: i }];
    if (i && typeof i === 'object' && typeof (i as AutomationIssue).message === 'string') {
      const { nodeId, nodeLabel, message } = i as AutomationIssue;
      return [{ nodeId: typeof nodeId === 'string' ? nodeId : null, nodeLabel, message }];
    }
    return [];
  });
}

const isEditableTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

interface LoadedAutomation {
  id: number | null;
  name: string;
  description: string;
  isActive: boolean;
  archived: boolean;
  nodes: Node[];
  edges: Edge[];
}

interface FlowViewProps {
  /** Automation to open, or null to create a new one. */
  automationId: number | null;
  /** New automations only: an empty canvas with a trigger, or the example workflow. */
  startFrom?: 'blank' | 'example';
  onBack: () => void;
  /** Called after the first save of a new automation. */
  onCreated?: (id: number) => void;
}

interface Snapshot {
  nodes: Node[];
  edges: Edge[];
}

// ─── Inner component (has access to useReactFlow hook) ────────────────────────

function FlowEditor({ initial, onBack, onCreated }: { initial: LoadedAutomation } & Omit<FlowViewProps, 'automationId'>) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const lastSaved = useRef({ nodes: initial.nodes, edges: initial.edges });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const reconnectSuccessful = useRef(true);
  const [serverId, setServerId] = useState<number | null>(initial.id);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [syncing, setSyncing] = useState(false);

  // ── Layout state ───────────────────────────────────────────────────────
  const [minimap, setMinimap] = useState(initial.nodes.length > 8);
  const [picker, setPicker] = useState<{ request: PickerRequest; anchor: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState(false);

  // The canvas is free-form: steps are shown and saved where the user placed them
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // ── Validation: checked live, enforced on Save / Activate ──────────────
  const clientIssues = useMemo(
    () => validateAutomation({ name, nodes: nodes, edges }),
    [name, nodes, edges],
  );
  /** Issues only the server can detect (Flow not published, template not approved), from the last attempt. */
  const [serverIssues, setServerIssues] = useState<AutomationIssue[]>([]);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [issuesIntent, setIssuesIntent] = useState<IssuesIntent>(null);
  /** After the first blocked attempt, steps with issues stay marked on the canvas. */
  const [markIssues, setMarkIssues] = useState(false);

  const issues = useMemo(() => {
    const seen = new Set(clientIssues.map((i) => `${i.nodeId}|${i.message}`));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const extra = serverIssues.filter(
      (i) => (i.nodeId === null || nodeIds.has(i.nodeId)) && !seen.has(`${i.nodeId}|${i.message}`),
    );
    return [...clientIssues, ...extra];
  }, [clientIssues, serverIssues, nodes]);

  const showIssues = useCallback((intent: IssuesIntent) => {
    setIssuesIntent(intent);
    setIssuesOpen(true);
    setMarkIssues(true);
  }, []);

  /**
   * Saves the graph to the server. 'activate' also switches it on (the server re-validates and adds
   * its own checks); 'pause' switches it off. Returns false when it was blocked or failed.
   */
  const syncToServer = useCallback(
    async (mode: 'save' | 'activate' | 'pause') => {
      // Pausing must always work: with unfixed issues only the switch is sent, edits stay unsaved
      const saveGraph = mode !== 'pause' || clientIssues.length === 0;
      if (!saveGraph && !serverId) return false;
      setSyncing(true);
      setServerIssues([]);
      try {
        const body = saveGraph
          ? {
              name: name.trim(),
              description: description.trim() || null,
              graph: toServerGraph(nodes, edges),
              ...(mode === 'save' ? {} : { isActive: mode === 'activate' }),
            }
          : { isActive: false };
        const res = serverId
          ? await apiClient.put(`/api/automations/${serverId}`, body)
          : await apiClient.post('/api/automations', body);
        const saved = res.data?.automation;
        if (saved?.id && saved.id !== serverId) {
          setServerId(saved.id);
          onCreated?.(saved.id);
        }
        setIsActive(!!saved?.isActive);
        if (saveGraph) {
          lastSaved.current = { nodes: nodes, edges };
          setIsDirty(false);
          setIssuesOpen(false);
        }
        return true;
      } catch (err) {
        const apiError = toApiError(err);
        const fromServer = apiError.code === 'VALIDATION_ERROR' ? readServerIssues(apiError.details?.issues) : [];
        if (fromServer.length) {
          setServerIssues(fromServer);
          showIssues(mode === 'activate' ? 'activate' : 'save');
          return false;
        }
        notifyError(err, {
          where: 'FlowView.syncToServer',
          title: mode === 'activate' ? "Automation can't be activated" : mode === 'pause' ? "Automation wasn't paused" : "Automation wasn't saved",
        });
        return false;
      } finally {
        setSyncing(false);
      }
    },
    [nodes, edges, serverId, name, description, onCreated, clientIssues.length, showIssues],
  );

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, flowToScreenPosition, fitView, setCenter, getZoom, deleteElements } = useReactFlow();

  // ── Undo / redo (snapshots of the graph taken before each edit) ────────
  const [history, setHistory] = useState<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });

  /** Call before changing the graph: records the current state for Undo and marks the automation unsaved. */
  const snapshot = useCallback(() => {
    setHistory((h) => ({ past: [...h.past.slice(-(HISTORY_LIMIT - 1)), { nodes, edges }], future: [] }));
    setIsDirty(true);
  }, [nodes, edges]);

  const restore = useCallback(
    (s: Snapshot) => {
      setNodes(s.nodes);
      setEdges(s.edges);
      setSelectedNodeId(null);
      setServerIssues([]);
      setIsDirty(true);
    },
    [setNodes, setEdges],
  );

  const undo = useCallback(() => {
    const prev = history.past.at(-1);
    if (!prev) return;
    setHistory({ past: history.past.slice(0, -1), future: [{ nodes, edges }, ...history.future] });
    restore(prev);
  }, [history, nodes, edges, restore]);

  const redo = useCallback(() => {
    const [next, ...rest] = history.future;
    if (!next) return;
    setHistory({ past: [...history.past, { nodes, edges }], future: rest });
    restore(next);
  }, [history, nodes, edges, restore]);

  // ── isValidConnection ──────────────────────────────────────────────────
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      const { source, target, sourceHandle } = connection;
      // No self-loops
      if (source === target) return false;

      const sourceNode = nodes.find((n) => n.id === source);
      const targetNode = nodes.find((n) => n.id === target);
      if (!sourceNode || !targetNode) return false;

      const sourceType = String((sourceNode.data as Record<string, unknown>).type ?? '');
      const targetType = String((targetNode.data as Record<string, unknown>).type ?? '');

      // End nodes cannot have outgoing connections
      if (sourceType === 'flow_end') return false;

      // Triggers cannot receive connections (no incoming)
      if (targetType.startsWith('trigger_')) return false;

      // Each TRUE/FALSE handle may only have one outgoing edge
      if (sourceHandle === 'true' || sourceHandle === 'false') {
        const alreadyUsed = edges.some(
          (e) => e.source === source && e.sourceHandle === sourceHandle,
        );
        if (alreadyUsed) return false;
      }

      return true;
    },
    [nodes, edges],
  );

  // ── Connect ────────────────────────────────────────────────────────────
  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      snapshot();
      setEdges((eds) => addEdge(styleEdge({ ...params, id: newEdgeId() }), eds));
    },
    [setEdges, snapshot],
  );

  // ── Reconnect (retarget an existing edge) ──────────────────────────────
  const onReconnectStart = useCallback(() => {
    reconnectSuccessful.current = false;
    snapshot();
  }, [snapshot]);

  const onReconnect: OnReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      reconnectSuccessful.current = true;
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds).map(styleEdge));
    },
    [setEdges],
  );

  const onReconnectEnd = useCallback(
    (_: MouseEvent | TouchEvent, edge: Edge) => {
      // If drag ended without a valid target, remove the dangling edge
      if (!reconnectSuccessful.current) {
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      }
      reconnectSuccessful.current = true;
    },
    [setEdges],
  );

  // ── Adding steps ───────────────────────────────────────────────────────

  /** Scrolls a step into view (keeping the zoom) when it is off-screen; uses its laid-out position. */
  const ensureVisible = useCallback(
    (id: string) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      const node = nodesRef.current.find((n) => n.id === id);
      if (!rect || !node) return;
      const tl = flowToScreenPosition(node.position);
      const br = flowToScreenPosition({ x: node.position.x + NODE_WIDTH, y: node.position.y + 120 });
      if (tl.x < rect.left || tl.y < rect.top || br.x > rect.right || br.y > rect.bottom) {
        setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + 60, { zoom: getZoom(), duration: 300 });
      }
    },
    [flowToScreenPosition, setCenter, getZoom],
  );

  /** After a step is added: open its settings when it still needs setting up. */
  const afterAdd = useCallback(
    (node: Node) => {
      const data = node.data as AutomationNodeData;
      setSelectedNodeId(nodeConfigIssues(data.type, data).length ? node.id : null);
      // After the next render, when the step is on the canvas
      setTimeout(() => ensureVisible(node.id), 60);
    },
    [ensureVisible],
  );

  /** Free placement: centre of the visible canvas, nudged so repeated adds don't stack exactly. */
  const addFree = useCallback(
    (type: string) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      const center = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 0, y: 0 };
      const nudge = (nodes.length % 5) * 24;
      const node = createNode(type, { x: center.x - NODE_WIDTH / 2 + nudge, y: center.y - 50 + nudge });
      snapshot();
      setNodes((nds) => nds.concat(node));
      afterAdd(node);
    },
    [nodes.length, screenToFlowPosition, setNodes, snapshot, afterAdd],
  );

  const onPick = useCallback(
    (type: string) => {
      const req = picker?.request;
      setPicker(null);
      if (!req) return;
      if (req.kind === 'free' || req.kind === 'start') return addFree(type);

      const result =
        req.kind === 'insert'
          ? (() => {
              const edge = edges.find((e) => e.id === req.edgeId);
              return edge ? insertOnEdge(nodes, edges, edge, type) : null;
            })()
          : appendAfter(nodes, edges, req.sourceId, req.handle, type);
      if (!result) return;
      snapshot();
      setNodes(result.nodes);
      setEdges(result.edges);
      afterAdd(result.node);
    },
    [picker, nodes, edges, addFree, snapshot, setNodes, setEdges, afterAdd],
  );

  // ── Drag from toolbox ──────────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(DRAG_TYPE);
      if (!type) return;
      const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // Drop point is the top-centre of the card
      const node = createNode(type, { x: at.x - NODE_WIDTH / 2, y: at.y - 20 });
      snapshot();
      setNodes((nds) => nds.concat(node));
      afterAdd(node);
    },
    [screenToFlowPosition, setNodes, snapshot, afterAdd],
  );

  // ── Update node data ───────────────────────────────────────────────────
  const onUpdateNodeData = useCallback(
    (id: string, updatedData: Partial<AutomationNodeData>) => {
      snapshot();
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...updatedData } } : n,
        ),
      );
      // The server re-checks this step on the next attempt
      setServerIssues((prev) => prev.filter((i) => i.nodeId !== id));
    },
    [setNodes, snapshot],
  );

  // ── Delete (keyboard, node toolbar, properties panel, edge button) ────
  const onBeforeDelete = useCallback(
    async ({ nodes: removed }: { nodes: Node[]; edges: Edge[] }) => {
      snapshot();
      if (removed.some((n) => n.id === selectedNodeId)) setSelectedNodeId(null);
      return true;
    },
    [snapshot, selectedNodeId],
  );

  const onDeleteNode = useCallback(
    (id: string) => {
      deleteElements({ nodes: [{ id }] });
      setSelectedNodeId(null);
    },
    [deleteElements],
  );

  // ── Save ───────────────────────────────────────────────────────────────
  const onSave = useCallback(async () => {
    if (syncing) return;
    if (clientIssues.length) return showIssues('save');
    if (await syncToServer('save')) gooeyToast.success('Automation saved');
  }, [syncing, clientIssues.length, showIssues, syncToServer]);

  /** Activation is only offered for a saved automation with no unsaved changes and no issues. */
  const canActivate = serverId !== null && !isDirty && issues.length === 0;
  const activateBlockedReason = serverId === null
    ? 'Save this automation first'
    : isDirty
      ? 'Save your changes first'
      : issues.length
        ? `Fix ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} first`
        : null;

  const onActivate = useCallback(async () => {
    if (syncing || !canActivate) return;
    if (await syncToServer('activate')) {
      gooeyToast.success('Automation activated', { description: 'It now runs on matching incoming messages.' });
    }
  }, [syncing, canActivate, syncToServer]);

  const onPause = useCallback(async () => {
    if (syncing) return;
    const keptEdits = clientIssues.length > 0 && isDirty;
    if (await syncToServer('pause')) {
      gooeyToast.success('Automation paused', {
        description: keptEdits ? 'Your edits have issues, so they were not saved. Fix them and save when ready.' : undefined,
      });
    }
  }, [syncing, clientIssues.length, isDirty, syncToServer]);

  // ── Jump to a step from the issues list ────────────────────────────────
  const focusNode = useCallback(
    (id: string) => {
      setSelectedNodeId(id);
      fitView({ nodes: [{ id }], duration: 400, padding: 0.8, maxZoom: 1.2 });
    },
    [fitView],
  );

  // ── Discard (back to the last saved version; undoable) ─────────────────
  const onDiscard = useCallback(() => {
    snapshot();
    setNodes(lastSaved.current.nodes);
    setEdges(lastSaved.current.edges);
    setSelectedNodeId(null);
    setIsDirty(false);
    setServerIssues([]);
  }, [setNodes, setEdges, snapshot]);

  // ── Import / export ────────────────────────────────────────────────────
  const onExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(toServerGraph(nodes, edges), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.trim().replace(/[^\w-]+/g, '-').toLowerCase() || 'automation'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, name]);

  const onImport = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const g = JSON.parse(ev.target?.result as string);
          if (!Array.isArray(g.nodes)) throw new Error('No steps in this file');
          snapshot();
          setNodes(g.nodes);
          setEdges(Array.isArray(g.edges) ? g.edges.map(styleEdge) : []);
          setSelectedNodeId(null);
          requestAnimationFrame(() => fitView({ padding: 0.25, duration: 300 }));
          gooeyToast.success('Automation imported', { description: 'Review it, then save to keep it.' });
        } catch {
          gooeyToast.error("Couldn't import that file", { description: 'Choose a JSON file exported from the Automation Builder.' });
        }
      };
      reader.readAsText(file);
    },
    [snapshot, setNodes, setEdges, fitView],
  );

  // ── Back navigation and leaving the page ───────────────────────────────
  const onBackClick = useCallback(() => {
    if (!isDirty || window.confirm('You have unsaved changes. Leave without saving?')) onBack();
  }, [isDirty, onBack]);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        onSave();
      } else if (!isEditableTarget(e.target) && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSave, undo, redo]);

  // ── Render data ────────────────────────────────────────────────────────
  const issuesByNode = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!markIssues) return map;
    for (const i of issues) if (i.nodeId) map.set(i.nodeId, [...(map.get(i.nodeId) ?? []), i.message]);
    return map;
  }, [issues, markIssues]);

  const enrichedNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          _issues: issuesByNode.get(n.id),
          _active: n.id === selectedNodeId,
          _free: freeHandles(n, edges),
        },
      })),
    [nodes, edges, issuesByNode, selectedNodeId],
  );

  const actions = useMemo<BuilderActions>(
    () => ({
      openNode: setSelectedNodeId,
      deleteNode: onDeleteNode,
      deleteEdge: (id) => deleteElements({ edges: [{ id }] }),
      openPicker: (request, anchor) => setPicker({ request, anchor }),
    }),
    [onDeleteNode, deleteElements],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  /** Steps can be dragged anywhere on the canvas; each drag is one undo step. */
  const onNodeDragStart = useCallback(() => {
    snapshot();
    setDragging(true);
  }, [snapshot]);

  return (
    <BuilderContext.Provider value={actions}>
      <div className="flex flex-col h-full w-full overflow-hidden bg-white">
        <BuilderHeader
          name={name}
          onNameChange={(v) => { setName(v); setIsDirty(true); }}
          description={description}
          onDescriptionChange={(v) => { setDescription(v); setIsDirty(true); }}
          isNew={serverId === null}
          isActive={isActive}
          isDirty={isDirty}
          syncing={syncing}
          issueCount={issues.length}
          issuesOpen={issuesOpen}
          onToggleIssues={() => (issuesOpen ? setIssuesOpen(false) : showIssues(null))}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={undo}
          onRedo={redo}
          onSave={onSave}
          onActivate={onActivate}
          activateBlockedReason={activateBlockedReason}
          onPause={onPause}
          onBack={onBackClick}
          onExport={onExport}
          onImport={onImport}
          onDiscard={onDiscard}
        />

        <div className="flex-1 flex overflow-hidden relative">
          <FlowPalette />

          {/* Canvas */}
          <div
            ref={wrapperRef}
            className={`af-canvas flex-1 relative bg-[#f6f7fb] ${dragging ? 'af-dragging' : ''}`}
            onDrop={onDrop}
            onDragOver={onDragOver}
          >
            {issuesOpen && (
              <AutomationIssuesPanel
                issues={issues}
                intent={issuesIntent === 'activate' && !canActivate ? 'save' : issuesIntent}
                onSelectNode={focusNode}
                onClose={() => setIssuesOpen(false)}
                onProceed={issuesIntent === 'activate' && canActivate ? onActivate : onSave}
                busy={syncing}
              />
            )}

            <ReactFlow
              nodes={enrichedNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onReconnect={onReconnect}
              onReconnectStart={onReconnectStart}
              onReconnectEnd={onReconnectEnd}
              onBeforeDelete={onBeforeDelete}
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={() => setDragging(false)}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              connectionLineType={ConnectionLineType.SmoothStep}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={2}
              deleteKeyCode={['Delete', 'Backspace']}
              multiSelectionKeyCode="Shift"
              connectionRadius={40}
              snapToGrid
              snapGrid={[16, 16]}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="#d5dae6" />
              <CanvasControls minimap={minimap} onToggleMinimap={() => setMinimap((m) => !m)} />
              {minimap && (
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(n) => themeOf(String((n.data as AutomationNodeData).type ?? '')).accent}
                  nodeBorderRadius={6}
                  maskColor="rgba(241,245,249,0.7)"
                  className="!rounded-xl !border !border-slate-200 !shadow-sm !m-3"
                />
              )}
            </ReactFlow>
          </div>

          {/* Properties panel */}
          {selectedNode && (
            <ConfigPanel
              key={selectedNode.id}
              nodeId={selectedNode.id}
              data={selectedNode.data as AutomationNodeData}
              issues={issuesByNode.get(selectedNode.id)}
              onUpdate={onUpdateNodeData}
              onClose={() => setSelectedNodeId(null)}
              onDelete={onDeleteNode}
            />
          )}
        </div>

        {picker && (
          <NodePicker request={picker.request} anchor={picker.anchor} onPick={onPick} onClose={() => setPicker(null)} />
        )}
      </div>
    </BuilderContext.Provider>
  );
}

// ─── Public export (wraps FlowEditor in ReactFlowProvider) ───────────────────

export default function FlowView({ automationId, startFrom = 'blank', onBack, onCreated }: FlowViewProps) {
  const [loaded, setLoaded] = useState<LoadedAutomation | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    if (automationId === null) {
      const example = startFrom === 'example';
      setLoaded({
        id: null,
        name: example ? 'Keyword help desk' : 'Untitled automation',
        description: '',
        isActive: false,
        archived: false,
        nodes: example ? INITIAL_NODES : NEW_AUTOMATION_NODES,
        edges: example ? INITIAL_EDGES : [],
      });
      return;
    }
    try {
      const a = (await apiClient.get(`/api/automations/${automationId}`)).data.automation;
      setLoaded({
        id: a.id,
        name: a.name,
        description: a.description ?? '',
        isActive: !!a.isActive,
        archived: !!a.archivedAt,
        // Saved nodes/edges carry their full builder data, so they open exactly as configured
        nodes: (a.graph?.nodes ?? []) as Node[],
        edges: ((a.graph?.edges ?? []) as Edge[]).map(styleEdge),
      });
    } catch (err) {
      setError(err);
    }
  }, [automationId, startFrom]);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} title="Couldn't open this automation" onRetry={load} className="h-full" />;
  if (!loaded) return <LoadingState label="Opening automation…" className="h-full" />;
  if (loaded.archived) {
    return (
      <EmptyState
        className="h-full"
        title="This automation is archived"
        description="Restore it from the automations list to edit or activate it."
        action={
          <button onClick={onBack} className="text-[12px] font-semibold text-white bg-[#3440a8] hover:bg-[#2a3490] px-3.5 py-2 rounded-lg">
            Back to automations
          </button>
        }
      />
    );
  }

  return (
    <ReactFlowProvider>
      <FlowEditor initial={loaded} onBack={onBack} onCreated={onCreated} />
    </ReactFlowProvider>
  );
}
