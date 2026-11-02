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
import { Save, RotateCcw, Download, Upload, Maximize2, Zap } from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

let nodeIdCounter = 100;
const newId = () => `node_${++nodeIdCounter}`;

const defaultEdgeOptions = {
  animated: false,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
  style: { stroke: '#94a3b8', strokeWidth: 2 },
};

const STORAGE_KEY = 'unocx_flow_graph';

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

// ─── Inner component (has access to useReactFlow hook) ────────────────────────

function FlowEditor() {
  const saved = useMemo(() => loadSaved(), []);

  const [nodes, setNodes, onNodesChange] = useNodesState(saved?.nodes ?? INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(saved?.edges ?? INITIAL_EDGES);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const reconnectSuccessful = useRef(true);

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
  const onSave = useCallback(() => {
    const graph: WorkflowGraph = {
      id: 'flow_main',
      name: 'My Automation',
      nodes: nodes as unknown as WorkflowGraph['nodes'],
      edges: edges as unknown as WorkflowGraph['edges'],
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
      setIsDirty(false);
      showToast('Flow saved');
    } catch { /* ignore */ }
  }, [nodes, edges, showToast]);

  // ── Reset ──────────────────────────────────────────────────────────────
  const onReset = useCallback(() => {
    setNodes(INITIAL_NODES);
    setEdges(INITIAL_EDGES);
    setSelectedNodeId(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
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
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[13px] font-semibold text-slate-800">Automation Builder</span>
            <span className="text-[11px] text-slate-400">/ Untitled Flow</span>
            {isDirty && (
              <span className="text-[10px] font-medium text-amber-500 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
                Unsaved
              </span>
            )}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
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

export default function FlowView() {
  return (
    <ReactFlowProvider>
      <FlowEditor />
    </ReactFlowProvider>
  );
}
