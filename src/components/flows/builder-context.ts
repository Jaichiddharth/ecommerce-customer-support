'use client';

import { createContext, useContext } from 'react';

/** Where a step chosen in the node picker goes. */
export type PickerRequest =
  | { kind: 'free' } // anywhere on the canvas, not connected
  | { kind: 'start' } // empty canvas: triggers only
  | { kind: 'append'; sourceId: string; handle: string | null } // after a free output
  | { kind: 'insert'; edgeId: string }; // between two connected steps

/** Actions node and edge components call; provided by FlowView. */
export interface BuilderActions {
  openNode: (id: string) => void;
  deleteNode: (id: string) => void;
  deleteEdge: (id: string) => void;
  openPicker: (request: PickerRequest, anchor: { x: number; y: number }) => void;
}

export const BuilderContext = createContext<BuilderActions | null>(null);

export function useBuilder(): BuilderActions {
  const ctx = useContext(BuilderContext);
  if (!ctx) throw new Error('useBuilder must be used inside the Automation Builder');
  return ctx;
}
