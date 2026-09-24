declare module "css-tree" {
  export interface CssTreeNode {
    type: string;
    [key: string]: unknown;
  }

  /**
   * css-tree's List container. `first` is a getter, `toArray` unwraps to plain
   * nodes. `generate` also accepts plain node arrays assigned to `children`,
   * so transforms can rebuild lists with `fromArray` or plain arrays.
   */
  export interface CssTreeList<T extends CssTreeNode = CssTreeNode> {
    readonly first: T | null;
    readonly last: T | null;
    readonly isEmpty: boolean;
    toArray(): T[];
    forEach(callback: (node: T) => void): void;
    map<R>(callback: (node: T) => R): R[];
    some(callback: (node: T) => boolean): boolean;
    prependData(data: T): void;
    appendData(data: T): void;
  }

  export interface CssTreeParseOptions {
    context?: string;
  }

  export function parse(source: string, options?: CssTreeParseOptions): CssTreeNode;
  export function walk(
    root: CssTreeNode,
    callback: (node: CssTreeNode) => void,
  ): void;
  export function generate(node: CssTreeNode): string;
}
