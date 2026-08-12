export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasFrame extends Rect {
  id: string;
  name: string;
  documentId: string;
  /** Optional normalized editor metadata used when a frame seeds another page. */
  pageId?: string;
  pageName?: string;
  documentName?: string;
  srcDoc: string;
  background: string;
}
