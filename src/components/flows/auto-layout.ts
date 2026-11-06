import type { Edge, Node } from '@xyflow/react';
import { NODE_WIDTH, END_SIZE, STEP_GAP_Y } from './graph-ops';

/**
 * Salesforce-style auto-layout: steps flow top-down from each trigger, a condition's True path sits
 * left of its False path, and a step that several paths lead into (a merge) is centred below them.
 *
 * Pure function of the graph — nothing about the connections changes, only positions.
 */

const H_GAP = 56;
/** Room kept for an unconnected True/False output, so the "+" there doesn't collide with the other path. */
const FREE_BRANCH_SLOT = NODE_WIDTH / 2;

const typeOf = (n: Node) => String((n.data as Record<string, unknown>)?.type ?? n.type ?? '');
const widthOf = (n: Node) => (typeOf(n) === 'flow_end' ? END_SIZE : NODE_WIDTH);

/** True path first, single output in the middle, False path last. */
const handleOrder = (h: string | null | undefined) => (h === 'true' ? 0 : h === 'false' ? 2 : 1);

type Kid = { id: string } | { slot: number };

export function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (!nodes.length) return nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const valid = edges.filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target);

  const out = new Map<string, Edge[]>();
  for (const e of valid) out.set(e.source, [...(out.get(e.source) ?? []), e]);
  for (const list of out.values()) list.sort((a, b) => handleOrder(a.sourceHandle) - handleOrder(b.sourceHandle));

  // Roots: triggers left to right, then any step nothing leads into, then whatever is left (cycles)
  const indeg = new Map<string, number>();
  for (const e of valid) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const byPos = (a: Node, b: Node) => a.position.x - b.position.x || a.position.y - b.position.y;
  const triggers = nodes.filter((n) => typeOf(n).startsWith('trigger_')).sort(byPos);
  const orphans = nodes.filter((n) => !typeOf(n).startsWith('trigger_') && !indeg.get(n.id)).sort(byPos);

  // DFS to find forward edges (ignoring the edges that close a loop)
  const state = new Map<string, 'open' | 'done'>();
  const forward: Edge[] = [];
  const order: string[] = [];
  const roots: string[] = [];
  const dfs = (id: string) => {
    state.set(id, 'open');
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.target);
      if (s === 'open') continue; // back edge
      forward.push(e);
      if (!s) dfs(e.target);
    }
    state.set(id, 'done');
    order.push(id);
  };
  for (const n of [...triggers, ...orphans, ...[...nodes].sort(byPos)]) {
    if (!state.has(n.id)) {
      roots.push(n.id);
      dfs(n.id);
    }
  }

  const parents = new Map<string, string[]>();
  const fwdOut = new Map<string, Edge[]>();
  for (const e of forward) {
    parents.set(e.target, [...(parents.get(e.target) ?? []), e.source]);
    fwdOut.set(e.source, [...(fwdOut.get(e.source) ?? []), e]);
  }
  for (const list of fwdOut.values()) list.sort((a, b) => handleOrder(a.sourceHandle) - handleOrder(b.sourceHandle));
  const isMerge = (id: string) => (parents.get(id)?.length ?? 0) > 1;

  // Rank = longest path from a root (reverse post-order is a topological order)
  const rank = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const r = Math.max(0, ...(parents.get(id) ?? []).map((p) => (rank.get(p) ?? 0) + 1));
    rank.set(id, r);
  }

  // Tree children: single-parent targets, plus reserved room for unconnected True/False outputs
  const kidsOf = (id: string): Kid[] => {
    const kids: Kid[] = [];
    const list = fwdOut.get(id) ?? [];
    const branches = typeOf(byId.get(id)!) === 'condition_if_else';
    for (const h of branches ? ['true', 'false'] : [undefined]) {
      const matching = h ? list.filter((e) => e.sourceHandle === h) : list;
      if (h && !list.some((e) => e.sourceHandle === h)) {
        // An unconnected branch only needs room when the other branch is connected
        if (list.length) kids.push({ slot: FREE_BRANCH_SLOT });
        continue;
      }
      for (const e of matching) if (!isMerge(e.target)) kids.push({ id: e.target });
    }
    return kids;
  };

  const widthMemo = new Map<string, number>();
  const kidWidth = (k: Kid): number => ('slot' in k ? k.slot : treeWidth(k.id));
  function treeWidth(id: string): number {
    const cached = widthMemo.get(id);
    if (cached !== undefined) return cached;
    widthMemo.set(id, NODE_WIDTH); // guard against re-entry
    const kids = kidsOf(id);
    const sum = kids.reduce((a, k) => a + kidWidth(k), 0) + H_GAP * Math.max(0, kids.length - 1);
    const w = Math.max(NODE_WIDTH, sum);
    widthMemo.set(id, w);
    return w;
  }

  const center = new Map<string, number>();
  function place(id: string, left: number) {
    const total = treeWidth(id);
    const kids = kidsOf(id);
    if (!kids.length) {
      center.set(id, left + total / 2);
      return;
    }
    const sum = kids.reduce((a, k) => a + kidWidth(k), 0) + H_GAP * (kids.length - 1);
    let cursor = left + (total - sum) / 2;
    const centers: number[] = [];
    for (const k of kids) {
      const w = kidWidth(k);
      if ('id' in k) {
        place(k.id, cursor);
        centers.push(center.get(k.id)!);
      } else {
        centers.push(cursor + w / 2);
      }
      cursor += w + H_GAP;
    }
    center.set(id, (centers[0] + centers[centers.length - 1]) / 2);
  }

  // Each root's tree side by side
  let cursor = 0;
  for (const r of roots) {
    place(r, cursor);
    cursor += treeWidth(r) + H_GAP * 2;
  }

  // Merges, top to bottom: centred under the paths that lead into them
  const merges = nodes.map((n) => n.id).filter(isMerge).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  for (const m of merges) {
    const ps = (parents.get(m) ?? []).map((p) => center.get(p)).filter((c): c is number => c !== undefined);
    const c = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : cursor;
    place(m, c - treeWidth(m) / 2);
  }

  return nodes.map((n) => {
    const c = center.get(n.id) ?? 0;
    const r = rank.get(n.id) ?? 0;
    const position = { x: Math.round(c - widthOf(n) / 2), y: r * STEP_GAP_Y };
    return n.position.x === position.x && n.position.y === position.y ? n : { ...n, position };
  });
}
