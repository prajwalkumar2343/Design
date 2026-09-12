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
  SquareStack,
  TextCursorInput,
  Type,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { BridgeHierarchySnapshot } from "../bridge/protocol";
import type { FrameRenderModel, NodeEntity, PageEntity, SelectionState } from "../editor/model";
import { buildLayerTree, countLayerNodes, type LayerIconKind, type LayerTreeNode } from "./panel-model";

type SidebarTab = "pages" | "layers" | "tokens" | "assets";

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

function LayerRow({
  frameId,
  tree,
  depth,
  expanded,
  selected,
  selectedFrameIds,
  nodes,
  onToggleExpanded,
  onSelectNode,
  onRenameNode,
  onToggleNodeLock,
  onToggleNodeHidden,
  onHoverNode,
  onHoverNodeEnd,
  hoveredNodeId,
}: {
  frameId: string;
  tree: LayerTreeNode;
  depth: number;
  expanded: Set<string>;
  selected: Set<string>;
  selectedFrameIds?: Set<string>;
  nodes: Record<string, NodeEntity>;
  onToggleExpanded: (id: string) => void;
  onSelectNode: (frameId: string, nodeId: string, shiftKey: boolean) => void;
  onRenameNode: (nodeId: string, name: string) => void;
  onToggleNodeLock: (nodeId: string) => void;
  onToggleNodeHidden: (frameId: string, nodeId: string) => void;
  onHoverNode?: (frameId: string, nodeId: string) => void;
  onHoverNodeEnd?: () => void;
  hoveredNodeId?: string | null;
}) {
  const target = tree.target;
  const node = nodes[target.elementId];
  const isLocked = node?.locked ?? target.locked ?? false;
  const isHidden = node?.hidden ?? false;
  const hasChildren = tree.children.length > 0;
  const isExpanded = expanded.has(target.elementId);
  const displayName = tree.name;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  useEffect(() => {
    if (editing) setDraft(displayName);
  }, [editing, displayName]);
  const saveName = () => {
    const next = draft.trim();
    if (next && next !== displayName) onRenameNode(target.elementId, next);
    setEditing(false);
  };
  const isSelected = selected.has(target.elementId) && (!selectedFrameIds || selectedFrameIds.size === 0 || selectedFrameIds.has(frameId));
  return (
    <div
      className="layer-tree-node"
      data-testid={`layer-row-${frameId}-${target.elementId}`}
      onPointerEnter={() => onHoverNode?.(frameId, target.elementId)}
      onPointerLeave={() => onHoverNodeEnd?.()}
    >
      <div
        className={`layer-row${isSelected ? " is-selected" : ""}${hoveredNodeId === target.elementId ? " is-hovered" : ""}${isHidden ? " is-hidden" : ""}`}
        style={{ paddingLeft: 8 + depth * 15 }}
      >
        <button
          className="layer-expand-button"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${displayName}`}
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
          <span className="layer-kind-mark">{LAYER_ICONS[tree.icon]}</span>
          {editing ? <input autoFocus className="layer-inline-input" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={saveName} onKeyDown={(event) => { if (event.key === "Enter") saveName(); if (event.key === "Escape") setEditing(false); }} /> : <span className="layer-name" title={displayName} onDoubleClick={() => setEditing(true)}>{displayName}</span>}
        </button>
        <span className="layer-actions">
          <button
            className="layer-action-button"
            aria-label={`${isLocked ? "Unlock" : "Lock"} ${displayName}`}
            title={`${isLocked ? "Unlock" : "Lock"} layer`}
            onClick={() => onToggleNodeLock(target.elementId)}
            type="button"
          >
            {isLocked ? <Lock size={12} /> : <LockKeyholeOpen size={12} />}
          </button>
          <button
            className="layer-action-button"
            aria-label={`${isHidden ? "Show" : "Hide"} ${displayName}`}
            title={`${isHidden ? "Show" : "Hide"} layer`}
            onClick={() => onToggleNodeHidden(frameId, target.elementId)}
            type="button"
          >
            {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button
            className="layer-action-button"
            aria-label={`Rename ${displayName}`}
            title="Rename layer"
            onClick={() => setEditing(true)}
            type="button"
          >
            <Pencil size={12} />
          </button>
        </span>
      </div>
      {isExpanded ? tree.children.map((child) => (
        <LayerRow
          key={child.target.elementId}
          frameId={frameId}
          tree={child}
          depth={depth + 1}
          expanded={expanded}
          selected={selected}
          selectedFrameIds={selectedFrameIds}
          nodes={nodes}
          onToggleExpanded={onToggleExpanded}
          onSelectNode={onSelectNode}
          onRenameNode={onRenameNode}
          onToggleNodeLock={onToggleNodeLock}
          onToggleNodeHidden={onToggleNodeHidden}
          onHoverNode={onHoverNode}
          onHoverNodeEnd={onHoverNodeEnd}
          hoveredNodeId={hoveredNodeId}
        />
      )) : null}
    </div>
  );
}

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

function LayersPanel({
  frames, hierarchies, nodes, selection, onSelectNode, onRenameNode, onToggleNodeLock, onToggleNodeHidden, onHoverNode, onHoverNodeEnd, hoveredLayerNode,
}: Pick<LeftSidebarProps, "frames" | "hierarchies" | "nodes" | "selection" | "onSelectNode" | "onRenameNode" | "onToggleNodeLock" | "onToggleNodeHidden" | "onHoverNode" | "onHoverNodeEnd" | "hoveredLayerNode">) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const expandedFrameIdsRef = useRef<Set<string>>(new Set());
  const selectedNodeIds = useMemo(() => new Set(selection.nodeIds), [selection.nodeIds]);
  const selectedFrameIds = useMemo(() => new Set(selection.frameIds), [selection.frameIds]);
  const frameEntries = frames.map((frame) => ({ frame, snapshot: hierarchies[frame.id] })).filter(({ snapshot }) => snapshot);
  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      frameEntries.forEach(({ frame, snapshot }) => {
        if (expandedFrameIdsRef.current.has(frame.id)) return;
        snapshot?.nodes.forEach((node) => { if (node.childIds.length > 0) next.add(node.elementId); });
        expandedFrameIdsRef.current.add(frame.id);
      });
      return next;
    });
  }, [frameEntries.map(({ frame }) => frame.id).join("|"), Object.keys(hierarchies).length]);

  return (
    <section className="sidebar-panel-content" aria-label="Layers panel">
      <div className="sidebar-search"><Search size={14} /><input aria-label="Search layers" placeholder="Search layers" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {frameEntries.length === 0 ? (
        <div className="sidebar-empty"><Layers3 size={20} /><strong>No layers yet</strong></div>
      ) : (
        <div className="layer-frame-list">
          {frameEntries.map(({ frame, snapshot }) => {
            if (!snapshot) return null;
            const tree = buildLayerTree(snapshot, query, nodes);
            return (
              <div className="layer-frame-group" key={frame.id}>
                <div className="layer-frame-heading"><SquareStack size={13} /><span>{frame.name}</span><small>{countLayerNodes(tree)}</small></div>
                {tree.length === 0 ? <div className="layer-filter-empty">No matching layers</div> : tree.map((item) => <LayerRow key={item.target.elementId} frameId={frame.id} tree={item} depth={0} expanded={expanded} selected={selectedNodeIds} selectedFrameIds={selectedFrameIds} nodes={nodes} hoveredNodeId={hoveredLayerNode?.frameId === frame.id ? hoveredLayerNode.nodeId : null} onToggleExpanded={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onSelectNode={onSelectNode} onRenameNode={onRenameNode} onToggleNodeLock={onToggleNodeLock} onToggleNodeHidden={onToggleNodeHidden} onHoverNode={onHoverNode} onHoverNodeEnd={onHoverNodeEnd} />)}
              </div>
            );
          })}
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
          <div className="sidebar-tabs" role="tablist" aria-label="Sidebar views">{tabs.map(({ id, label }, index) => <button key={id} id={`sidebar-view-${id}`} data-testid={`sidebar-tab-${id}`} className={`sidebar-tab${tab === id ? " is-active" : ""}`} role="tab" aria-selected={tab === id} aria-controls="sidebar-active-panel" tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={(event) => handleTabKey(event, index)} type="button">{label}</button>)}</div>
          <button className="sidebar-collapse-button" data-testid="left-sidebar-toggle" aria-label="Collapse left sidebar" onClick={() => setCollapsed(true)} type="button"><PanelLeftClose size={16} /></button>
        </div>
        <div className="sidebar-active-panel" id="sidebar-active-panel" role="tabpanel" aria-labelledby={`sidebar-view-${tab}`}>
          {tab === "pages" ? <PagesPanel {...props} /> : null}
          {tab === "layers" ? <LayersPanel {...props} /> : null}
          {tab === "tokens" && props.tokensPanel ? props.tokensPanel : null}
          {tab === "assets" ? <AssetsPanel /> : null}
        </div>
        <button className="sidebar-resize-handle" aria-label="Resize left sidebar" onPointerDown={onResizePointerDown} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp} onPointerCancel={onResizePointerUp} onLostPointerCapture={onResizePointerUp} type="button" />
      </div>}
    </aside>
  );
}
