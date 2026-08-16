import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderOpen,
  Layers3,
  Lock,
  LockKeyholeOpen,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  SquareStack,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { BridgeHierarchySnapshot } from "../bridge/protocol";
import type { FrameRenderModel, NodeEntity, PageEntity, SelectionState } from "../editor/model";
import { buildLayerTree, layerDisplayName, siblingIdsForNode, type LayerTreeNode } from "./panel-model";

type SidebarTab = "pages" | "layers" | "assets";

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
  onReorderNode: (nodeId: string, direction: "up" | "down") => void;
}

function EditableLabel({
  value,
  onSave,
  className,
  testId,
  editSignal = 0,
}: {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  testId?: string;
  editSignal?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => { if (editSignal > 0) setEditing(true); }, [editSignal]);
  const save = () => {
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    setEditing(false);
  };
  if (!editing) {
    return (
      <button
        className={className ?? "sidebar-label-button"}
        onDoubleClick={() => setEditing(true)}
        type="button"
      >
        {value}
      </button>
    );
  }
  return (
    <input
      autoFocus
      className="sidebar-inline-input"
      data-testid={testId}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
        if (event.key === "Escape") setEditing(false);
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
  nodes,
  snapshot,
  onToggleExpanded,
  onSelectNode,
  onRenameNode,
  onToggleNodeLock,
  onToggleNodeHidden,
  onReorderNode,
}: {
  frameId: string;
  tree: LayerTreeNode;
  depth: number;
  expanded: Set<string>;
  selected: Set<string>;
  nodes: Record<string, NodeEntity>;
  snapshot: BridgeHierarchySnapshot;
  onToggleExpanded: (id: string) => void;
  onSelectNode: (frameId: string, nodeId: string, shiftKey: boolean) => void;
  onRenameNode: (nodeId: string, name: string) => void;
  onToggleNodeLock: (nodeId: string) => void;
  onToggleNodeHidden: (frameId: string, nodeId: string) => void;
  onReorderNode: (nodeId: string, direction: "up" | "down") => void;
}) {
  const target = tree.target;
  const node = nodes[target.elementId];
  const isLocked = node?.locked ?? target.locked ?? false;
  const isHidden = node?.hidden ?? false;
  const hasChildren = tree.children.length > 0;
  const isExpanded = expanded.has(target.elementId);
  const displayName = layerDisplayName(target, nodes);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const siblings = siblingIdsForNode(target, snapshot);
  const siblingIndex = siblings.indexOf(target.elementId);
  useEffect(() => setDraft(displayName), [displayName]);
  const saveName = () => {
    const next = draft.trim();
    if (next && next !== displayName) onRenameNode(target.elementId, next);
    setEditing(false);
  };
  return (
    <div className="layer-tree-node" data-testid={`layer-row-${frameId}-${target.elementId}`}>
      <div
        className={`layer-row${selected.has(target.elementId) ? " is-selected" : ""}${isHidden ? " is-hidden" : ""}`}
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
          aria-pressed={selected.has(target.elementId)}
          onClick={(event) => onSelectNode(frameId, target.elementId, event.shiftKey)}
          type="button"
        >
          <span className="layer-kind-mark">{target.tagName.slice(0, 1).toUpperCase()}</span>
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
            className="layer-action-button layer-more-button"
            aria-label={`Layer actions for ${displayName}`}
            title="Layer actions"
            onClick={() => { if (siblingIndex > 0) onReorderNode(target.elementId, "up"); else setEditing(true); }}
            type="button"
          >
            <MoreHorizontal size={12} />
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
          nodes={nodes}
          snapshot={snapshot}
          onToggleExpanded={onToggleExpanded}
          onSelectNode={onSelectNode}
          onRenameNode={onRenameNode}
          onToggleNodeLock={onToggleNodeLock}
          onToggleNodeHidden={onToggleNodeHidden}
          onReorderNode={onReorderNode}
        />
      )) : null}
    </div>
  );
}

function PagesPanel({ pages, activePageId, frames, onCreatePage, onRenamePage, onSwitchPage }: Pick<LeftSidebarProps, "pages" | "activePageId" | "frames" | "onCreatePage" | "onRenamePage" | "onSwitchPage">) {
  const [renameSignals, setRenameSignals] = useState<Record<string, number>>({});
  return (
    <section className="sidebar-panel-content" aria-label="Pages panel">
      <div className="sidebar-panel-heading">
        <div><span className="sidebar-eyebrow">Workspace</span><h2>Pages</h2></div>
        <button className="sidebar-icon-button" data-testid="add-page-button" aria-label="Add page" title="Add page" onClick={onCreatePage} type="button"><Plus size={15} /></button>
      </div>
      <p className="sidebar-panel-copy">Organize responsive explorations into focused flows.</p>
      <div className="page-list">
        {pages.map((page) => {
          const frameCount = frames.filter((frame) => frame.pageId === page.id).length;
          return (
            <div className={`page-row${page.id === activePageId ? " is-active" : ""}`} key={page.id}>
              <button className="page-select-button" aria-current={page.id === activePageId ? "page" : undefined} onClick={() => onSwitchPage(page.id)} type="button">
                <span className="page-icon"><FolderOpen size={14} /></span>
                <span className="page-copy"><strong><EditableLabel value={page.name} editSignal={renameSignals[page.id] ?? 0} onSave={(name) => onRenamePage(page.id, name)} /></strong><small>{frameCount} {frameCount === 1 ? "frame" : "frames"}</small></span>
              </button>
              <button className="page-more-button" aria-label={`Rename ${page.name}`} data-testid={`page-rename-${page.id}`} onClick={() => setRenameSignals((current) => ({ ...current, [page.id]: (current[page.id] ?? 0) + 1 }))} type="button"><MoreHorizontal size={14} /></button>
            </div>
          );
        })}
      </div>
      <div className="sidebar-footnote"><Sparkles size={13} /><span>Pages are saved with this file</span></div>
    </section>
  );
}

function LayersPanel({
  frames, hierarchies, nodes, selection, onSelectNode, onRenameNode, onToggleNodeLock, onToggleNodeHidden, onReorderNode,
}: Pick<LeftSidebarProps, "frames" | "hierarchies" | "nodes" | "selection" | "onSelectNode" | "onRenameNode" | "onToggleNodeLock" | "onToggleNodeHidden" | "onReorderNode">) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const selected = useMemo(() => new Set(selection.nodeIds), [selection.nodeIds]);
  const frameEntries = frames.map((frame) => ({ frame, snapshot: hierarchies[frame.id] })).filter(({ snapshot }) => snapshot);
  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      frameEntries.forEach(({ snapshot }) => snapshot?.nodes.forEach((node) => { if (node.childIds.length > 0) next.add(node.elementId); }));
      return next;
    });
  }, [frameEntries.map(({ frame }) => frame.id).join("|"), Object.keys(hierarchies).length]);

  return (
    <section className="sidebar-panel-content" aria-label="Layers panel">
      <div className="sidebar-panel-heading"><div><span className="sidebar-eyebrow">Structure</span><h2>Layers</h2></div><span className="sidebar-count">{selection.nodeIds.length ? `${selection.nodeIds.length} selected` : "Live"}</span></div>
      <div className="sidebar-search"><Search size={14} /><input aria-label="Search layers" placeholder="Search layers" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {frameEntries.length === 0 ? (
        <div className="sidebar-empty"><Layers3 size={20} /><strong>No live layers yet</strong><span>Select a frame to inspect its hierarchy.</span></div>
      ) : (
        <div className="layer-frame-list">
          {frameEntries.map(({ frame, snapshot }) => {
            if (!snapshot) return null;
            const tree = buildLayerTree(snapshot, query, nodes);
            return (
              <div className="layer-frame-group" key={frame.id}>
                <div className="layer-frame-heading"><SquareStack size={13} /><span>{frame.name}</span><small>{snapshot.nodes.length}</small></div>
                {tree.length === 0 ? <div className="layer-filter-empty">No matching layers</div> : tree.map((item) => <LayerRow key={item.target.elementId} frameId={frame.id} tree={item} depth={0} expanded={expanded} selected={selected} nodes={nodes} snapshot={snapshot} onToggleExpanded={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onSelectNode={onSelectNode} onRenameNode={onRenameNode} onToggleNodeLock={onToggleNodeLock} onToggleNodeHidden={onToggleNodeHidden} onReorderNode={onReorderNode} />)}
              </div>
            );
          })}
        </div>
      )}
      <div className="sidebar-footnote"><span>Live hierarchy</span><span className="sidebar-footnote-dot" /> <span>Bridge synced</span></div>
    </section>
  );
}

function AssetsPanel() {
  return (
    <section className="sidebar-panel-content" aria-label="Assets panel">
      <div className="sidebar-panel-heading"><div><span className="sidebar-eyebrow">Library</span><h2>Assets</h2></div><button className="sidebar-icon-button" aria-label="Asset options" type="button"><Menu size={15} /></button></div>
      <div className="assets-empty"><span className="assets-empty-icon"><WandSparkles size={21} /></span><strong>Your library is ready</strong><p>Imported images, components, and shared styles will collect here as the file grows.</p><button className="asset-placeholder-button" disabled type="button"><Upload size={14} /> Import assets <small>Coming soon</small></button></div>
      <div className="asset-preview-card"><span className="asset-preview-swatch" /><span><strong>Embedded library</strong><small>0 assets · local to this file</small></span></div>
    </section>
  );
}

export function LeftSidebar(props: LeftSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>("layers");
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(276);
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
    { id: "assets", label: "Assets", icon: SquareStack },
  ];
  return (
    <aside className={`left-sidebar${collapsed ? " is-collapsed" : ""}`} data-canvas-control data-testid="left-sidebar" onWheel={(event) => event.stopPropagation()} style={{ width: collapsed ? 48 : width + 48 }}>
      <nav className="sidebar-rail" aria-label="Navigation panels">
        <button className="sidebar-collapse-button" data-testid="left-sidebar-toggle" aria-label={collapsed ? "Expand left sidebar" : "Collapse left sidebar"} onClick={() => setCollapsed((current) => !current)} type="button">{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>
        <span className="sidebar-rail-divider" />
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} className={`sidebar-rail-tab${tab === id ? " is-active" : ""}`} data-testid={`sidebar-tab-${id}`} aria-label={label} aria-pressed={tab === id} onClick={() => { setTab(id); setCollapsed(false); }} type="button"><Icon size={16} /></button>)}
      </nav>
      {!collapsed ? <div className="left-sidebar-panel" style={{ width }}>
        <div className="sidebar-tabs" role="tablist" aria-label="Sidebar views">{tabs.map(({ id, label }) => <button key={id} className={`sidebar-tab${tab === id ? " is-active" : ""}`} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} type="button">{label}</button>)}</div>
        {tab === "pages" ? <PagesPanel {...props} /> : null}
        {tab === "layers" ? <LayersPanel {...props} /> : null}
        {tab === "assets" ? <AssetsPanel /> : null}
        <button className="sidebar-resize-handle" aria-label="Resize left sidebar" onPointerDown={onResizePointerDown} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp} type="button" />
      </div> : null}
    </aside>
  );
}
