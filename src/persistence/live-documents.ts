import type { DocumentId, EditorState } from "../editor/model";

/**
 * A live frame document harvested from the iframe after mutations settled.
 * Bridge edits (moves, created elements, the freeform body shift) exist only
 * in the iframe's DOM — `document.srcDoc` stays at its last replace — so the
 * canvas holds the freshest copy here and overlays it onto serialized
 * payloads. Writing it into state would bump `revision` and force an iframe
 * reload, wiping the very live state it preserves.
 */
export interface PendingDocumentWrite {
  html: string;
  /** Document revision at harvest time — a replaceHtml/agent push makes the write stale. */
  revision: number;
}

/**
 * Returns `state` with each still-current pending write swapped into its
 * document's `srcDoc` for serialization. Stale entries (revision moved past
 * the harvest, or the document is gone) are dropped from the map.
 */
export function applyPendingDocumentWrites(
  state: EditorState,
  pending: Map<DocumentId, PendingDocumentWrite>,
): EditorState {
  if (pending.size === 0) return state;
  let documents = state.documents;
  let touched = false;
  for (const [documentId, write] of pending) {
    const document = state.documents[documentId];
    if (!document || document.revision !== write.revision || document.srcDoc === write.html) {
      pending.delete(documentId);
      continue;
    }
    if (!touched) {
      documents = { ...documents };
      touched = true;
    }
    documents[documentId] = { ...document, srcDoc: write.html };
  }
  return touched ? { ...state, documents } : state;
}
