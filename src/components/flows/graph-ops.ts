import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { AutomationNodeData } from './flow-types';
import { getPaletteItem } from './palette-config';
import { BRANCH_OUTPUTS } from '@/lib/automation/validate';

/**
 * Pure helpers for the builder's graph: edge styling, new nodes and the geometry used when a step
 * is appended or inserted. None of this changes what is saved — the server graph still only carries
 * id/type/position/data for nodes and id/source/target/handles/label for edges (see toServerGraph).
 */

/** Fixed card size so steps line up in columns and rows. */
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 56;
/** Diameter of the End marker. */
export const END_SIZE = 32;
/** Vertical distance between consecutive steps (card + connector with its "+"). */
export const STEP_GAP_Y = 160;
/** Horizontal offset of the True / False branches below a condition. */
export const BRANCH_OFFSET_X = 180;

export const EDGE_COLORS = {
  default: '#8f99ab',
  selected: '#3440a8',
} as const;

/** Named outputs: True/False of If / Else, Replied/Handover of AI Agent Reply (see BRANCH_OUTPUTS). */
export type BranchHandle = 'true' | 'false' | 'replied' | 'handover';

const BRANCH_HANDLES = new Set<string>(['true', 'false', 'replied', 'handover']);
export const isBranchHandle = (h: unknown): h is BranchHandle => typeof h === 'string' && BRANCH_HANDLES.has(h);

/** Readable name of a named output ("True", "Handover"). */
export const branchLabel = (h: BranchHandle) =>
  Object.values(BRANCH_OUTPUTS).flat().find((b) => b.handle === h)?.label ?? h;

/** Named outputs drawn on the left (True, Replied) and on the right (False, Handover). */
const LEFT_BRANCHES = new Set<string>(['true', 'replied']);

export const newNodeId = () => `node_${crypto.randomUUID()}`;
export const newEdgeId = () => `edge_${crypto.randomUUID()}`;

const marker = (color: string) => ({ type: MarkerType.ArrowClosed, width: 14, height: 14, color });

/**
 * Applies the builder's connector look. Lines are neutral (the True/False pill on the connector
 * tells branches apart); True/False edges keep their stored TRUE/FALSE label.
 */
export function styleEdge<E extends Edge>(edge: E): Edge {
  const handle = edge.sourceHandle;
  return {
    ...edge,
    type: 'automation',
    label: isBranchHandle(handle) ? branchLabel(handle).toUpperCase() : edge.label,
    style: { stroke: EDGE_COLORS.default, strokeWidth: 1.5 },
    markerEnd: marker(EDGE_COLORS.default),
  };
}

export function buildEdge(source: string, target: string, sourceHandle: string | null = null): Edge {
  return styleEdge({ id: newEdgeId(), source, target, sourceHandle, targetHandle: null });
}

export function createNode(type: string, position: { x: number; y: number }): Node {
  return {
    id: newNodeId(),
    type,
    position,
    data: { type, label: getPaletteItem(type)?.label ?? 'New step', configured: false } as AutomationNodeData,
  };
}

const typeOf = (n: Node) => String((n.data as Record<string, unknown>)?.type ?? n.type ?? '');

/** Output handles a step type has: null is the single unnamed output. */
export function sourceHandlesOf(type: string): (BranchHandle | null)[] {
  if (type === 'flow_end') return [];
  const branches = BRANCH_OUTPUTS[type];
  if (branches) return branches.map((b) => b.handle as BranchHandle);
  return [null];
}

/** Output handles with nothing connected yet (where a "+" add button is offered). */
export function freeHandles(node: Node, edges: Edge[]): (BranchHandle | null)[] {
  const out = edges.filter((e) => e.source === node.id);
  return sourceHandlesOf(typeOf(node)).filter((h) =>
    h === null ? out.length === 0 : !out.some((e) => e.sourceHandle === h),
  );
}

/** Ids reachable from `startId` along edges (including it), never passing through `stopIds`. */
function downstream(startId: string, edges: Edge[], stopIds: Set<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || stopIds.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.source === id) queue.push(e.target);
  }
  return seen;
}

/**
 * Inserts `newNode` on `edge` (source → new → target). The new step sits one gap below the source;
 * the target and everything after it moves down just enough to keep the spacing.
 */
export function insertOnEdge(nodes: Node[], edges: Edge[], edge: Edge, type: string) {
  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  if (!source || !target) return null;

  const node = createNode(type, {
    x: target.position.x,
    y: source.position.y + STEP_GAP_Y,
  });
  const push = Math.max(0, node.position.y + STEP_GAP_Y - target.position.y);
  const moved = push ? downstream(target.id, edges, new Set([source.id])) : new Set<string>();

  const nextNodes = nodes
    .map((n) => (moved.has(n.id) ? { ...n, position: { ...n.position, y: n.position.y + push } } : n))
    .concat(node);

  // A condition continues on its True path (an AI reply on Replied); an end step has no output to reconnect.
  const outHandle = sourceHandlesOf(type)[0];
  const nextEdges = edges
    .filter((e) => e.id !== edge.id)
    .concat(buildEdge(source.id, node.id, edge.sourceHandle ?? null))
    .concat(outHandle !== undefined ? [buildEdge(node.id, target.id, outHandle)] : []);

  return { nodes: nextNodes, edges: nextEdges, node };
}

/** Adds a step below `sourceId`'s free output `handle` and connects it. */
export function appendAfter(nodes: Node[], edges: Edge[], sourceId: string, handle: string | null, type: string) {
  const source = nodes.find((n) => n.id === sourceId);
  if (!source) return null;
  const dx = !isBranchHandle(handle) ? 0 : LEFT_BRANCHES.has(handle) ? -BRANCH_OFFSET_X : BRANCH_OFFSET_X;
  const node = createNode(type, { x: source.position.x + dx, y: source.position.y + STEP_GAP_Y });
  return {
    nodes: nodes.concat(node),
    edges: edges.concat(buildEdge(source.id, node.id, handle)),
    node,
  };
}
