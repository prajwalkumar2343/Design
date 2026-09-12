import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BridgeHierarchySnapshot } from "../bridge/protocol";
import { createEmptySelection, type FrameRenderModel } from "../editor/model";
import { LeftSidebar } from "./LeftSidebar";

const FRAME: FrameRenderModel = {
  id: "frame-1",
  pageId: "page-1",
  documentId: "doc-1",
  name: "Home",
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  background: "#ffffff",
  mode: "wireframe",
  srcDoc: "",
};

const HIERARCHY: BridgeHierarchySnapshot = {
  rootIds: ["el-1"],
  truncated: false,
  nodes: [
    {
      elementId: "el-1",
      tagName: "section",
      path: "html>body>section",
      name: "Hero",
      role: null,
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      parentId: null,
      childIds: [],
    },
  ],
};

function renderSidebar() {
  const onRenameNode = vi.fn();
  const utils = render(
    <LeftSidebar
      pages={[{ id: "page-1", documentId: "doc-1", name: "Page 1", frameIds: ["frame-1"] }]}
      activePageId="page-1"
      frames={[FRAME]}
      hierarchies={{ "frame-1": HIERARCHY }}
      nodes={{}}
      selection={createEmptySelection()}
      onCreatePage={() => {}}
      onRenamePage={() => {}}
      onSwitchPage={() => {}}
      onSelectNode={() => {}}
      onRenameNode={onRenameNode}
      onToggleNodeLock={() => {}}
      onToggleNodeHidden={() => {}}
    />,
  );
  return { onRenameNode, ...utils };
}

describe("LeftSidebar layer rename", () => {
  it("provides one keyboard-accessible navigation strip and restores it after collapse", () => {
    const { getByRole, getByTestId, queryByRole } = renderSidebar();
    const layers = getByRole("tab", { name: "Layers" });
    expect(layers.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(layers, { key: "ArrowRight" });
    expect(getByRole("tab", { name: "Assets" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(getByTestId("left-sidebar-toggle"));
    expect(queryByRole("tablist")).toBeNull();
    fireEvent.click(getByRole("button", { name: "Pages" }));
    expect(getByRole("tab", { name: "Pages" }).getAttribute("aria-selected")).toBe("true");
    expect(getByRole("region", { name: "Pages panel" })).toBeTruthy();
  });

  it("does not resurrect an abandoned rename draft on the next edit", () => {
    const { container, getByRole, onRenameNode } = renderSidebar();

    fireEvent.click(getByRole("button", { name: "Rename Hero" }));
    const input = container.querySelector<HTMLInputElement>(".layer-inline-input");
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "Abandoned name" } });
    fireEvent.keyDown(input!, { key: "Escape" });
    expect(onRenameNode).not.toHaveBeenCalled();

    fireEvent.click(getByRole("button", { name: "Rename Hero" }));
    const reopened = container.querySelector<HTMLInputElement>(".layer-inline-input");
    expect(reopened).not.toBeNull();
    expect(reopened!.value).toBe("Hero");
  });
});
