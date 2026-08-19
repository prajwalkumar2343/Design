import type { DocumentMode } from "../editor/model";
import type { DeviceCategory, DeviceChrome } from "../frame/presets";

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
  /** Legacy canvas fixtures omit mode and therefore render as design. */
  mode?: DocumentMode;
  /** Device class the frame was created from; drives desktop-only affordances. */
  category?: DeviceCategory;
  chrome?: DeviceChrome;
  /** Optional normalized editor metadata used when a frame seeds another page. */
  pageId?: string;
  pageName?: string;
  documentName?: string;
  srcDoc: string;
  background: string;
}
