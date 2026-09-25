import {
  createEmptySelection,
  type ActiveTool,
  type DocumentMode,
  type DocumentEntity,
  type EditorState,
  type FrameEntity,
  type NodeEntity,
  type NodeId,
  type PageEntity,
  type SelectionState,
} from "./model";
import {
  applyBrainstormSessionAction,
  BrainstormSessionReducerError,
  type BrainstormSessionAction,
} from "../session/reducer";
import {
  isTokenAlias,
  rewriteTokenCssReference,
  tokenAliasReference,
  tokenAliasTarget,
  TokenValidationError,
  validateToken,
  validateTokenId,
  validateTokenName,
  validateTokenSet,
  validateTokenTheme,
  type TokenStoreState,
  type TokenSet,
  type DesignToken,
  type TokenTheme,
} from "../tokens";

export type EditorAction =
  | { type: "document/create"; document: DocumentEntity }
  | {
      type: "document/replace-html";
      documentId: string;
      expectedRevision: number;
      srcDoc: string;
      mode: DocumentMode;
    }
  | { type: "page/create"; page: PageEntity }
  | { type: "page/rename"; pageId: string; name: string }
  | { type: "page/switch"; pageId: string }
  | { type: "frame/create"; frame: FrameEntity }
  | {
      type: "frame/move";
      frameId: string;
      position: { x: number; y: number };
    }
  | {
      type: "frame/update";
      frameId: string;
      patch: Partial<Pick<FrameEntity, "name" | "width" | "height" | "background">>;
    }
  | { type: "frame/remove"; frameId: string }
  | { type: "node/upsert"; node: NodeEntity }
  | { type: "nodes/upsert-many"; nodes: NodeEntity[] }
  | { type: "node/remove"; nodeId: string }
  | {
      type: "node/update";
      nodeId: string;
      patch: Partial<Pick<NodeEntity, "name" | "locked" | "hidden">>;
    }
  | { type: "node/reorder"; nodeId: string; direction: "up" | "down" }
  | { type: "selection/set"; selection: SelectionState }
  | { type: "tool/set"; tool: ActiveTool }
  | { type: "tokens/upsert-set"; set: TokenSet; expectedRevision?: number }
  | { type: "tokens/remove-set"; setId: string; expectedRevision?: number }
  | { type: "tokens/upsert-token"; setId: string; token: DesignToken; expectedRevision?: number }
  | { type: "tokens/remove-token"; setId: string; tokenId: string; expectedRevision?: number }
  | {
      type: "tokens/rename";
      setId: string;
      tokenId: string;
      name: string;
      expectedRevision?: number;
    }
  | { type: "tokens/upsert-theme"; theme: TokenTheme; expectedRevision?: number }
  | { type: "tokens/remove-theme"; themeId: string; expectedRevision?: number }
  | { type: "tokens/switch-theme"; themeId: string | null; expectedRevision?: number }
  | BrainstormSessionAction;

export type TokenAction = Extract<EditorAction, { type: `tokens/${string}` }>;

export class EditorReducerError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "EditorReducerError";
    this.cause = options.cause;
  }
}

function requireDocument(state: EditorState, documentId: string): DocumentEntity {
  const document = state.documents[documentId];
  if (!document) {
    throw new EditorReducerError(`Unknown document: ${documentId}`);
  }
  return document;
}

function requirePage(state: EditorState, pageId: string): PageEntity {
  const page = state.pages[pageId];
  if (!page) {
    throw new EditorReducerError(`Unknown page: ${pageId}`);
  }
  return page;
}

function requireFrame(state: EditorState, frameId: string): FrameEntity {
  const frame = state.frames[frameId];
  if (!frame) {
    throw new EditorReducerError(`Unknown frame: ${frameId}`);
  }
  return frame;
}

// Moving a node across documents carries its whole subtree — descendants
// left in the old document would fail parent/child ownership checks. Returns
// the input record untouched when nothing needs retargeting.
function retargetSubtreeDocument(
  nodes: Record<NodeId, NodeEntity>,
  rootId: NodeId,
  documentId: string,
): Record<NodeId, NodeEntity> {
  const root = nodes[rootId];
  if (!root) return nodes;
  let out: Record<NodeId, NodeEntity> | null = null;
  const queue = [...root.childIds];
  const seen = new Set<NodeId>([rootId]);
  while (queue.length > 0) {
    const id = queue.pop() as NodeId;
    if (seen.has(id)) continue;
    seen.add(id);
    const child = (out ?? nodes)[id];
    if (!child) continue;
    if (child.documentId !== documentId) {
      out ??= { ...nodes };
      out[id] = { ...child, documentId };
    }
    queue.push(...child.childIds);
  }
  return out ?? nodes;
}

function uniqueExistingIds(
  ids: readonly string[],
  entities: Record<string, unknown>,
): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (seen.has(id) || !entities[id]) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function normalizeSelection(state: EditorState, selection: SelectionState): SelectionState {
  const frameIds = uniqueExistingIds(selection.frameIds, state.frames);
  const nodeIds = uniqueExistingIds(selection.nodeIds, state.nodes);
  const primaryFrameId =
    selection.primaryFrameId && frameIds.includes(selection.primaryFrameId)
      ? selection.primaryFrameId
      : frameIds[0] ?? null;
  const primaryNodeId =
    selection.primaryNodeId && nodeIds.includes(selection.primaryNodeId)
      ? selection.primaryNodeId
      : nodeIds[0] ?? null;

  return { frameIds, nodeIds, primaryFrameId, primaryNodeId };
}

function replaceChildOrder(
  state: EditorState,
  nodeId: string,
  direction: "up" | "down",
): EditorState {
  const node = state.nodes[nodeId];
  if (!node) throw new EditorReducerError(`Unknown node: ${nodeId}`);
  const siblingIds = node.parentId
    ? state.nodes[node.parentId]?.childIds
    : state.documents[node.documentId]?.rootNodeIds;
  if (!siblingIds) throw new EditorReducerError(`Unknown node hierarchy for: ${nodeId}`);
  const index = siblingIds.indexOf(nodeId);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= siblingIds.length) return state;
  const nextIds = [...siblingIds];
  [nextIds[index], nextIds[nextIndex]] = [nextIds[nextIndex], nextIds[index]];
  if (node.parentId) {
    const parent = state.nodes[node.parentId];
    if (!parent) throw new EditorReducerError(`Unknown parent node: ${node.parentId}`);
    return { ...state, nodes: { ...state.nodes, [parent.id]: { ...parent, childIds: nextIds } } };
  }
  const document = state.documents[node.documentId];
  if (!document) throw new EditorReducerError(`Unknown document: ${node.documentId}`);
  return {
    ...state,
    documents: { ...state.documents, [document.id]: { ...document, rootNodeIds: nextIds } },
  };
}

function requireTokenRevision(store: TokenStoreState, expectedRevision: number | undefined): void {
  if (expectedRevision === undefined) return;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new EditorReducerError(`Invalid token revision: ${expectedRevision}`);
  }
  if (store.revision !== expectedRevision) {
    throw new EditorReducerError(
      `Stale token revision: expected ${expectedRevision}, current ${store.revision}`,
    );
  }
}

function validateTokenInput<T>(callback: () => T): T {
  try {
    return callback();
  } catch (error) {
    if (error instanceof TokenValidationError) {
      throw new EditorReducerError(error.message, { cause: error });
    }
    throw error;
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reduceTokenAction(state: EditorState, action: TokenAction): EditorState {
  const store = state.tokens;
  switch (action.type) {
    case "tokens/upsert-set": {
      requireTokenRevision(store, action.expectedRevision);
      const set = validateTokenInput(() => validateTokenSet(action.set, "tokens.set"));
      if (store.sets[set.id] && sameJson(store.sets[set.id], set)) return state;
      return {
        ...state,
        tokens: {
          ...store,
          sets: { ...store.sets, [set.id]: set },
          revision: store.revision + 1,
        },
      };
    }
    case "tokens/remove-set": {
      requireTokenRevision(store, action.expectedRevision);
      const setId = validateTokenInput(() => validateTokenId(action.setId, "tokens.setId"));
      if (!store.sets[setId]) throw new EditorReducerError(`Unknown token set: ${setId}`);
      const usedBy = Object.values(store.themes)
        .filter((theme) => theme.setIds.includes(setId))
        .map((theme) => theme.id);
      if (usedBy.length > 0) {
        throw new EditorReducerError(
          `Token set ${setId} is used by theme(s): ${usedBy.join(", ")}`,
        );
      }
      const { [setId]: _removed, ...sets } = store.sets;
      return { ...state, tokens: { ...store, sets, revision: store.revision + 1 } };
    }
    case "tokens/upsert-token": {
      requireTokenRevision(store, action.expectedRevision);
      const setId = validateTokenInput(() => validateTokenId(action.setId, "tokens.setId"));
      const set = store.sets[setId];
      if (!set) throw new EditorReducerError(`Unknown token set: ${setId}`);
      const token = validateTokenInput(() => validateToken(action.token, "tokens.token"));
      if (set.tokens[token.id] && sameJson(set.tokens[token.id], token)) return state;
      return {
        ...state,
        tokens: {
          ...store,
          sets: { ...store.sets, [setId]: { ...set, tokens: { ...set.tokens, [token.id]: token } } },
          revision: store.revision + 1,
        },
      };
    }
    case "tokens/remove-token": {
      requireTokenRevision(store, action.expectedRevision);
      const setId = validateTokenInput(() => validateTokenId(action.setId, "tokens.setId"));
      const tokenId = validateTokenInput(() => validateTokenId(action.tokenId, "tokens.tokenId"));
      const set = store.sets[setId];
      if (!set) throw new EditorReducerError(`Unknown token set: ${setId}`);
      if (!set.tokens[tokenId]) throw new EditorReducerError(`Unknown token: ${tokenId}`);
      const { [tokenId]: _removed, ...tokens } = set.tokens;
      return {
        ...state,
        tokens: {
          ...store,
          sets: { ...store.sets, [setId]: { ...set, tokens } },
          revision: store.revision + 1,
        },
      };
    }
    case "tokens/rename": {
      requireTokenRevision(store, action.expectedRevision);
      const setId = validateTokenInput(() => validateTokenId(action.setId, "tokens.setId"));
      const tokenId = validateTokenInput(() => validateTokenId(action.tokenId, "tokens.tokenId"));
      const set = store.sets[setId];
      if (!set) throw new EditorReducerError(`Unknown token set: ${setId}`);
      const renamed = set.tokens[tokenId];
      if (!renamed) throw new EditorReducerError(`Unknown token: ${tokenId}`);
      const name = validateTokenInput(() => validateTokenName(action.name, "tokens.name"));
      const oldName = renamed.name;
      if (name === oldName) return state;
      // A variable's name is its identity: same-named tokens across sets are
      // the per-mode values of one variable (Figma modes semantics), so the
      // rename applies everywhere the old name exists. Sets that contain both
      // names would end up with a duplicate — reject before mutating.
      for (const candidate of Object.values(store.sets)) {
        const hasOld = Object.values(candidate.tokens).some((entry) => entry.name === oldName);
        const hasNew = Object.values(candidate.tokens).some((entry) => entry.name === name);
        if (hasOld && hasNew) {
          throw new EditorReducerError(`A token named ${name} already exists in set ${candidate.id}`);
        }
      }
      const sets: Record<string, TokenSet> = {};
      for (const [candidateId, candidate] of Object.entries(store.sets)) {
        let changed = false;
        const tokens: Record<string, DesignToken> = { ...candidate.tokens };
        for (const [entryId, entry] of Object.entries(candidate.tokens)) {
          let next = entry;
          if (entry.name === oldName) next = { ...next, name };
          const alias = isTokenAlias(next.value) ? tokenAliasTarget(next.value) : null;
          if (alias === oldName) next = { ...next, value: tokenAliasReference(name) };
          if (next !== entry) {
            tokens[entryId] = next;
            changed = true;
          }
        }
        sets[candidateId] = changed ? { ...candidate, tokens } : candidate;
      }
      // `var(--old-name)` references inside document markup stay linked — the
      // rename rewrites them so applied tokens keep resolving.
      let documents = state.documents;
      for (const document of Object.values(state.documents)) {
        const nextSrcDoc = rewriteTokenCssReference(document.srcDoc, oldName, name);
        if (nextSrcDoc !== document.srcDoc) {
          if (documents === state.documents) documents = { ...state.documents };
          documents[document.id] = {
            ...document,
            srcDoc: nextSrcDoc,
            revision: document.revision + 1,
          };
        }
      }
      return {
        ...state,
        documents,
        tokens: { ...store, sets, revision: store.revision + 1 },
      };
    }
    case "tokens/upsert-theme": {
      requireTokenRevision(store, action.expectedRevision);
      const theme = validateTokenInput(() =>
        validateTokenTheme(action.theme, "tokens.theme", new Set(Object.keys(store.sets))),
      );
      if (store.themes[theme.id] && sameJson(store.themes[theme.id], theme)) return state;
      return {
        ...state,
        tokens: {
          ...store,
          themes: { ...store.themes, [theme.id]: theme },
          revision: store.revision + 1,
        },
      };
    }
    case "tokens/remove-theme": {
      requireTokenRevision(store, action.expectedRevision);
      const themeId = validateTokenInput(() => validateTokenId(action.themeId, "tokens.themeId"));
      if (!store.themes[themeId]) throw new EditorReducerError(`Unknown theme: ${themeId}`);
      const { [themeId]: _removed, ...themes } = store.themes;
      return {
        ...state,
        tokens: {
          ...store,
          themes,
          activeThemeId: store.activeThemeId === themeId ? null : store.activeThemeId,
          revision: store.revision + 1,
        },
      };
    }
    case "tokens/switch-theme": {
      requireTokenRevision(store, action.expectedRevision);
      const themeId = action.themeId === null
        ? null
        : validateTokenInput(() => validateTokenId(action.themeId, "tokens.themeId"));
      if (themeId !== null && !store.themes[themeId]) {
        throw new EditorReducerError(`Unknown theme: ${themeId}`);
      }
      if (store.activeThemeId === themeId) return state;
      return {
        ...state,
        tokens: { ...store, activeThemeId: themeId, revision: store.revision + 1 },
      };
    }
  }
}

function reduceBrainstormSession(
  state: EditorState,
  action: BrainstormSessionAction,
): EditorState {
  try {
    const session = applyBrainstormSessionAction(state.session, action);
    return session === state.session ? state : { ...state, session };
  } catch (error) {
    if (error instanceof BrainstormSessionReducerError) {
      throw new EditorReducerError(error.message, { cause: error });
    }
    throw error;
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "document/create": {
      if (state.documents[action.document.id]) {
        throw new EditorReducerError(`Document already exists: ${action.document.id}`);
      }
      return {
        ...state,
        documents: { ...state.documents, [action.document.id]: action.document },
      };
    }

    case "document/replace-html": {
      const document = requireDocument(state, action.documentId);
      if (document.revision !== action.expectedRevision) {
        throw new EditorReducerError(
          `Stale document revision for ${document.id}: expected ${action.expectedRevision}, current ${document.revision}`,
        );
      }
      if (document.srcDoc === action.srcDoc && document.mode === action.mode) return state;
      return {
        ...state,
        documents: {
          ...state.documents,
          [document.id]: {
            ...document,
            mode: action.mode,
            srcDoc: action.srcDoc,
            revision: document.revision + 1,
          },
        },
      };
    }

    case "page/create": {
      if (state.pages[action.page.id]) {
        throw new EditorReducerError(`Page already exists: ${action.page.id}`);
      }
      const document = requireDocument(state, action.page.documentId);
      return {
        ...state,
        documents: {
          ...state.documents,
          [document.id]: {
            ...document,
            pageIds: document.pageIds.includes(action.page.id)
              ? document.pageIds
              : [...document.pageIds, action.page.id],
          },
        },
        pages: { ...state.pages, [action.page.id]: action.page },
        activePageId: state.activePageId ?? action.page.id,
      };
    }

    case "page/rename": {
      const page = requirePage(state, action.pageId);
      const name = action.name.trim();
      if (!name || name === page.name) return state;
      return { ...state, pages: { ...state.pages, [page.id]: { ...page, name } } };
    }

    case "page/switch": {
      const page = requirePage(state, action.pageId);
      if (state.activePageId === page.id) return state;
      const firstFrameId = page.frameIds.find((frameId) => state.frames[frameId]) ?? null;
      const selection = normalizeSelection(state, {
        frameIds: firstFrameId ? [firstFrameId] : [],
        nodeIds: [],
        primaryFrameId: firstFrameId,
        primaryNodeId: null,
      });
      return { ...state, activePageId: page.id, selection };
    }

    case "frame/create": {
      if (state.frames[action.frame.id]) {
        throw new EditorReducerError(`Frame already exists: ${action.frame.id}`);
      }
      requireDocument(state, action.frame.documentId);
      // Pages group frames for navigation; imported Figma pages host frames
      // backed by separate documents, so a frame's document does not have to
      // match the page's owning document.
      const page = requirePage(state, action.frame.pageId);
      return {
        ...state,
        frames: { ...state.frames, [action.frame.id]: action.frame },
        pages: {
          ...state.pages,
          [page.id]: {
            ...page,
            frameIds: page.frameIds.includes(action.frame.id)
              ? page.frameIds
              : [...page.frameIds, action.frame.id],
          },
        },
      };
    }

    case "frame/move": {
      const frame = requireFrame(state, action.frameId);
      if (frame.x === action.position.x && frame.y === action.position.y) {
        return state;
      }
      return {
        ...state,
        frames: {
          ...state.frames,
          [frame.id]: {
            ...frame,
            x: action.position.x,
            y: action.position.y,
          },
        },
      };
    }

    case "frame/update": {
      const frame = requireFrame(state, action.frameId);
      const nextFrame = { ...frame, ...action.patch };
      if (
        nextFrame.name === frame.name &&
        nextFrame.width === frame.width &&
        nextFrame.height === frame.height &&
        nextFrame.background === frame.background
      ) {
        return state;
      }
      return {
        ...state,
        frames: { ...state.frames, [frame.id]: nextFrame },
      };
    }

    case "frame/remove": {
      const frame = requireFrame(state, action.frameId);
      const { [frame.id]: _removedFrame, ...frames } = state.frames;
      const page = requirePage(state, frame.pageId);
      // The node index mirrors live frame content; keeping the removed frame's
      // entries would leave them pointing at a dead frameId, which the project
      // serializer rejects.
      const removedNodeIds = new Set(
        Object.values(state.nodes)
          .filter((node) => node.frameId === frame.id)
          .map((node) => node.id),
      );
      let nodes = state.nodes;
      let documents = state.documents;
      if (removedNodeIds.size > 0) {
        nodes = {};
        for (const [nodeId, node] of Object.entries(state.nodes)) {
          if (removedNodeIds.has(nodeId)) continue;
          const childIds = node.childIds.filter((id) => !removedNodeIds.has(id));
          nodes[nodeId] = childIds.length === node.childIds.length ? node : { ...node, childIds };
        }
        const document = state.documents[frame.documentId];
        if (document) {
          const rootNodeIds = document.rootNodeIds.filter((id) => !removedNodeIds.has(id));
          if (rootNodeIds.length !== document.rootNodeIds.length) {
            documents = {
              ...state.documents,
              [document.id]: { ...document, rootNodeIds },
            };
          }
        }
      }
      const nextState = { ...state, frames, nodes, documents };
      const selection = {
        ...state.selection,
        frameIds: state.selection.frameIds.filter((id) => id !== frame.id),
        primaryFrameId:
          state.selection.primaryFrameId === frame.id
            ? null
            : state.selection.primaryFrameId,
      };
      return {
        ...nextState,
        pages: {
          ...state.pages,
          [page.id]: {
            ...page,
            frameIds: page.frameIds.filter((id) => id !== frame.id),
          },
        },
        selection: normalizeSelection(nextState, selection),
      };
    }

    case "node/upsert": {
      requireDocument(state, action.node.documentId);
      if (action.node.parentId) {
        const parent = state.nodes[action.node.parentId];
        if (!parent) {
          throw new EditorReducerError(`Unknown parent node: ${action.node.parentId}`);
        }
        if (parent.documentId !== action.node.documentId) {
          throw new EditorReducerError("Node parent belongs to another document");
        }
      }
      const previous = state.nodes[action.node.id];
      let nextState = { ...state, nodes: { ...state.nodes, [action.node.id]: action.node } };
      // Detach whenever the membership slot changes: a parent swap, or a
      // root-to-root move across documents (parentId stays null while
      // documentId moves — detach must target the PREVIOUS document).
      if (previous && (previous.parentId !== action.node.parentId || previous.documentId !== action.node.documentId)) {
        if (previous.parentId && nextState.nodes[previous.parentId]) {
          const parent = nextState.nodes[previous.parentId];
          nextState = {
            ...nextState,
            nodes: { ...nextState.nodes, [parent.id]: { ...parent, childIds: parent.childIds.filter((id) => id !== action.node.id) } },
          };
        } else if (!previous.parentId && nextState.documents[previous.documentId]) {
          const document = nextState.documents[previous.documentId];
          nextState = {
            ...nextState,
            documents: { ...nextState.documents, [document.id]: { ...document, rootNodeIds: document.rootNodeIds.filter((id) => id !== action.node.id) } },
          };
        }
      }
      if (action.node.parentId) {
        const parent = nextState.nodes[action.node.parentId];
        if (parent && !parent.childIds.includes(action.node.id)) {
          nextState = { ...nextState, nodes: { ...nextState.nodes, [parent.id]: { ...parent, childIds: [...parent.childIds, action.node.id] } } };
        }
      } else {
        const document = nextState.documents[action.node.documentId];
        if (document && !document.rootNodeIds.includes(action.node.id)) {
          nextState = { ...nextState, documents: { ...nextState.documents, [document.id]: { ...document, rootNodeIds: [...document.rootNodeIds, action.node.id] } } };
        }
      }
      if (previous && previous.documentId !== action.node.documentId) {
        nextState = { ...nextState, nodes: retargetSubtreeDocument(nextState.nodes, action.node.id, action.node.documentId) };
      }
      return nextState;
    }

    // Bulk path of node/upsert: one state transition for a whole snapshot —
    // the nodes record is copied once instead of once per node.
    case "nodes/upsert-many": {
      if (action.nodes.length === 0) return state;
      const nodes: Record<NodeId, NodeEntity> = { ...state.nodes };
      // Parent checks also consult the incoming batch: a snapshot may list a
      // child before the parent that arrives later in the same batch.
      const incomingById = new Map<NodeId, NodeEntity>(action.nodes.map((node) => [node.id, node]));
      const deferredChildAdds: Array<{ parentId: NodeId; nodeId: NodeId }> = [];
      let documents = state.documents;
      let documentsCopied = false;
      const copyDocuments = () => {
        if (!documentsCopied) {
          documents = { ...documents };
          documentsCopied = true;
        }
      };
      for (const node of action.nodes) {
        requireDocument(state, node.documentId);
        if (node.parentId) {
          const parent = nodes[node.parentId] ?? incomingById.get(node.parentId);
          if (!parent) {
            throw new EditorReducerError(`Unknown parent node: ${node.parentId}`);
          }
          if (parent.documentId !== node.documentId) {
            throw new EditorReducerError("Node parent belongs to another document");
          }
        }
        const previous = nodes[node.id];
        nodes[node.id] = node;
        // Same rule as node/upsert: membership changes on parent swap or on a
        // root-to-root document move; a previous root detaches from ITS OWN
        // document, not the destination's root list.
        if (previous && (previous.parentId !== node.parentId || previous.documentId !== node.documentId)) {
          if (previous.parentId && nodes[previous.parentId]) {
            const parent = nodes[previous.parentId];
            nodes[parent.id] = {
              ...parent,
              childIds: parent.childIds.filter((id) => id !== node.id),
            };
          } else if (!previous.parentId) {
            const document = documents[previous.documentId];
            if (document) {
              copyDocuments();
              documents[previous.documentId] = {
                ...document,
                rootNodeIds: document.rootNodeIds.filter((id) => id !== node.id),
              };
            }
          }
        }
        if (node.parentId) {
          const parent = nodes[node.parentId];
          if (parent && !parent.childIds.includes(node.id)) {
            nodes[parent.id] = { ...parent, childIds: [...parent.childIds, node.id] };
          } else if (!parent) {
            // Parent exists only in the incoming batch — attach once it has
            // been written into the accumulated record below.
            deferredChildAdds.push({ parentId: node.parentId, nodeId: node.id });
          }
        } else {
          const document = documents[node.documentId];
          if (document && !document.rootNodeIds.includes(node.id)) {
            copyDocuments();
            documents[node.documentId] = {
              ...document,
              rootNodeIds: [...document.rootNodeIds, node.id],
            };
          }
        }
      }
      for (const { parentId, nodeId } of deferredChildAdds) {
        const parent = nodes[parentId];
        if (parent && !parent.childIds.includes(nodeId)) {
          nodes[parentId] = { ...parent, childIds: [...parent.childIds, nodeId] };
        }
      }
      // Cross-document moves reparent membership but the subtree must move
      // with the root — children left in the old document orphan the tree.
      let nextNodes = nodes;
      for (const node of action.nodes) {
        const previous = state.nodes[node.id];
        if (previous && previous.documentId !== node.documentId) {
          nextNodes = retargetSubtreeDocument(nextNodes, node.id, node.documentId);
        }
      }
      return { ...state, nodes: nextNodes, documents };
    }

    case "node/update": {
      const node = state.nodes[action.nodeId];
      if (!node) throw new EditorReducerError(`Unknown node: ${action.nodeId}`);
      const nextNode = { ...node, ...action.patch };
      if (nextNode.name === node.name && nextNode.locked === node.locked && nextNode.hidden === node.hidden) return state;
      return { ...state, nodes: { ...state.nodes, [node.id]: nextNode } };
    }

    case "node/remove": {
      const node = state.nodes[action.nodeId];
      if (!node) return state;
      const removed = new Set<string>();
      const visit = (nodeId: string) => {
        if (removed.has(nodeId)) return;
        removed.add(nodeId);
        for (const childId of state.nodes[nodeId]?.childIds ?? []) visit(childId);
      };
      visit(node.id);
      const nodes = Object.fromEntries(Object.entries(state.nodes).filter(([id]) => !removed.has(id)));
      const parent = node.parentId ? state.nodes[node.parentId] : null;
      const documents = parent
        ? state.documents
        : Object.fromEntries(Object.entries(state.documents).map(([id, document]) =>
            id === node.documentId
              ? [id, { ...document, rootNodeIds: document.rootNodeIds.filter((childId) => !removed.has(childId)) }]
              : [id, document],
          ));
      if (parent && nodes[parent.id]) {
        nodes[parent.id] = { ...nodes[parent.id], childIds: parent.childIds.filter((childId) => !removed.has(childId)) };
      }
      const nextState = { ...state, nodes, documents };
      return { ...nextState, selection: normalizeSelection(nextState, state.selection) };
    }

    case "node/reorder":
      return replaceChildOrder(state, action.nodeId, action.direction);

    case "selection/set": {
      const selection = normalizeSelection(state, action.selection);
      const current = state.selection;
      if (
        current.primaryFrameId === selection.primaryFrameId &&
        current.primaryNodeId === selection.primaryNodeId &&
        current.frameIds.length === selection.frameIds.length &&
        current.nodeIds.length === selection.nodeIds.length &&
        current.frameIds.every((id, index) => id === selection.frameIds[index]) &&
        current.nodeIds.every((id, index) => id === selection.nodeIds[index])
      ) {
        return state;
      }
      return { ...state, selection };
    }

    case "tool/set":
      return state.activeTool === action.tool
        ? state
        : { ...state, activeTool: action.tool };

    case "tokens/upsert-set":
    case "tokens/remove-set":
    case "tokens/upsert-token":
    case "tokens/remove-token":
    case "tokens/rename":
    case "tokens/upsert-theme":
    case "tokens/remove-theme":
    case "tokens/switch-theme":
      return reduceTokenAction(state, action);

    case "session/start":
    case "session/brief-update":
    case "session/reference-add":
    case "session/reference-update":
    case "session/reference-remove":
    case "session/decision-add":
    case "session/decision-update":
    case "session/decision-remove":
    case "session/wireframe-created":
    case "session/lifecycle-transition":
    case "session/brief-select":
    case "session/brief-move":
      return reduceBrainstormSession(state, action);
  }
}

export function clearSelectionAction(): EditorAction {
  return { type: "selection/set", selection: createEmptySelection() };
}
