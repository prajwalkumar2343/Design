import {
  type ActiveTool,
  type EditorState,
  type FrameEntity,
  type FrameSeed,
  type NodeEntity,
  type PageEntity,
  type SelectionState,
} from "./model";
import { editorReducer } from "./reducer";

export type EditorCommand =
  | {
      type: "frame/create";
      frame: FrameSeed;
    }
  | {
      type: "document/replace-html";
      documentId: string;
      expectedRevision: number;
      srcDoc: string;
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
  | { type: "tool/set"; tool: ActiveTool };

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
        srcDoc: frame.srcDoc,
        revision: 1,
        rootNodeIds: [],
        pageIds: [],
      },
    });
  } else if (existingDocument.srcDoc !== frame.srcDoc) {
    throw new EditorCommandError(
      `Document ${frame.documentId} has a different iframe source document`,
    );
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
  } else if (existingPage.documentId !== frame.documentId) {
    throw new EditorCommandError(`Page ${pageId} belongs to another document`);
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
    },
  });
}

export function applyEditorCommand(
  state: EditorState,
  command: EditorCommand,
): EditorState {
  switch (command.type) {
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
  }
}

export function replaceDocumentHtmlCommand(options: {
  documentId: string;
  expectedRevision: number;
  srcDoc: string;
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

export function setSelectionCommand(selection: SelectionState): EditorCommand {
  return { type: "selection/set", selection };
}

export function setActiveToolCommand(tool: ActiveTool): EditorCommand {
  return { type: "tool/set", tool };
}
