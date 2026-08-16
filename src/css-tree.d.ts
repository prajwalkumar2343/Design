declare module "css-tree" {
  export interface CssTreeNode {
    type: string;
    [key: string]: unknown;
  }

  export interface CssTreeParseOptions {
    context?: string;
  }

  export function parse(source: string, options?: CssTreeParseOptions): CssTreeNode;
  export function walk(
    root: CssTreeNode,
    callback: (node: CssTreeNode) => void,
  ): void;
}
