import {
  validateCompleteHtml,
} from "../router/html-admission";
import {
  validateWireframeHtml,
  WireframeAdmissionError,
} from "../router/wireframe-admission";
import {
  BRAINSTORM_SESSION_KIND,
  BRAINSTORM_SESSION_SCHEMA_VERSION,
  type BrainstormSessionState,
  type BriefContent,
  type BriefFrame,
  type BriefReference,
  type ConfirmedDecision,
} from "../session/model";
import {
  type ActiveTool,
  type DocumentEntity,
  type DocumentMode,
  type EditorState,
  type FrameEntity,
  type NodeEntity,
  type PageEntity,
  type SelectionState,
} from "../editor/model";
import type { EditorStore } from "../editor/store";
import {
  createEmptyTokenStore,
  TokenValidationError,
  validateTokenStore,
  type TokenStoreState,
  type TokenValidationErrorCode,
} from "../tokens";

export const WIRECANVAS_FILE_KIND = "wirecanvas-project" as const;
export const WIRECANVAS_FILE_SCHEMA_VERSION = 1 as const;
export const WIRECANVAS_FILE_MIME_TYPE = "application/json" as const;
export const WIRECANVAS_FILE_NAME = "brainstorm-session.wirecanvas.json" as const;

export const WIRECANVAS_LIMITS = {
  maxFileBytes: 8 * 1024 * 1024,
  maxStringLength: 2 * 1024 * 1024,
  maxCollectionItems: 10_000,
  maxIdLength: 256,
} as const;

export interface WireCanvasDurableState {
  session: BrainstormSessionState;
  tokens: TokenStoreState;
  documents: DocumentEntity[];
  pages: PageEntity[];
  frames: FrameEntity[];
  nodes: NodeEntity[];
  activePageId: string | null;
  selection: SelectionState;
  activeTool: ActiveTool;
}

export interface WireCanvasProjectV1 {
  kind: typeof WIRECANVAS_FILE_KIND;
  schemaVersion: typeof WIRECANVAS_FILE_SCHEMA_VERSION;
  state: WireCanvasDurableState;
}

export type WireCanvasCodecErrorCode =
  | "file-too-large"
  | "invalid-json"
  | "invalid-root"
  | "unsupported-file-version"
  | "unsupported-session-version"
  | "unknown-field"
  | "invalid-field"
  | "invalid-id"
  | "duplicate-id"
  | "invalid-reference"
  | "invalid-coordinates"
  | "invalid-size"
  | "invalid-revision"
  | "invalid-mode"
  | "invalid-html"
  | "wireframe-admission"
  | "collection-too-large"
  | "string-too-large";

export class WireCanvasCodecError extends Error {
  readonly code: WireCanvasCodecErrorCode;
  readonly path: string;

  constructor(code: WireCanvasCodecErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "WireCanvasCodecError";
    this.code = code;
    this.path = path;
  }
}

type JsonRecord = Record<string, unknown>;

function fail(code: WireCanvasCodecErrorCode, path: string, message: string): never {
  throw new WireCanvasCodecError(code, path, message);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) fail("invalid-field", path, "expected an object");
  return value;
}

function expectKeys(value: JsonRecord, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail("unknown-field", `${path}.${key}`, "field is not supported");
  }
}

function stringValue(value: unknown, path: string, options: { id?: boolean; nonEmpty?: boolean } = {}): string {
  if (typeof value !== "string") fail("invalid-field", path, "expected a string");
  const max = options.id ? WIRECANVAS_LIMITS.maxIdLength : WIRECANVAS_LIMITS.maxStringLength;
  if (value.length > max) fail("string-too-large", path, `string exceeds the ${max}-character limit`);
  if (options.nonEmpty && value.trim().length === 0) fail(options.id ? "invalid-id" : "invalid-field", path, "must not be empty");
  return value;
}

function idValue(value: unknown, path: string): string {
  return stringValue(value, path, { id: true, nonEmpty: true });
}

function nullableId(value: unknown, path: string): string | null {
  return value === null ? null : idValue(value, path);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("invalid-coordinates", path, "must be a finite number");
  }
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) fail("invalid-size", path, "must be greater than zero");
  return number;
}

function revision(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    fail("invalid-revision", path, `must be a safe integer greater than or equal to ${minimum}`);
  }
  return value;
}

function collection(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail("invalid-field", path, "expected an array");
  if (value.length > WIRECANVAS_LIMITS.maxCollectionItems) {
    fail("collection-too-large", path, `collection exceeds the ${WIRECANVAS_LIMITS.maxCollectionItems}-item limit`);
  }
  return value;
}

function uniqueIds(ids: readonly string[], path: string): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) fail("duplicate-id", `${path}[${index}]`, `duplicate id ${id}`);
    seen.add(id);
  });
}

function stringArray(value: unknown, path: string): string[] {
  return collection(value, path).map((item, index) => stringValue(item, `${path}[${index}]`));
}

function idArray(value: unknown, path: string): string[] {
  const ids = collection(value, path).map((item, index) => idValue(item, `${path}[${index}]`));
  uniqueIds(ids, path);
  return ids;
}

function modeValue(value: unknown, path: string): DocumentMode {
  if (value !== "design" && value !== "wireframe") fail("invalid-mode", path, "must be design or wireframe");
  return value;
}

function mapString(value: unknown, path: string): Record<string, string> {
  const input = record(value, path);
  const keys = Object.keys(input);
  if (keys.length > WIRECANVAS_LIMITS.maxCollectionItems) {
    fail("collection-too-large", path, `map exceeds the ${WIRECANVAS_LIMITS.maxCollectionItems}-item limit`);
  }
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(input)) {
    if (key.length > WIRECANVAS_LIMITS.maxStringLength) fail("string-too-large", `${path}.${key}`, "attribute name is too long");
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: stringValue(item, `${path}.${key}`),
      writable: true,
    });
  }
  return output;
}

function validateHtml(html: string, mode: DocumentMode, path: string): void {
  try {
    if (mode === "wireframe") {
      validateWireframeHtml(html);
    } else {
      validateCompleteHtml(html);
    }
  } catch (error) {
    if (error instanceof WireframeAdmissionError) {
      fail("wireframe-admission", path, error.message);
    }
    const message = error instanceof Error ? error.message : "HTML admission failed";
    fail("invalid-html", path, message);
  }
}

function readReference(value: unknown, path: string): BriefReference {
  const input = record(value, path);
  expectKeys(input, ["id", "label", "url", "note"], path);
  const url = stringValue(input.url, `${path}.url`);
  if (url && !/^https?:\/\//i.test(url)) fail("invalid-field", `${path}.url`, "must be an http:// or https:// URL");
  return {
    id: idValue(input.id, `${path}.id`),
    label: stringValue(input.label, `${path}.label`),
    url,
    note: stringValue(input.note, `${path}.note`),
  };
}

function readDecision(value: unknown, path: string): ConfirmedDecision {
  const input = record(value, path);
  expectKeys(input, ["id", "statement", "rationale"], path);
  return {
    id: idValue(input.id, `${path}.id`),
    statement: stringValue(input.statement, `${path}.statement`),
    rationale: stringValue(input.rationale, `${path}.rationale`),
  };
}

function readBriefContent(value: unknown, path: string): BriefContent {
  const input = record(value, path);
  expectKeys(input, [
    "projectDescription",
    "audience",
    "goals",
    "successCriteria",
    "requiredFeatures",
    "requiredContent",
    "visualDirection",
    "constraints",
    "references",
    "openQuestions",
    "confirmedDecisions",
  ], path);
  const references = collection(input.references, `${path}.references`).map((item, index) => readReference(item, `${path}.references[${index}]`));
  uniqueIds(references.map((item) => item.id), `${path}.references`);
  const decisions = collection(input.confirmedDecisions, `${path}.confirmedDecisions`).map((item, index) => readDecision(item, `${path}.confirmedDecisions[${index}]`));
  uniqueIds(decisions.map((item) => item.id), `${path}.confirmedDecisions`);
  return {
    projectDescription: stringValue(input.projectDescription, `${path}.projectDescription`),
    audience: stringValue(input.audience, `${path}.audience`),
    goals: stringArray(input.goals, `${path}.goals`),
    successCriteria: stringArray(input.successCriteria, `${path}.successCriteria`),
    requiredFeatures: stringArray(input.requiredFeatures, `${path}.requiredFeatures`),
    requiredContent: stringArray(input.requiredContent, `${path}.requiredContent`),
    visualDirection: stringValue(input.visualDirection, `${path}.visualDirection`),
    constraints: stringArray(input.constraints, `${path}.constraints`),
    references,
    openQuestions: stringArray(input.openQuestions, `${path}.openQuestions`),
    confirmedDecisions: decisions,
  };
}

function readBriefFrame(value: unknown, path: string): BriefFrame {
  const input = record(value, path);
  expectKeys(input, ["id", "kind", "name", "x", "y", "width", "height", "revision", "content"], path);
  if (input.kind !== "brief") fail("invalid-field", `${path}.kind`, "must be brief");
  return {
    id: idValue(input.id, `${path}.id`),
    kind: "brief",
    name: stringValue(input.name, `${path}.name`, { nonEmpty: true }),
    x: finiteNumber(input.x, `${path}.x`),
    y: finiteNumber(input.y, `${path}.y`),
    width: positiveNumber(input.width, `${path}.width`),
    height: positiveNumber(input.height, `${path}.height`),
    revision: revision(input.revision, `${path}.revision`, 1),
    content: readBriefContent(input.content, `${path}.content`),
  };
}

function readSession(value: unknown, path: string): BrainstormSessionState {
  const input = record(value, path);
  expectKeys(input, ["kind", "schemaVersion", "lifecycle", "sessionId", "revision", "briefFrame", "selection"], path);
  if (input.kind !== BRAINSTORM_SESSION_KIND) fail("invalid-field", `${path}.kind`, `must be ${BRAINSTORM_SESSION_KIND}`);
  if (input.schemaVersion !== BRAINSTORM_SESSION_SCHEMA_VERSION) {
    if (typeof input.schemaVersion === "number" && input.schemaVersion > BRAINSTORM_SESSION_SCHEMA_VERSION) {
      fail("unsupported-session-version", `${path}.schemaVersion`, `future session schema ${input.schemaVersion} is not supported`);
    }
    fail("invalid-field", `${path}.schemaVersion`, `must be ${BRAINSTORM_SESSION_SCHEMA_VERSION}`);
  }
  if (!(["not-started", "briefing", "wireframing", "completed"] as const).includes(input.lifecycle as never)) {
    fail("invalid-field", `${path}.lifecycle`, "has an unknown lifecycle");
  }
  const lifecycle = input.lifecycle as BrainstormSessionState["lifecycle"];
  const sessionId = nullableId(input.sessionId, `${path}.sessionId`);
  const sessionRevision = revision(input.revision, `${path}.revision`);
  const briefFrame = input.briefFrame === null ? null : readBriefFrame(input.briefFrame, `${path}.briefFrame`);
  const selectionInput = record(input.selection, `${path}.selection`);
  expectKeys(selectionInput, ["type", "briefFrameId"], `${path}.selection`);
  let selection: BrainstormSessionState["selection"];
  if (selectionInput.type === "none") {
    if (Object.prototype.hasOwnProperty.call(selectionInput, "briefFrameId")) fail("unknown-field", `${path}.selection.briefFrameId`, "is not valid for none selection");
    selection = { type: "none" };
  } else if (selectionInput.type === "brief-frame") {
    selection = { type: "brief-frame", briefFrameId: idValue(selectionInput.briefFrameId, `${path}.selection.briefFrameId`) };
  } else {
    fail("invalid-field", `${path}.selection.type`, "has an unknown selection type");
  }

  if (lifecycle === "not-started") {
    if (sessionId !== null || briefFrame !== null || sessionRevision !== 0 || selection.type !== "none") {
      fail("invalid-field", path, "not-started sessions must have no id, Brief Frame, revision, or selection");
    }
  } else {
    if (sessionId === null || briefFrame === null || sessionRevision < 1) fail("invalid-field", path, "active sessions require an id, Brief Frame, and positive revision");
    if (sessionId === briefFrame.id) fail("invalid-field", `${path}.sessionId`, "must differ from the Brief Frame id");
    if (briefFrame.revision > sessionRevision) fail("invalid-revision", `${path}.briefFrame.revision`, "must not exceed the session revision");
    if (selection.type === "brief-frame" && selection.briefFrameId !== briefFrame?.id) fail("invalid-reference", `${path}.selection.briefFrameId`, "does not reference the Brief Frame");
  }
  return {
    kind: BRAINSTORM_SESSION_KIND,
    schemaVersion: BRAINSTORM_SESSION_SCHEMA_VERSION,
    lifecycle,
    sessionId,
    revision: sessionRevision,
    briefFrame,
    selection,
  };
}

function readDocument(value: unknown, path: string): DocumentEntity {
  const input = record(value, path);
  expectKeys(input, ["id", "name", "mode", "srcDoc", "revision", "rootNodeIds", "pageIds"], path);
  const mode = modeValue(input.mode, `${path}.mode`);
  const srcDoc = stringValue(input.srcDoc, `${path}.srcDoc`, { nonEmpty: true });
  validateHtml(srcDoc, mode, `${path}.srcDoc`);
  return {
    id: idValue(input.id, `${path}.id`),
    name: stringValue(input.name, `${path}.name`, { nonEmpty: true }),
    mode,
    srcDoc,
    revision: revision(input.revision, `${path}.revision`, 1),
    rootNodeIds: idArray(input.rootNodeIds, `${path}.rootNodeIds`),
    pageIds: idArray(input.pageIds, `${path}.pageIds`),
  };
}

function readPage(value: unknown, path: string): PageEntity {
  const input = record(value, path);
  expectKeys(input, ["id", "documentId", "name", "frameIds"], path);
  return {
    id: idValue(input.id, `${path}.id`),
    documentId: idValue(input.documentId, `${path}.documentId`),
    name: stringValue(input.name, `${path}.name`, { nonEmpty: true }),
    frameIds: idArray(input.frameIds, `${path}.frameIds`),
  };
}

function readDeviceChrome(value: unknown, path: string): import("../frame/presets").DeviceChrome {
  const input = record(value, path);
  expectKeys(input, ["type", "width", "height", "bezelRadius", "punchPosition"], path);
  const type = input.type;
  if (type !== "notch" && type !== "dynamic-island" && type !== "punch-hole" && type !== "none") {
    fail("invalid-field", `${path}.type`, "must be notch, dynamic-island, punch-hole or none");
  }
  const chrome: import("../frame/presets").DeviceChrome = { type: type as import("../frame/presets").DeviceChromeType };
  if (typeof input.width === "number") chrome.width = finiteNumber(input.width, `${path}.width`);
  if (typeof input.height === "number") chrome.height = finiteNumber(input.height, `${path}.height`);
  if (typeof input.bezelRadius === "number") chrome.bezelRadius = finiteNumber(input.bezelRadius, `${path}.bezelRadius`);
  if (input.punchPosition !== undefined) {
    if (input.punchPosition !== "center" && input.punchPosition !== "left") fail("invalid-field", `${path}.punchPosition`, "must be center or left");
    chrome.punchPosition = input.punchPosition as "center" | "left";
  }
  return chrome;
}

function readFrame(value: unknown, path: string): FrameEntity {
  const input = record(value, path);
  expectKeys(input, ["id", "pageId", "documentId", "name", "x", "y", "width", "height", "background", "category", "chrome", "freeform"], path);
  const frame: FrameEntity = {
    id: idValue(input.id, `${path}.id`),
    pageId: idValue(input.pageId, `${path}.pageId`),
    documentId: idValue(input.documentId, `${path}.documentId`),
    name: stringValue(input.name, `${path}.name`, { nonEmpty: true }),
    x: finiteNumber(input.x, `${path}.x`),
    y: finiteNumber(input.y, `${path}.y`),
    width: positiveNumber(input.width, `${path}.width`),
    height: positiveNumber(input.height, `${path}.height`),
    background: stringValue(input.background, `${path}.background`),
  };
  if (typeof input.category === "string") {
    if (input.category !== "mobile" && input.category !== "tablet" && input.category !== "desktop") {
      fail("invalid-field", `${path}.category`, "must be mobile, tablet or desktop");
    }
    frame.category = input.category as FrameEntity["category"];
  }
  if (input.chrome !== undefined && input.chrome !== null) {
    frame.chrome = readDeviceChrome(input.chrome, `${path}.chrome`);
  }
  if (input.freeform !== undefined) {
    if (typeof input.freeform !== "boolean") {
      fail("invalid-field", `${path}.freeform`, "must be a boolean");
    }
    frame.freeform = input.freeform;
  }
  return frame;
}

function readNode(value: unknown, path: string): NodeEntity {
  const input = record(value, path);
  expectKeys(input, ["id", "documentId", "parentId", "kind", "name", "tagName", "attributes", "childIds", "locked", "hidden", "frameId"], path);
  if (!(["element", "text", "component"] as const).includes(input.kind as never)) fail("invalid-field", `${path}.kind`, "has an unknown node kind");
  const node: NodeEntity = {
    id: idValue(input.id, `${path}.id`),
    documentId: idValue(input.documentId, `${path}.documentId`),
    parentId: nullableId(input.parentId, `${path}.parentId`),
    kind: input.kind as NodeEntity["kind"],
    name: stringValue(input.name, `${path}.name`, { nonEmpty: true }),
    attributes: mapString(input.attributes, `${path}.attributes`),
    childIds: idArray(input.childIds, `${path}.childIds`),
  };
  if (Object.prototype.hasOwnProperty.call(input, "tagName")) node.tagName = stringValue(input.tagName, `${path}.tagName`);
  if (Object.prototype.hasOwnProperty.call(input, "locked")) {
    if (typeof input.locked !== "boolean") fail("invalid-field", `${path}.locked`, "must be a boolean");
    node.locked = input.locked;
  }
  if (Object.prototype.hasOwnProperty.call(input, "hidden")) {
    if (typeof input.hidden !== "boolean") fail("invalid-field", `${path}.hidden`, "must be a boolean");
    node.hidden = input.hidden;
  }
  if (Object.prototype.hasOwnProperty.call(input, "frameId")) node.frameId = idValue(input.frameId, `${path}.frameId`);
  return node;
}

function readSelection(value: unknown, path: string): SelectionState {
  const input = record(value, path);
  expectKeys(input, ["frameIds", "nodeIds", "primaryFrameId", "primaryNodeId"], path);
  const frameIds = idArray(input.frameIds, `${path}.frameIds`);
  const nodeIds = idArray(input.nodeIds, `${path}.nodeIds`);
  const primaryFrameId = nullableId(input.primaryFrameId, `${path}.primaryFrameId`);
  const primaryNodeId = nullableId(input.primaryNodeId, `${path}.primaryNodeId`);
  if (primaryFrameId !== null && !frameIds.includes(primaryFrameId)) fail("invalid-reference", `${path}.primaryFrameId`, "must be in frameIds");
  if (primaryNodeId !== null && !nodeIds.includes(primaryNodeId)) fail("invalid-reference", `${path}.primaryNodeId`, "must be in nodeIds");
  return { frameIds, nodeIds, primaryFrameId, primaryNodeId };
}

function readActiveTool(value: unknown, path: string): ActiveTool {
  const tools = ["select", "hand", "frame", "rectangle", "text", "image", "comment", "pan"];
  if (typeof value !== "string" || !tools.includes(value)) fail("invalid-field", path, "has an unknown active tool");
  return value as ActiveTool;
}

function validateRelations(state: WireCanvasDurableState): void {
  const documents = new Map(state.documents.map((item) => [item.id, item]));
  const pages = new Map(state.pages.map((item) => [item.id, item]));
  const frames = new Map(state.frames.map((item) => [item.id, item]));
  const nodes = new Map(state.nodes.map((item) => [item.id, item]));
  if (documents.size !== state.documents.length) fail("duplicate-id", "state.documents", "contains duplicate ids");
  if (pages.size !== state.pages.length) fail("duplicate-id", "state.pages", "contains duplicate ids");
  if (frames.size !== state.frames.length) fail("duplicate-id", "state.frames", "contains duplicate ids");
  if (nodes.size !== state.nodes.length) fail("duplicate-id", "state.nodes", "contains duplicate ids");

  const pageMembership = new Map<string, string>();
  for (const document of state.documents) {
    for (const pageId of document.pageIds) {
      if (pageMembership.has(pageId)) fail("invalid-reference", `documents.${document.id}.pageIds`, `page ${pageId} belongs to more than one document`);
      pageMembership.set(pageId, document.id);
    }
  }
  for (const page of state.pages) {
    const document = documents.get(page.documentId);
    if (!document) fail("invalid-reference", `pages.${page.id}.documentId`, "does not reference a document");
    if (pageMembership.get(page.id) !== page.documentId) fail("invalid-reference", `pages.${page.id}`, "is not listed by its document");
  }
  for (const document of state.documents) {
    for (const pageId of document.pageIds) {
      const page = pages.get(pageId);
      if (!page || page.documentId !== document.id) fail("invalid-reference", `documents.${document.id}.pageIds`, `does not consistently reference page ${pageId}`);
    }
  }

  const frameMembership = new Map<string, string>();
  for (const page of state.pages) {
    for (const frameId of page.frameIds) {
      if (frameMembership.has(frameId)) fail("invalid-reference", `pages.${page.id}.frameIds`, `frame ${frameId} belongs to more than one page`);
      const frame = frames.get(frameId);
      // A page may group frames backed by different documents (Figma imports
      // place every artboard — each its own document — on one page).
      if (!frame || frame.pageId !== page.id) fail("invalid-reference", `pages.${page.id}.frameIds`, `frame ${frameId} is inconsistent`);
      frameMembership.set(frameId, page.id);
    }
  }
  for (const frame of state.frames) {
    if (frameMembership.get(frame.id) !== frame.pageId) fail("invalid-reference", `frames.${frame.id}.pageId`, "frame is not consistently listed by its page");
    if (!documents.has(frame.documentId)) fail("invalid-reference", `frames.${frame.id}.documentId`, "does not reference a document");
  }

  const rootMembership = new Map<string, string>();
  for (const document of state.documents) {
    for (const nodeId of document.rootNodeIds) {
      if (rootMembership.has(nodeId)) fail("invalid-reference", `documents.${document.id}.rootNodeIds`, `node ${nodeId} is listed more than once`);
      const node = nodes.get(nodeId);
      if (!node || node.documentId !== document.id || node.parentId !== null) fail("invalid-reference", `documents.${document.id}.rootNodeIds`, `node ${nodeId} is inconsistent`);
      rootMembership.set(nodeId, document.id);
    }
  }
  const childMembership = new Map<string, string>();
  for (const node of state.nodes) {
    const document = documents.get(node.documentId);
    if (!document) fail("invalid-reference", `nodes.${node.id}.documentId`, "does not reference a document");
    if (node.parentId === null) {
      if (rootMembership.get(node.id) !== node.documentId) fail("invalid-reference", `nodes.${node.id}`, "root node is not listed by its document");
    } else {
      const parent = nodes.get(node.parentId);
      if (!parent || parent.documentId !== node.documentId || !parent.childIds.includes(node.id)) fail("invalid-reference", `nodes.${node.id}.parentId`, "does not consistently reference its parent");
    }
    if (node.frameId !== undefined) {
      const frame = frames.get(node.frameId);
      if (!frame || frame.documentId !== node.documentId) fail("invalid-reference", `nodes.${node.id}.frameId`, "does not reference a frame in the same document");
    }
    for (const childId of node.childIds) {
      if (childMembership.has(childId)) fail("invalid-reference", `nodes.${node.id}.childIds`, `node ${childId} has more than one parent`);
      const child = nodes.get(childId);
      if (!child || child.parentId !== node.id || child.documentId !== node.documentId) fail("invalid-reference", `nodes.${node.id}.childIds`, `child ${childId} is inconsistent`);
      childMembership.set(childId, node.id);
    }
  }
  for (const node of state.nodes) {
    if (node.parentId !== null && childMembership.get(node.id) !== node.parentId) fail("invalid-reference", `nodes.${node.id}.parentId`, "parent does not list this child");
  }

  const cycleVisited = new Set<string>();
  const cycleStack = new Set<string>();
  const detectCycles = (nodeId: string): void => {
    if (cycleStack.has(nodeId)) {
      fail("invalid-reference", `nodes.${nodeId}`, "node parent/child graph contains a cycle");
    }
    if (cycleVisited.has(nodeId)) return;
    cycleStack.add(nodeId);
    const node = nodes.get(nodeId);
    if (!node) fail("invalid-reference", `nodes.${nodeId}`, "does not reference a node");
    for (const childId of node.childIds) detectCycles(childId);
    cycleStack.delete(nodeId);
    cycleVisited.add(nodeId);
  };
  for (const node of state.nodes) detectCycles(node.id);

  const reachable = new Set<string>();
  const markReachable = (nodeId: string, documentId: string): void => {
    if (reachable.has(nodeId)) {
      fail("invalid-reference", `nodes.${nodeId}`, "is reachable more than once from document roots");
    }
    const node = nodes.get(nodeId);
    if (!node || node.documentId !== documentId) {
      fail("invalid-reference", `documents.${documentId}.rootNodeIds`, `node ${nodeId} is not owned by the document`);
    }
    reachable.add(nodeId);
    for (const childId of node.childIds) markReachable(childId, documentId);
  };
  for (const document of state.documents) {
    for (const nodeId of document.rootNodeIds) markReachable(nodeId, document.id);
  }
  for (const node of state.nodes) {
    if (!reachable.has(node.id)) {
      fail("invalid-reference", `nodes.${node.id}`, "is not reachable from its document rootNodeIds");
    }
  }

  if (state.activePageId !== null && !pages.has(state.activePageId)) fail("invalid-reference", "state.activePageId", "does not reference a page");
  if (state.pages.length > 0 && state.activePageId === null) fail("invalid-reference", "state.activePageId", "must select a page when pages exist");
  for (const frameId of state.selection.frameIds) if (!frames.has(frameId)) fail("invalid-reference", "state.selection.frameIds", `unknown frame ${frameId}`);
  for (const nodeId of state.selection.nodeIds) if (!nodes.has(nodeId)) fail("invalid-reference", "state.selection.nodeIds", `unknown node ${nodeId}`);
}

function tokenCodecError(error: TokenValidationError): WireCanvasCodecErrorCode {
  const code: TokenValidationErrorCode = error.code;
  if (code === "invalid-token-id") return "invalid-id";
  if (code === "duplicate-token" || code === "duplicate-set" || code === "duplicate-theme") {
    return "duplicate-id";
  }
  if (code === "unknown-token" || code === "unknown-set" || code === "unknown-theme") {
    return "invalid-reference";
  }
  if (code === "invalid-revision" || code === "stale-revision") return "invalid-revision";
  return "invalid-field";
}

function readTokens(value: unknown, path: string): TokenStoreState {
  // Backwards compatibility: files written before the token store existed carry
  // no tokens. They import as an empty store and are never rejected for it.
  if (value === undefined) return createEmptyTokenStore();
  try {
    const store = validateTokenStore(value, path);
    if (Object.keys(store.sets).length > WIRECANVAS_LIMITS.maxCollectionItems) {
      fail("collection-too-large", path, "token set collection is too large");
    }
    if (Object.keys(store.themes).length > WIRECANVAS_LIMITS.maxCollectionItems) {
      fail("collection-too-large", path, "theme collection is too large");
    }
    return store;
  } catch (error) {
    if (error instanceof TokenValidationError) {
      fail(tokenCodecError(error), error.path, error.message);
    }
    throw error;
  }
}

function readDurableState(value: unknown, path: string): WireCanvasDurableState {
  const input = record(value, path);
  expectKeys(input, ["session", "tokens", "documents", "pages", "frames", "nodes", "activePageId", "selection", "activeTool"], path);
  const documents = collection(input.documents, `${path}.documents`).map((item, index) => readDocument(item, `${path}.documents[${index}]`));
  const pages = collection(input.pages, `${path}.pages`).map((item, index) => readPage(item, `${path}.pages[${index}]`));
  const frames = collection(input.frames, `${path}.frames`).map((item, index) => readFrame(item, `${path}.frames[${index}]`));
  const nodes = collection(input.nodes, `${path}.nodes`).map((item, index) => readNode(item, `${path}.nodes[${index}]`));
  const state: WireCanvasDurableState = {
    session: readSession(input.session, `${path}.session`),
    tokens: readTokens(input.tokens, `${path}.tokens`),
    documents,
    pages,
    frames,
    nodes,
    activePageId: nullableId(input.activePageId, `${path}.activePageId`),
    selection: readSelection(input.selection, `${path}.selection`),
    activeTool: readActiveTool(input.activeTool, `${path}.activeTool`),
  };
  validateRelations(state);
  return state;
}

function sorted<T extends { id: string }>(items: Iterable<T>): T[] {
  return Array.from(items).sort((left, right) => left.id.localeCompare(right.id));
}

function sortedMap(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function durableStateFromEditorState(state: EditorState): WireCanvasDurableState {
  return {
    session: {
      kind: state.session.kind,
      schemaVersion: state.session.schemaVersion,
      lifecycle: state.session.lifecycle,
      sessionId: state.session.sessionId,
      revision: state.session.revision,
      briefFrame: state.session.briefFrame ? {
        id: state.session.briefFrame.id,
        kind: "brief",
        name: state.session.briefFrame.name,
        x: state.session.briefFrame.x,
        y: state.session.briefFrame.y,
        width: state.session.briefFrame.width,
        height: state.session.briefFrame.height,
        revision: state.session.briefFrame.revision,
        content: {
          projectDescription: state.session.briefFrame.content.projectDescription,
          audience: state.session.briefFrame.content.audience,
          goals: [...state.session.briefFrame.content.goals],
          successCriteria: [...state.session.briefFrame.content.successCriteria],
          requiredFeatures: [...state.session.briefFrame.content.requiredFeatures],
          requiredContent: [...state.session.briefFrame.content.requiredContent],
          visualDirection: state.session.briefFrame.content.visualDirection,
          constraints: [...state.session.briefFrame.content.constraints],
          references: state.session.briefFrame.content.references.map((item) => ({ ...item })),
          openQuestions: [...state.session.briefFrame.content.openQuestions],
          confirmedDecisions: state.session.briefFrame.content.confirmedDecisions.map((item) => ({ ...item })),
        },
      } : null,
      selection: state.session.selection.type === "none"
        ? { type: "none" }
        : { type: "brief-frame", briefFrameId: state.session.selection.briefFrameId },
    },
    documents: sorted(Object.values(state.documents)).map((item) => ({ ...item, rootNodeIds: [...item.rootNodeIds], pageIds: [...item.pageIds] })),
    pages: sorted(Object.values(state.pages)).map((item) => ({ ...item, frameIds: [...item.frameIds] })),
    frames: sorted(Object.values(state.frames)).map((item) => ({ ...item })),
    nodes: sorted(Object.values(state.nodes)).map((item) => ({
      id: item.id,
      documentId: item.documentId,
      parentId: item.parentId,
      kind: item.kind,
      name: item.name,
      ...(item.tagName !== undefined ? { tagName: item.tagName } : {}),
      attributes: sortedMap(item.attributes),
      childIds: [...item.childIds],
      ...(item.locked !== undefined ? { locked: item.locked } : {}),
      ...(item.hidden !== undefined ? { hidden: item.hidden } : {}),
      ...(item.frameId !== undefined ? { frameId: item.frameId } : {}),
    })),
    activePageId: state.activePageId,
    selection: {
      frameIds: [...state.selection.frameIds],
      nodeIds: [...state.selection.nodeIds],
      primaryFrameId: state.selection.primaryFrameId,
      primaryNodeId: state.selection.primaryNodeId,
    },
    activeTool: state.activeTool,
    tokens: cloneTokenStore(state.tokens),
  };
}

function cloneTokenStore(store: TokenStoreState): TokenStoreState {
  return {
    sets: Object.fromEntries(
      Object.entries(store.sets).map(([id, set]) => [
        id,
        {
          ...set,
          tokens: Object.fromEntries(
            Object.entries(set.tokens).map(([tokenId, token]) => [
              tokenId,
              {
                ...token,
                value: typeof token.value === "object" && token.value !== null
                  ? { ...token.value }
                  : token.value,
              },
            ]),
          ),
        },
      ]),
    ),
    themes: Object.fromEntries(
      Object.entries(store.themes).map(([id, theme]) => [id, { ...theme, setIds: [...theme.setIds] }]),
    ),
    activeThemeId: store.activeThemeId,
    revision: store.revision,
  };
}

export function exportWireCanvasProject(state: EditorState): WireCanvasProjectV1 {
  return {
    kind: WIRECANVAS_FILE_KIND,
    schemaVersion: WIRECANVAS_FILE_SCHEMA_VERSION,
    state: durableStateFromEditorState(state),
  };
}

export function serializeWireCanvasProject(state: EditorState): string {
  return `${JSON.stringify(exportWireCanvasProject(state), null, 2)}\n`;
}

/**
 * Compact serialization for browser storage. Pretty-printing costs ~15–30%
 * extra bytes per project against the localStorage quota and buys nothing —
 * stored payloads are only ever read back through the parser.
 */
export function serializeWireCanvasProjectCompact(state: EditorState): string {
  return JSON.stringify(exportWireCanvasProject(state));
}

export function parseWireCanvasProject(text: string): EditorState {
  if (typeof text !== "string") fail("invalid-json", "file", "expected UTF-8 text");
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > WIRECANVAS_LIMITS.maxFileBytes) fail("file-too-large", "file", `file exceeds the ${WIRECANVAS_LIMITS.maxFileBytes}-byte limit`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    fail("invalid-json", "file", error instanceof Error ? error.message : "JSON could not be parsed");
  }
  const root = record(parsed, "file");
  expectKeys(root, ["kind", "schemaVersion", "state"], "file");
  if (root.kind !== WIRECANVAS_FILE_KIND) fail("invalid-root", "file.kind", `must be ${WIRECANVAS_FILE_KIND}`);
  if (root.schemaVersion !== WIRECANVAS_FILE_SCHEMA_VERSION) {
    if (typeof root.schemaVersion === "number" && root.schemaVersion > WIRECANVAS_FILE_SCHEMA_VERSION) fail("unsupported-file-version", "file.schemaVersion", `future file schema ${root.schemaVersion} is not supported`);
    fail("invalid-root", "file.schemaVersion", `must be ${WIRECANVAS_FILE_SCHEMA_VERSION}`);
  }
  const durable = readDurableState(root.state, "file.state");
  return {
    tokens: durable.tokens,
    documents: Object.fromEntries(durable.documents.map((item) => [item.id, item])),
    pages: Object.fromEntries(durable.pages.map((item) => [item.id, item])),
    frames: Object.fromEntries(durable.frames.map((item) => [item.id, item])),
    nodes: Object.fromEntries(durable.nodes.map((item) => [item.id, item])),
    session: durable.session,
    activePageId: durable.activePageId,
    selection: durable.selection,
    activeTool: durable.activeTool,
  };
}

export function wireCanvasStatesEqual(left: EditorState, right: EditorState): boolean {
  return serializeWireCanvasProject(left) === serializeWireCanvasProject(right);
}

export interface WireCanvasImportResult {
  changed: boolean;
  state: EditorState;
}

export function importWireCanvasProject(store: EditorStore, text: string): WireCanvasImportResult {
  const candidate = parseWireCanvasProject(text);
  const changed = store.replaceState(candidate, {
    label: "Import WireCanvas project",
    equals: wireCanvasStatesEqual,
  });
  return { changed, state: store.getState() };
}
