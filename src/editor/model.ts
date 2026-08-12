export type DocumentId = string;
export type PageId = string;
export type FrameId = string;
export type NodeId = string;

import type { ToolId } from "./tools";

/** `pan` remains accepted for state compatibility with the initial editor slice. */
export type ActiveTool = ToolId | "pan";
export type EditorNodeKind = "element" | "text" | "component";

export interface DocumentEntity {
  id: DocumentId;
  name: string;
  srcDoc: string;
  revision: number;
  rootNodeIds: NodeId[];
  pageIds: PageId[];
}

export interface PageEntity {
  id: PageId;
  documentId: DocumentId;
  name: string;
  frameIds: FrameId[];
}

export interface FrameEntity {
  id: FrameId;
  pageId: PageId;
  documentId: DocumentId;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  background: string;
}

export interface NodeEntity {
  id: NodeId;
  documentId: DocumentId;
  parentId: NodeId | null;
  kind: EditorNodeKind;
  name: string;
  tagName?: string;
  attributes: Record<string, string>;
  childIds: NodeId[];
  locked?: boolean;
  hidden?: boolean;
  frameId?: FrameId;
}

export interface SelectionState {
  frameIds: FrameId[];
  nodeIds: NodeId[];
  primaryFrameId: FrameId | null;
  primaryNodeId: NodeId | null;
}

export interface EditorState {
  documents: Record<DocumentId, DocumentEntity>;
  pages: Record<PageId, PageEntity>;
  frames: Record<FrameId, FrameEntity>;
  nodes: Record<NodeId, NodeEntity>;
  activePageId: PageId | null;
  selection: SelectionState;
  activeTool: ActiveTool;
}

/**
 * Compatibility input for the current iframe-backed frame representation.
 * `srcDoc` is normalized into the owning document when state is created.
 */
export interface FrameSeed {
  id: FrameId;
  name: string;
  documentId: DocumentId;
  pageId?: PageId;
  documentName?: string;
  pageName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  srcDoc: string;
  background: string;
}

/** Render-facing frame shape retained for iframe and canvas compatibility. */
export interface FrameRenderModel extends FrameEntity {
  srcDoc: string;
}

export interface CreateEditorStateOptions {
  defaultPageId?: PageId;
  defaultPageName?: string;
  defaultDocumentName?: string;
}

export function createEmptySelection(): SelectionState {
  return {
    frameIds: [],
    nodeIds: [],
    primaryFrameId: null,
    primaryNodeId: null,
  };
}

export function createEmptyEditorState(): EditorState {
  return {
    documents: {},
    pages: {},
    frames: {},
    nodes: {},
    activePageId: null,
    selection: createEmptySelection(),
    activeTool: "select",
  };
}

/** Builds normalized state from the existing flat iframe frame seeds. */
export function createEditorStateFromFrameSeeds(
  seeds: readonly FrameSeed[],
  options: CreateEditorStateOptions = {},
): EditorState {
  const state = createEmptyEditorState();
  const defaultPageId = options.defaultPageId ?? "page-1";
  const defaultPageName = options.defaultPageName ?? "Page 1";
  const defaultDocumentName = options.defaultDocumentName;

  for (const seed of seeds) {
    if (state.frames[seed.id]) {
      throw new Error(`Duplicate frame id: ${seed.id}`);
    }

    const pageId = seed.pageId ?? defaultPageId;
    const document = state.documents[seed.documentId];
    if (!document) {
      state.documents[seed.documentId] = {
        id: seed.documentId,
        name: seed.documentName ?? defaultDocumentName ?? seed.documentId,
        srcDoc: seed.srcDoc,
        revision: 1,
        rootNodeIds: [],
        pageIds: [],
      };
    } else if (document.srcDoc !== seed.srcDoc) {
      throw new Error(
        `Document ${seed.documentId} has inconsistent iframe source documents`,
      );
    }

    const page = state.pages[pageId];
    if (!page) {
      state.pages[pageId] = {
        id: pageId,
        documentId: seed.documentId,
        name: seed.pageName ?? defaultPageName,
        frameIds: [],
      };
      state.documents[seed.documentId].pageIds.push(pageId);
    } else if (page.documentId !== seed.documentId) {
      throw new Error(`Page ${pageId} belongs to another document`);
    }

    state.frames[seed.id] = {
      id: seed.id,
      pageId,
      documentId: seed.documentId,
      name: seed.name,
      x: seed.x,
      y: seed.y,
      width: seed.width,
      height: seed.height,
      background: seed.background,
    };
    state.pages[pageId].frameIds.push(seed.id);
  }

  const firstFrameId = seeds[0]?.id ?? null;
  state.activePageId = Object.keys(state.pages)[0] ?? null;
  state.selection = firstFrameId
    ? {
        frameIds: [firstFrameId],
        nodeIds: [],
        primaryFrameId: firstFrameId,
        primaryNodeId: null,
      }
    : createEmptySelection();

  return state;
}

export function selectFrameRenderModels(state: EditorState): FrameRenderModel[] {
  return selectAllFrameRenderModels(state)
    .filter((frame) => state.activePageId === null || frame.pageId === state.activePageId);
}

export function selectAllFrameRenderModels(state: EditorState): FrameRenderModel[] {
  return Object.values(state.frames).map((frame) => ({
    ...frame,
    srcDoc: state.documents[frame.documentId]?.srcDoc ?? "",
  }));
}
