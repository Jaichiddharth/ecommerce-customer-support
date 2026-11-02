'use client';

import React, { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  reconnectEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  Panel,
  type Connection,
  type Node,
  type Edge,
  type OnConnect,
  type OnReconnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NODE_TYPES } from './AutomationNode';
import { FlowPalette } from './FlowPalette';
import { ConfigPanel } from './ConfigPanel';
import { PALETTE_ITEMS } from './palette-config';
import type { AutomationNodeData, WorkflowGraph } from './flow-types';
import { Save, RotateCcw, Download, Upload, Maximize2, Zap, Power, Loader2, ArrowLeft } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';

// ─── Constants ────────────────────────────────────────────────────────────────

let nodeIdCounter = 100;
const newId = () => `node_${++nodeIdCounter}`;

const defaultEdgeOptions = {
  animated: false,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
  style: { stroke: '#94a3b8', strokeWidth: 2 },
};

// Before automations were stored per workspace, the builder kept one graph in this browser.
// It is only read now so the listing can offer a one-time import (see loadLegacyBrowserAutomation).
const STORAGE_KEY = 'unocx_flow_graph';
const SERVER_ID_KEY = 'unocx_flow_automation_id';

/** Strips React Flow UI state so only the graph the runtime needs is sent. */
const toServerGraph = (nodes: Node[], edges: Edge[]) => ({
  nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
  edges: edges.map(({ id, source, target, sourceHandle, targetHandle, label }) => ({
    id, source, target, sourceHandle, targetHandle, label: typeof label === 'string' ? label : undefined,
  })),
});

// ─── Default demo graph ───────────────────────────────────────────────────────

const INITIAL_NODES: Node[] = [
  {
    id: 'n1',
    type: 'trigger_incoming_message',
    position: { x: 340, y: 60 },
    data: { type: 'trigger_incoming_message', label: 'Incoming Message', configured: true },
  },
  {
    id: 'n2',
    type: 'condition_if_else',
    position: { x: 260, y: 220 },
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
    position: { x: 60, y: 420 },
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
    position: { x: 460, y: 420 },
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
    position: { x: 260, y: 620 },
    data: { type: 'flow_end', label: 'End Workflow' },
  },
];

const INITIAL_EDGES: Edge[] = [
  {
    id: 'e1',
    source: 'n1',
    target: 'n2',
    ...defaultEdgeOptions,
  },
  {
    id: 'e2',
    source: 'n2',
    target: 'n3',
    sourceHandle: 'true',
    label: 'TRUE',
    style: { stroke: '#16a34a', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#16a34a' },
  },
  {
    id: 'e3',
    source: 'n2',
    target: 'n4',
    sourceHandle: 'false',
    label: 'FALSE',
    style: { stroke: '#dc2626', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#dc2626' },
  },
  { id: 'e4', source: 'n3', target: 'n5', ...defaultEdgeOptions },
  { id: 'e5', source: 'n4', target: 'n5', ...defaultEdgeOptions },
];

/** Starting canvas for a new automation: a single trigger to build from. */
const NEW_AUTOMATION_NODES: Node[] = [
  {
    id: 'n1',
    type: 'trigger_incoming_message',
    position: { x: 340, y: 80 },
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

// ─── Inner component (has access to useReactFlow hook) ────────────────────────

function FlowEditor({ initial, onBack, onCreated }: { initial: LoadedAutomation } & Omit<FlowViewProps, 'automationId'>) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const lastSaved = useRef({ nodes: initial.nodes, edges: initial.edges });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const reconnectSuccessful = useRef(true);
  const [serverId, setServerId] = useState<number | null>(initial.id);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [syncing, setSyncing] = useState(false);

  /** Saves the graph to the server; `activate` also switches it on/off (validated by the server). */
  const syncToServer = useCallback(
    async (activate?: boolean) => {
      setSyncing(true);
      try {
        const body = {
          name: name.trim() || 'Untitled automation',
          description: description.trim() || null,
          graph: toServerGraph(nodes, edges),
          ...(activate !== undefined ? { isActive: activate } : {}),
        };
        const res = serverId
          ? await apiClient.put(`/api/automations/${serverId}`, body)
          : await apiClient.post('/api/automations', body);
        const saved = res.data?.automation;
        if (saved?.id && saved.id !== serverId) {
          setServerId(saved.id);
          onCreated?.(saved.id);
        }
        setIsActive(!!saved?.isActive);
        lastSaved.current = { nodes, edges };
        return true;
      } catch (err) {
        notifyError(err, {
          where: 'FlowView.syncToServer',
          title: activate ? "Automation can't be activated" : "Automation wasn't saved",
        });
        return false;
      } finally {
        setSyncing(false);
      }
    },
    [nodes, edges, serverId, name, description, onCreated],
  );

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, deleteElements } = useReactFlow();

  // ── Show toast briefly ─────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // ── Mark dirty on graph changes (skip first mount) ─────────────────────
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    setIsDirty(true);
  // We intentionally only track node/edge identity, not data:
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, edges.length]);

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
      let style = defaultEdgeOptions.style;
      let label: string | undefined;
      let markerEnd = defaultEdgeOptions.markerEnd;

      if (params.sourceHandle === 'true') {
        style = { stroke: '#16a34a', strokeWidth: 2 };
        label = 'TRUE';
        markerEnd = { type: MarkerType.ArrowClosed, color: '#16a34a', width: 16, height: 16 };
      } else if (params.sourceHandle === 'false') {
        style = { stroke: '#dc2626', strokeWidth: 2 };
        label = 'FALSE';
        markerEnd = { type: MarkerType.ArrowClosed, color: '#dc2626', width: 16, height: 16 };
      }

      setEdges((eds) =>
        addEdge({ ...params, style, label, markerEnd }, eds),
      );
      setIsDirty(true);
    },
    [setEdges],
  );

  // ── Reconnect (retarget an existing edge) ──────────────────────────────
  const onReconnectStart = useCallback(() => {
    reconnectSuccessful.current = false;
  }, []);

  const onReconnect: OnReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      reconnectSuccessful.current = true;
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
      setIsDirty(true);
    },
    [setEdges],
  );

  const onReconnectEnd = useCallback(
    (_: MouseEvent | TouchEvent, edge: Edge) => {
      // If drag ended without a valid target, remove the dangling edge
      if (!reconnectSuccessful.current) {
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
        setIsDirty(true);
      }
      reconnectSuccessful.current = true;
    },
    [setEdges],
  );

  // ── Drag over ──────────────────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  // ── Drop from palette ──────────────────────────────────────────────────
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/reactflow-type');
      const label = e.dataTransfer.getData('application/reactflow-label');
      if (!type) return;

      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      const paletteItem = PALETTE_ITEMS.find((i) => i.type === type);
      const newNode: Node = {
        id: newId(),
        type,
        position,
        data: {
          type,
          label: label || paletteItem?.label || 'New Node',
          configured: false,
        } as AutomationNodeData,
      };

      setNodes((nds) => nds.concat(newNode));
      setSelectedNodeId(newNode.id);
    },
    [screenToFlowPosition, setNodes],
  );

  // ── Update node data ───────────────────────────────────────────────────
  const onUpdateNodeData = useCallback(
    (id: string, updatedData: Partial<AutomationNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...updatedData } } : n,
        ),
      );
    },
    [setNodes],
  );

  // ── Delete node ────────────────────────────────────────────────────────
  const onDeleteNode = useCallback(
    (id: string) => {
      deleteElements({ nodes: [{ id }] });
      setSelectedNodeId(null);
    },
    [deleteElements],
  );

  // ── Save ───────────────────────────────────────────────────────────────
  const onSave = useCallback(async () => {
    if (await syncToServer()) {
      setIsDirty(false);
      showToast('Automation saved');
    }
  }, [showToast, syncToServer]);

  const onToggleActive = useCallback(async () => {
    const next = !isActive;
    if (await syncToServer(next)) {
      setIsDirty(false);
      gooeyToast.success(next ? 'Automation activated' : 'Automation paused', {
        description: next ? 'It now runs on matching incoming messages.' : undefined,
      });
    }
  }, [isActive, syncToServer]);

  // ── Reset (back to the last saved version) ─────────────────────────────
  const onReset = useCallback(() => {
    setNodes(lastSaved.current.nodes);
    setEdges(lastSaved.current.edges);
    setSelectedNodeId(null);
    setIsDirty(false);
  }, [setNodes, setEdges]);

  // ── Keyboard save ──────────────────────────────────────────────────────
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSave]);

  // ── Enrich nodes with _onConfigure callback ────────────────────────────
  const enrichedNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, _onConfigure: setSelectedNodeId },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-slate-800 text-white text-[12px] font-medium px-4 py-2.5 rounded-xl shadow-xl animate-fade-in-up">
          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {toast}
        </div>
      )}

      {/* ── Palette sidebar ───────────────────────────────────────────────── */}
      <FlowPalette />

      {/* ── Canvas column ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="h-12 px-4 bg-white border-b border-slate-200 flex items-center gap-3 shrink-0 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => (!isDirty || window.confirm('You have unsaved changes. Leave without saving?')) && onBack()}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              title="Back to automations"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'}`} />
            <span className="text-[13px] font-semibold text-slate-800 hidden xl:inline">Automation Builder</span>
            <span className="text-[11px] text-slate-400 hidden xl:inline">/</span>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setIsDirty(true); }}
              placeholder="Automation name"
              className="w-44 text-[12px] font-semibold text-slate-700 bg-transparent border border-transparent rounded-lg px-2 py-1 hover:border-slate-200 focus:border-[#3440a8]/40 focus:outline-none"
            />
            <input
              value={description}
              onChange={(e) => { setDescription(e.target.value); setIsDirty(true); }}
              placeholder="Add a description…"
              maxLength={500}
              className="w-56 text-[11px] text-slate-500 bg-transparent border border-transparent rounded-lg px-2 py-1 hover:border-slate-200 focus:border-[#3440a8]/40 focus:outline-none hidden lg:block"
            />
            {isDirty && (
              <span className="text-[10px] font-medium text-amber-500 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
                Unsaved
              </span>
            )}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <button
              onClick={onToggleActive}
              disabled={syncing}
              className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-60 ${
                isActive
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                  : 'text-slate-600 bg-white border-slate-200 hover:bg-slate-50'
              }`}
              title={isActive ? 'Running on incoming messages. Click to pause.' : 'Validate, save and start running this automation'}
            >
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
              {isActive ? 'Active' : 'Activate'}
            </button>
            <button
              onClick={onSave}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-white bg-[#3440a8] hover:bg-[#2a3490] px-3 py-1.5 rounded-lg transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
            <button
              onClick={() => {
                const blob = new Blob(
                  [JSON.stringify({ nodes, edges }, null, 2)],
                  { type: 'application/json' },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'automation-flow.json';
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
              title="Export JSON"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <label
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Import JSON"
            >
              <Upload className="w-3.5 h-3.5" />
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    try {
                      const g = JSON.parse(ev.target?.result as string);
                      if (Array.isArray(g.nodes)) setNodes(g.nodes);
                      if (Array.isArray(g.edges)) setEdges(g.edges);
                    } catch { /* ignore */ }
                  };
                  reader.readAsText(file);
                }}
              />
            </label>
          </div>
        </div>

        {/* Canvas + optional config panel */}
        <div className="flex-1 flex overflow-hidden">
          {/* ReactFlow canvas */}
          <div
            ref={wrapperRef}
            className="flex-1 relative"
            onDrop={onDrop}
            onDragOver={onDragOver}
          >
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
              nodeTypes={NODE_TYPES}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              deleteKeyCode="Delete"
              multiSelectionKeyCode="Shift"
              connectionRadius={40}
              snapToGrid
              snapGrid={[16, 16]}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#e2e8f0" />
              <Controls className="!shadow-sm !border !border-slate-200 !rounded-xl overflow-hidden" />
              <MiniMap
                nodeColor={(n) => {
                  const t = String((n.data as AutomationNodeData).type ?? '');
                  if (t.startsWith('trigger_')) return '#93c5fd';
                  if (t.startsWith('condition_')) return '#fde047';
                  if (t.startsWith('action_')) return '#86efac';
                  return '#d8b4fe';
                }}
                className="!rounded-xl !border !border-slate-200 !shadow-sm"
              />

              {/* Toolbar */}
              <Panel position="top-right">
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-2">
                  <button
                    onClick={() => fitView({ padding: 0.3, duration: 400 })}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    Fit
                  </button>
                  <div className="w-px h-4 bg-slate-200" />
                  <button
                    onClick={onReset}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                </div>
              </Panel>

              {/* Node / edge count */}
              <Panel position="bottom-left">
                <div className="bg-white/80 backdrop-blur-sm border border-slate-200 rounded-xl px-3 py-1.5 flex items-center gap-2 text-[11px] text-slate-500 shadow-sm mb-10">
                  <Zap className="w-3 h-3 text-[#3440a8]" />
                  <span>
                    <strong className="text-slate-700">{nodes.length}</strong> nodes ·{' '}
                    <strong className="text-slate-700">{edges.length}</strong> connections
                  </span>
                </div>
              </Panel>
            </ReactFlow>
          </div>

          {/* Config panel */}
          {selectedNode && (
            <ConfigPanel
              key={selectedNode.id}
              nodeId={selectedNode.id}
              data={selectedNode.data as AutomationNodeData}
              onUpdate={onUpdateNodeData}
              onClose={() => setSelectedNodeId(null)}
              onDelete={onDeleteNode}
            />
          )}
        </div>
      </div>
    </div>
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
        edges: ((a.graph?.edges ?? []) as Edge[]).map((e) => ({
          ...defaultEdgeOptions,
          ...e,
          ...(e.sourceHandle === 'true' ? { style: { stroke: '#16a34a', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#16a34a' } } : {}),
          ...(e.sourceHandle === 'false' ? { style: { stroke: '#dc2626', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#dc2626' } } : {}),
        })),
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
