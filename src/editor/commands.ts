import {
  type ActiveTool,
  type DocumentMode,
  type EditorState,
  type FrameEntity,
  type FrameSeed,
  type NodeEntity,
  type PageEntity,
  type SelectionState,
} from "./model";
import type {
  BriefFieldUpdate,
  BriefReference,
  ConfirmedDecision,
  StartBrainstormSessionOptions,
} from "../session/model";
import type { BrainstormSessionAction } from "../session/reducer";
import type { DesignToken, TokenSet, TokenTheme } from "../tokens";
import { editorReducer } from "./reducer";

export type EditorCommand =
  | { type: "document/create"; document: import("./model").DocumentEntity }
  | {
      type: "frame/create";
      frame: FrameSeed;
    }
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
  | { type: "node/remove"; nodeId: string }
  | { type: "node/update"; nodeId: string; patch: Partial<Pick<NodeEntity, "name" | "locked" | "hidden">> }
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

export class EditorCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorCommandError";
  }
}

function applyCreateFrameCommand(state: EditorState, frame: FrameSeed): EditorState {
  const pageId = frame.pageId ?? "page-1";
  let nextState = state;
  const existingDocument = nextState.documents[frame.documentId];

  if (!existingDocument) {
    nextState = editorReducer(nextState, {
      type: "document/create",
      document: {
        id: frame.documentId,
        name: frame.documentName ?? frame.documentId,
        mode: frame.mode ?? "design",
        srcDoc: frame.srcDoc,
        revision: 1,
        rootNodeIds: [],
        pageIds: [],
      },
    });
  } else {
    if (existingDocument.srcDoc !== frame.srcDoc) {
      throw new EditorCommandError(
        `Document ${frame.documentId} has a different iframe source document`,
      );
    }
    if (existingDocument.mode !== (frame.mode ?? "design")) {
      throw new EditorCommandError(`Document ${frame.documentId} has a different document mode`);
    }
  }

  const existingPage = nextState.pages[pageId];
  if (!existingPage) {
    nextState = editorReducer(nextState, {
      type: "page/create",
      page: {
        id: pageId,
        documentId: frame.documentId,
        name: frame.pageName ?? "Page 1",
        frameIds: [],
      },
    });
    // Existing pages accept frames from other documents: imported Figma files
    // place every artboard (each backed by its own document) on one page.
  }

  return editorReducer(nextState, {
    type: "frame/create",
    frame: {
      id: frame.id,
      pageId,
      documentId: frame.documentId,
      name: frame.name,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      background: frame.background,
      category: frame.category,
      chrome: frame.chrome,
    },
  });
}

export function applyEditorCommand(
  state: EditorState,
  command: EditorCommand,
): EditorState {
  switch (command.type) {
    case "document/create":
      return editorReducer(state, command);
    case "frame/create":
      return applyCreateFrameCommand(state, command.frame);
    case "document/replace-html":
      return editorReducer(state, command);
    case "frame/move":
      return editorReducer(state, command);
    case "frame/update":
      return editorReducer(state, command);
    case "frame/remove":
      return editorReducer(state, command);
    case "page/create":
    case "page/rename":
    case "page/switch":
    case "node/upsert":
    case "node/remove":
    case "node/update":
    case "node/reorder":
      return editorReducer(state, command);
    case "selection/set":
      return editorReducer(state, command);
    case "tool/set":
      return editorReducer(state, command);
    case "tokens/upsert-set":
    case "tokens/remove-set":
    case "tokens/upsert-token":
    case "tokens/remove-token":
    case "tokens/rename":
    case "tokens/upsert-theme":
    case "tokens/remove-theme":
    case "tokens/switch-theme":
      return editorReducer(state, command);
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
      return editorReducer(state, command);
  }
}

export function replaceDocumentHtmlCommand(options: {
  documentId: string;
  expectedRevision: number;
  srcDoc: string;
  mode: DocumentMode;
}): EditorCommand {
  return { type: "document/replace-html", ...options };
}

export function createFrameCommand(frame: FrameSeed): EditorCommand {
  return { type: "frame/create", frame };
}

export function createPageCommand(page: PageEntity): EditorCommand {
  return { type: "page/create", page };
}

export function renamePageCommand(pageId: string, name: string): EditorCommand {
  return { type: "page/rename", pageId, name };
}

export function switchPageCommand(pageId: string): EditorCommand {
  return { type: "page/switch", pageId };
}

export function moveFrameCommand(options: {
  frameId: string;
  position: { x: number; y: number };
}): EditorCommand {
  return { type: "frame/move", ...options };
}

export function removeFrameCommand(frameId: string): EditorCommand {
  return { type: "frame/remove", frameId };
}

export function setSelectionCommand(selection: SelectionState): EditorCommand {
  return { type: "selection/set", selection };
}

export function setActiveToolCommand(tool: ActiveTool): EditorCommand {
  return { type: "tool/set", tool };
}

export function startBrainstormSessionCommand(
  options: StartBrainstormSessionOptions,
  expectedRevision?: number,
): EditorCommand {
  return { type: "session/start", options, expectedRevision };
}

export function updateBriefFieldCommand(
  update: BriefFieldUpdate,
  expectedRevision?: number,
): EditorCommand {
  return { type: "session/brief-update", update, expectedRevision };
}

export function addBriefReferenceCommand(
  reference: BriefReference,
  expectedRevision?: number,
): EditorCommand {
  return { type: "session/reference-add", reference, expectedRevision };
}

export function updateBriefReferenceCommand(options: {
  referenceId: string;
  patch: Partial<Pick<BriefReference, "label" | "url" | "note">>;
  expectedRevision?: number;
}): EditorCommand {
  return { type: "session/reference-update", ...options };
}

export function removeBriefReferenceCommand(
  referenceId: string,
  expectedRevision?: number,
): EditorCommand {
  return { type: "session/reference-remove", referenceId, expectedRevision };
}

export function addConfirmedDecisionCommand(
  decision: ConfirmedDecision,
  expectedRevision?: number,
): EditorCommand {
  return { type: "session/decision-add", decision, expectedRevision };
}

export function updateConfirmedDecisionCommand(options: {
  decisionId: string;
  patch: Partial<Pick<ConfirmedDecision, "statement" | "rationale">>;
  expectedRevision?: number;
}): EditorCommand {
  return { type: "session/decision-update", ...options };
}

export function removeConfirmedDecisionCommand(
  decisionId: string,
  expectedRevision?: number,
): EditorCommand {
  return { type: "session/decision-remove", decisionId, expectedRevision };
}

export function transitionBrainstormSessionCommand(
  to: "wireframing" | "completed",
  expectedRevision?: number,
): EditorCommand {
  return { type: "session/lifecycle-transition", to, expectedRevision };
}

export function wireframeCreatedCommand(expectedRevision?: number): EditorCommand {
  return { type: "session/wireframe-created", expectedRevision };
}

export function selectBriefFrameCommand(briefFrameId: string | null): EditorCommand {
  return { type: "session/brief-select", briefFrameId };
}

export function moveBriefFrameCommand(options: {
  position: { x: number; y: number };
  expectedRevision?: number;
}): EditorCommand {
  return { type: "session/brief-move", ...options };
}

export function upsertTokenSetCommand(set: TokenSet, expectedRevision?: number): EditorCommand {
  return { type: "tokens/upsert-set", set, expectedRevision };
}

export function removeTokenSetCommand(setId: string, expectedRevision?: number): EditorCommand {
  return { type: "tokens/remove-set", setId, expectedRevision };
}

export function upsertTokenCommand(
  setId: string,
  token: DesignToken,
  expectedRevision?: number,
): EditorCommand {
  return { type: "tokens/upsert-token", setId, token, expectedRevision };
}

export function removeTokenCommand(
  setId: string,
  tokenId: string,
  expectedRevision?: number,
): EditorCommand {
  return { type: "tokens/remove-token", setId, tokenId, expectedRevision };
}

export function renameTokenCommand(
  setId: string,
  tokenId: string,
  name: string,
  expectedRevision?: number,
): EditorCommand {
  return { type: "tokens/rename", setId, tokenId, name, expectedRevision };
}

export function upsertTokenThemeCommand(theme: TokenTheme, expectedRevision?: number): EditorCommand {
  return { type: "tokens/upsert-theme", theme, expectedRevision };
}

export function removeTokenThemeCommand(themeId: string, expectedRevision?: number): EditorCommand {
  return { type: "tokens/remove-theme", themeId, expectedRevision };
}

export function switchTokenThemeCommand(
  themeId: string | null,
  expectedRevision?: number,
): EditorCommand {
  return { type: "tokens/switch-theme", themeId, expectedRevision };
}
