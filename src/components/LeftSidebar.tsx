import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderOpen,
  Frame,
  Group,
  Image as ImageIcon,
  Layers3,
  Lock,
  LockKeyholeOpen,
  MoreHorizontal,
  MousePointerClick,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Shapes,
  Sparkles,
  SquareStack,
  TextCursorInput,
  Type,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { BridgeHierarchyNode, BridgeHierarchySnapshot } from "../bridge/protocol";
import type { FrameRenderModel, NodeEntity, PageEntity, SelectionState } from "../editor/model";
import type { CanvasShaderElement, ShaderParams } from "../shaders";
import { buildLayerTree, countLayerNodes, type LayerIconKind, type LayerTreeNode } from "./panel-model";
import { ShadersPanel } from "./ShadersPanel";

type SidebarTab = "pages" | "layers" | "shaders" | "tokens" | "assets";

const LAYER_ICONS: Record<LayerIconKind, ReactNode> = {
  frame: <Frame size={11} />,
  group: <Group size={11} />,
  text: <Type size={11} />,
  image: <ImageIcon size={11} />,
  vector: <Shapes size={11} />,
  button: <MousePointerClick size={11} />,
  field: <TextCursorInput size={11} />,
};

export interface LeftSidebarProps {
  pages: PageEntity[];
  activePageId: string | null;
  frames: FrameRenderModel[];
  hierarchies: Record<string, BridgeHierarchySnapshot>;
  nodes: Record<string, NodeEntity>;
  selection: SelectionState;
  onCreatePage: () => void;
  onRenamePage: (pageId: string, name: string) => void;
  onSwitchPage: (pageId: string) => void;
  onSelectNode: (frameId: string, nodeId: string, shiftKey: boolean) => void;
  onRenameNode: (nodeId: string, name: string) => void;
  onToggleNodeLock: (nodeId: string) => void;
  onToggleNodeHidden: (frameId: string, nodeId: string) => void;
  onHoverNode?: (frameId: string, nodeId: string) => void;
  onHoverNodeEnd?: () => void;
  hoveredLayerNode?: { frameId: string; nodeId: string } | null;
  tokensPanel?: ReactNode;
  shaderElements?: CanvasShaderElement[];
  selectedShaderElementId?: string | null;
  onSelectShaderElement?: (elementId: string | null) => void;
  onUpdateShaderParams?: (elementId: string, params: ShaderParams) => void;
  onDeleteShaderElement?: (elementId: string) => void;
}

function PageRenameInput({
  page,
  onCommit,
  onCancel,
}: {
  page: PageEntity;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(page.name);
  const save = () => {
    const next = draft.trim();
    if (next && next !== page.name) onCommit(next);
    onCancel();
  };
  return (
    <input
      autoFocus
      className="sidebar-inline-input"
      data-testid={`page-rename-input-${page.id}`}
      aria-label={`Rename ${page.name}`}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
        if (event.key === "Escape") onCancel();
      }}
    />
  );
}

interface FlatLayerRow {
  target: BridgeHierarchyNode;
  name: string;
  icon: LayerIconKind;
  depth: number;
  hasChildren: boolean;
}

/** DFS over the tree yielding only rows the panel actually paints. */
function flattenVisibleTree(tree: readonly LayerTreeNode[], expanded: Set<string>): FlatLayerRow[] {
  const rows: FlatLayerRow[] = [];
  const walk = (nodes: readonly LayerTreeNode[], depth: number) => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      rows.push({ target: node.target, name: node.name, icon: node.icon, depth, hasChildren });
      if (hasChildren && expanded.has(node.target.elementId)) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}

// Props are primitives or referentially stable entities, so memo skips every
// row unaffected by a selection/hover/lock update — with hundreds of rows the
// panel previously re-rendered all of them on any editor change.
const LayerRow = memo(function LayerRow({
  frameId,
  target,
  name,
  icon,
  depth,
  hasChildren,
  isExpanded,
  isSelected,
  isHovered,
  nodeEntity,
  onToggleExpanded,
  onSelectNode,
  onRenameNode,
  onToggleNodeLock,
  onToggleNodeHidden,
  onHoverNode,
  onHoverNodeEnd,
}: {
  frameId: string;
  target: BridgeHierarchyNode;
  name: string;
  icon: LayerIconKind;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isHovered: boolean;
  nodeEntity: NodeEntity | undefined;
  onToggleExpanded: (id: string) => void;
  onSelectNode: (frameId: string, nodeId: string, shiftKey: boolean) => void;
  onRenameNode: (nodeId: string, name: string) => void;
  onToggleNodeLock: (nodeId: string) => void;
  onToggleNodeHidden: (frameId: string, nodeId: string) => void;
  onHoverNode?: (frameId: string, nodeId: string) => void;
  onHoverNodeEnd?: () => void;
}) {
  const isLocked = nodeEntity?.locked ?? target.locked ?? false;
  const isHidden = nodeEntity?.hidden ?? false;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    if (editing) setDraft(name);
  }, [editing, name]);
  const saveName = () => {
    const next = draft.trim();
    if (next && next !== name) onRenameNode(target.elementId, next);
    setEditing(false);
  };
  return (
    <div
      className="layer-tree-node"
      data-testid={`layer-row-${frameId}-${target.elementId}`}
      onPointerEnter={() => onHoverNode?.(frameId, target.elementId)}
      onPointerLeave={() => onHoverNodeEnd?.()}
    >
      <div
        className={`layer-row${isSelected ? " is-selected" : ""}${isHovered ? " is-hovered" : ""}${isHidden ? " is-hidden" : ""}`}
        style={{ paddingLeft: 8 + depth * 15 }}
      >
        <button
          className="layer-expand-button"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name}`}
          disabled={!hasChildren}
          onClick={() => onToggleExpanded(target.elementId)}
          type="button"
        >
          {hasChildren ? (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="layer-expand-spacer" />}
        </button>
        <button
          className="layer-select-button"
          aria-pressed={isSelected}
          onClick={(event) => onSelectNode(frameId, target.elementId, event.shiftKey)}
          type="button"
        >
          <span className="layer-kind-mark">{LAYER_ICONS[icon]}</span>
          {editing ? <input autoFocus className="layer-inline-input" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={saveName} onKeyDown={(event) => { if (event.key === "Enter") saveName(); if (event.key === "Escape") setEditing(false); }} /> : <span className="layer-name" title={name} onDoubleClick={() => setEditing(true)}>{name}</span>}
        </button>
        <span className="layer-actions">
          <button
            className="layer-action-button"
            aria-label={`${isLocked ? "Unlock" : "Lock"} ${name}`}
            title={`${isLocked ? "Unlock" : "Lock"} layer`}
            onClick={() => onToggleNodeLock(target.elementId)}
            type="button"
          >
            {isLocked ? <Lock size={12} /> : <LockKeyholeOpen size={12} />}
          </button>
          <button
            className="layer-action-button"
            aria-label={`${isHidden ? "Show" : "Hide"} ${name}`}
            title={`${isHidden ? "Show" : "Hide"} layer`}
            onClick={() => onToggleNodeHidden(frameId, target.elementId)}
            type="button"
          >
            {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button
            className="layer-action-button"
            aria-label={`Rename ${name}`}
            title="Rename layer"
            onClick={() => setEditing(true)}
            type="button"
          >
            <Pencil size={12} />
          </button>
        </span>
      </div>
    </div>
  );
});

function PagesPanel({ pages, activePageId, frames, onCreatePage, onRenamePage, onSwitchPage }: Pick<LeftSidebarProps, "pages" | "activePageId" | "frames" | "onCreatePage" | "onRenamePage" | "onSwitchPage">) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  return (
    <section className="sidebar-panel-content" aria-label="Pages panel">
      <div className="sidebar-panel-heading">
        <span className="sidebar-count">{pages.length} {pages.length === 1 ? "page" : "pages"}</span>
        <button className="sidebar-icon-button" data-testid="add-page-button" aria-label="Add page" title="Add page" onClick={onCreatePage} type="button"><Plus size={15} /></button>
      </div>
      <div className="page-list">
        {pages.map((page) => {
          const frameCount = frames.filter((frame) => frame.pageId === page.id).length;
          const startRename = () => setRenamingId(page.id);
          const stopRename = () => setRenamingId(null);
          return (
            <div className={`page-row${page.id === activePageId ? " is-active" : ""}`} key={page.id}>
              {renamingId === page.id ? (
                <PageRenameInput page={page} onCommit={(name) => { onRenamePage(page.id, name); stopRename(); }} onCancel={stopRename} />
              ) : (
                <button className="page-select-button" aria-current={page.id === activePageId ? "page" : undefined} onClick={() => onSwitchPage(page.id)} type="button">
                  <span className="page-icon" aria-hidden="true"><FolderOpen size={14} /></span>
                  <span className="page-copy"><strong>{page.name}</strong><small aria-hidden="true">{frameCount} {frameCount === 1 ? "frame" : "frames"}</small></span>
                </button>
              )}
              <button className="page-more-button" aria-label={`Rename ${page.name}`} data-testid={`page-rename-${page.id}`} onClick={startRename} type="button"><MoreHorizontal size={14} /></button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface LayerFrameGroupProps extends Pick<LeftSidebarProps, "nodes" | "onSelectNode" | "onRenameNode" | "onToggleNodeLock" | "onToggleNodeHidden" | "onHoverNode" | "onHoverNodeEnd" | "hoveredLayerNode"> {
  frame: FrameRenderModel;
  snapshot: BridgeHierarchySnapshot;
  query: string;
  expanded: Set<string>;
  selectedNodeIds: Set<string>;
  selectedFrameIds: Set<string>;
  onToggleExpanded: (id: string) => void;
}

function LayerFrameGroup({
  frame, snapshot, query, nodes, expanded, selectedNodeIds, selectedFrameIds,
  hoveredLayerNode, onToggleExpanded, onSelectNode, onRenameNode, onToggleNodeLock,
  onToggleNodeHidden, onHoverNode, onHoverNodeEnd,
}: LayerFrameGroupProps) {
  const tree = useMemo(() => buildLayerTree(snapshot, query, nodes), [snapshot, query, nodes]);
  const rows = useMemo(() => flattenVisibleTree(tree, expanded), [tree, expanded]);
  const hoveredNodeId = hoveredLayerNode?.frameId === frame.id ? hoveredLayerNode.nodeId : null;
  return (
    <div className="layer-frame-group">
      <div className="layer-frame-heading"><SquareStack size={13} /><span>{frame.name}</span><small>{countLayerNodes(tree)}</small></div>
      {rows.length === 0 ? <div className="layer-filter-empty">No matching layers</div> : rows.map((row) => (
        <LayerRow
          key={row.target.elementId}
          frameId={frame.id}
          target={row.target}
          name={row.name}
          icon={row.icon}
          depth={row.depth}
          hasChildren={row.hasChildren}
          isExpanded={expanded.has(row.target.elementId)}
          isSelected={selectedNodeIds.has(row.target.elementId) && (selectedFrameIds.size === 0 || selectedFrameIds.has(frame.id))}
          isHovered={hoveredNodeId === row.target.elementId}
          nodeEntity={nodes[row.target.elementId]}
          onToggleExpanded={onToggleExpanded}
          onSelectNode={onSelectNode}
          onRenameNode={onRenameNode}
          onToggleNodeLock={onToggleNodeLock}
          onToggleNodeHidden={onToggleNodeHidden}
          onHoverNode={onHoverNode}
          onHoverNodeEnd={onHoverNodeEnd}
        />
      ))}
    </div>
  );
}

function LayersPanel({
  frames, hierarchies, nodes, selection, onSelectNode, onRenameNode, onToggleNodeLock, onToggleNodeHidden, onHoverNode, onHoverNodeEnd, hoveredLayerNode,
}: Pick<LeftSidebarProps, "frames" | "hierarchies" | "nodes" | "selection" | "onSelectNode" | "onRenameNode" | "onToggleNodeLock" | "onToggleNodeHidden" | "onHoverNode" | "onHoverNodeEnd" | "hoveredLayerNode">) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const expandedFrameIdsRef = useRef<Set<string>>(new Set());
  const selectedNodeIds = useMemo(() => new Set(selection.nodeIds), [selection.nodeIds]);
  const selectedFrameIds = useMemo(() => new Set(selection.frameIds), [selection.frameIds]);
  const frameEntries = useMemo(
    () => frames
      .map((frame) => ({ frame, snapshot: hierarchies[frame.id] }))
      .filter((entry): entry is { frame: FrameRenderModel; snapshot: BridgeHierarchySnapshot } => Boolean(entry.snapshot)),
    [frames, hierarchies],
  );
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      let changed = false;
      frameEntries.forEach(({ frame, snapshot }) => {
        if (expandedFrameIdsRef.current.has(frame.id)) return;
        snapshot.nodes.forEach((node) => {
          if (node.childIds.length > 0 && !next.has(node.elementId)) {
            next.add(node.elementId);
            changed = true;
          }
        });
        expandedFrameIdsRef.current.add(frame.id);
      });
      return changed ? next : current;
    });
  }, [frameEntries]);

  return (
    <section className="sidebar-panel-content" aria-label="Layers panel">
      <div className="sidebar-search"><Search size={14} /><input aria-label="Search layers" placeholder="Search layers" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {frameEntries.length === 0 ? (
        <div className="sidebar-empty"><Layers3 size={20} /><strong>No layers yet</strong></div>
      ) : (
        <div className="layer-frame-list">
          {frameEntries.map(({ frame, snapshot }) => (
            <LayerFrameGroup
              key={frame.id}
              frame={frame}
              snapshot={snapshot}
              query={query}
              nodes={nodes}
              expanded={expanded}
              selectedNodeIds={selectedNodeIds}
              selectedFrameIds={selectedFrameIds}
              hoveredLayerNode={hoveredLayerNode}
              onToggleExpanded={toggleExpanded}
              onSelectNode={onSelectNode}
              onRenameNode={onRenameNode}
              onToggleNodeLock={onToggleNodeLock}
              onToggleNodeHidden={onToggleNodeHidden}
              onHoverNode={onHoverNode}
              onHoverNodeEnd={onHoverNodeEnd}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AssetsPanel() {
  return (
    <section className="sidebar-panel-content" aria-label="Assets panel">
      <div className="sidebar-empty"><SquareStack size={20} /><strong>No assets yet</strong></div>
    </section>
  );
}

export function LeftSidebar(props: LeftSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>("layers");
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth <= 900);
  // Selecting a shader element on the canvas surfaces its editor here —
  // fired only on selection transitions so param edits can't yank the user
  // back onto the tab after they've navigated away.
  const lastShaderSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    const selected = props.selectedShaderElementId ?? null;
    if (selected === lastShaderSelectionRef.current) return;
    lastShaderSelectionRef.current = selected;
    if (selected && props.shaderElements?.some((entry) => entry.id === selected)) {
      setTab("shaders");
      setCollapsed(false);
    }
  }, [props.selectedShaderElementId, props.shaderElements]);
  const [width, setWidth] = useState(264);
  const [dragStart, setDragStart] = useState<{ x: number; width: number } | null>(null);
  const onResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({ x: event.clientX, width });
  };
  const onResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragStart) return;
    setWidth(Math.min(380, Math.max(226, dragStart.width + event.clientX - dragStart.x)));
  };
  const onResizePointerUp = () => setDragStart(null);
  const tabs: Array<{ id: SidebarTab; label: string; icon: typeof FolderOpen }> = [
    { id: "pages", label: "Pages", icon: FolderOpen },
    { id: "layers", label: "Layers", icon: Layers3 },
    ...(props.shaderElements ? [{ id: "shaders" as SidebarTab, label: "Shaders", icon: Sparkles }] : []),
    ...(props.tokensPanel ? [{ id: "tokens" as SidebarTab, label: "Tokens", icon: Palette }] : []),
    { id: "assets", label: "Assets", icon: SquareStack },
  ];
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setTab(tabs[next].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <aside className={`left-sidebar${collapsed ? " is-collapsed" : ""}`} data-canvas-control data-testid="left-sidebar" onWheel={(event) => event.stopPropagation()} style={{ width: collapsed ? 48 : width }}>
      {collapsed ? <>
        <div className="sidebar-topline">
          <button className="sidebar-collapse-button" data-testid="left-sidebar-toggle" aria-label="Expand left sidebar" onClick={() => setCollapsed(false)} type="button"><PanelLeftOpen size={16} /></button>
        </div>
        <nav className="sidebar-rail" aria-label="Navigation panels">
          {tabs.map(({ id, label, icon: Icon }) => <button key={id} className={`sidebar-rail-tab${tab === id ? " is-active" : ""}`} data-testid={`sidebar-tab-${id}`} aria-label={label} aria-pressed={tab === id} onClick={() => { setTab(id); setCollapsed(false); }} type="button"><Icon size={16} /></button>)}
        </nav>
      </> : <div className="left-sidebar-panel">
        <div className="sidebar-tabbar">
          <div className="sidebar-tabs" role="tablist" aria-label="Sidebar views">{tabs.map(({ id, label, icon: Icon }, index) => <button key={id} id={`sidebar-view-${id}`} data-testid={`sidebar-tab-${id}`} className={`sidebar-tab${tab === id ? " is-active" : ""}`} role="tab" aria-selected={tab === id} aria-controls="sidebar-active-panel" aria-label={label} title={label} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={(event) => handleTabKey(event, index)} type="button"><Icon size={14} strokeWidth={1.8} aria-hidden="true" /></button>)}</div>
          <button className="sidebar-collapse-button" data-testid="left-sidebar-toggle" aria-label="Collapse left sidebar" onClick={() => setCollapsed(true)} type="button"><PanelLeftClose size={16} /></button>
        </div>
        <div className="sidebar-active-panel" id="sidebar-active-panel" role="tabpanel" aria-labelledby={`sidebar-view-${tab}`}>
          {tab === "pages" ? <PagesPanel {...props} /> : null}
          {tab === "layers" ? <LayersPanel {...props} /> : null}
          {tab === "shaders" && props.shaderElements ? (
            <ShadersPanel
              shaderElements={props.shaderElements}
              selectedShaderElementId={props.selectedShaderElementId}
              onSelectShaderElement={props.onSelectShaderElement}
              onUpdateShaderParams={props.onUpdateShaderParams}
              onDeleteShaderElement={props.onDeleteShaderElement}
            />
          ) : null}
          {tab === "tokens" && props.tokensPanel ? props.tokensPanel : null}
          {tab === "assets" ? <AssetsPanel /> : null}
        </div>
        <button className="sidebar-resize-handle" aria-label="Resize left sidebar" onPointerDown={onResizePointerDown} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp} onPointerCancel={onResizePointerUp} onLostPointerCapture={onResizePointerUp} type="button" />
      </div>}
    </aside>
  );
}
