import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BRAINSTORM_OPENING_PROMPT } from "../router/brainstorm-session";
import type {
  BriefContent,
  BriefField,
  BriefFieldUpdate,
  BriefFrame,
  BriefListField,
  BriefReference,
  BriefTextField,
  ConfirmedDecision,
} from "../session/model";

interface BriefFrameViewProps {
  briefFrame: BriefFrame;
  isSelected: boolean;
  onSelect: (briefFrameId: string) => void;
  onStartMove: (briefFrameId: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onUpdateBriefField: (update: BriefFieldUpdate) => void;
  onAddReference: (reference: BriefReference) => void;
  onUpdateReference: (options: {
    referenceId: string;
    patch: Partial<Pick<BriefReference, "label" | "url" | "note">>;
  }) => void;
  onRemoveReference: (referenceId: string) => void;
  onAddDecision: (decision: ConfirmedDecision) => void;
  onUpdateDecision: (options: {
    decisionId: string;
    patch: Partial<Pick<ConfirmedDecision, "statement" | "rationale">>;
  }) => void;
  onRemoveDecision: (decisionId: string) => void;
}

const TEXT_FIELDS: Array<{ field: BriefTextField; label: string; placeholder: string }> = [
  { field: "projectDescription", label: "Project description", placeholder: "What are you making?" },
  { field: "audience", label: "Audience", placeholder: "Who is it for?" },
  { field: "visualDirection", label: "Visual direction", placeholder: "What should it feel like?" },
];

const LIST_FIELDS: Array<{ field: BriefListField; label: string; placeholder: string }> = [
  { field: "goals", label: "Goals", placeholder: "Add a goal" },
  { field: "successCriteria", label: "Success criteria", placeholder: "Add a success criterion" },
  { field: "requiredFeatures", label: "Required features", placeholder: "Add a required feature" },
  { field: "requiredContent", label: "Required content", placeholder: "Add required content" },
  { field: "constraints", label: "Constraints", placeholder: "Add a constraint" },
  { field: "openQuestions", label: "Open questions", placeholder: "Add an open question" },
];

const TEXT_FIELD_NAMES = TEXT_FIELDS.map(({ field }) => field);
const LIST_FIELD_NAMES = LIST_FIELDS.map(({ field }) => field);
type ReferenceDraft = Pick<BriefReference, "label" | "url" | "note">;
type DecisionDraft = Pick<ConfirmedDecision, "statement" | "rationale">;

function createStableId(prefix: string): string {
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

function createTextDrafts(content: BriefContent): Record<BriefTextField, string> {
  return Object.fromEntries(TEXT_FIELD_NAMES.map((field) => [field, content[field]])) as Record<BriefTextField, string>;
}

function createReferenceDraft(reference: BriefReference): ReferenceDraft {
  return { label: reference.label, url: reference.url, note: reference.note };
}

function createDecisionDraft(decision: ConfirmedDecision): DecisionDraft {
  return { statement: decision.statement, rationale: decision.rationale };
}

function listDraftKey(field: BriefListField, index: number): string {
  return `${field}:${index}`;
}

function referenceDraftKey(referenceId: string, field: keyof ReferenceDraft): string {
  return `${referenceId}:${field}`;
}

function decisionDraftKey(decisionId: string, field: keyof DecisionDraft): string {
  return `${decisionId}:${field}`;
}

function validateReferenceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Use an http:// or https:// link.";
    }
    return null;
  } catch {
    return "Enter a complete http:// or https:// link.";
  }
}

function safeReferenceUrl(value: string): string | null {
  return validateReferenceUrl(value) === null ? value : null;
}

export function BriefFrameView({
  briefFrame,
  isSelected,
  onSelect,
  onStartMove,
  onUpdateBriefField,
  onAddReference,
  onUpdateReference,
  onRemoveReference,
  onAddDecision,
  onUpdateDecision,
  onRemoveDecision,
}: BriefFrameViewProps) {
  const content = briefFrame.content;
  const [textDrafts, setTextDrafts] = useState(() => createTextDrafts(content));
  const [listDrafts, setListDrafts] = useState<Partial<Record<BriefListField, Record<string, string>>>>({});
  const [listAddDrafts, setListAddDrafts] = useState<Partial<Record<BriefListField, string>>>({});
  const [listErrors, setListErrors] = useState<Partial<Record<BriefListField, string>>>({});
  const [referenceDrafts, setReferenceDrafts] = useState<Record<string, ReferenceDraft>>({});
  const [referenceErrors, setReferenceErrors] = useState<Record<string, string>>({});
  const [newReference, setNewReference] = useState<ReferenceDraft>({ label: "", url: "", note: "" });
  const [newReferenceError, setNewReferenceError] = useState<string | null>(null);
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, DecisionDraft>>({});
  const [newDecision, setNewDecision] = useState<DecisionDraft>({ statement: "", rationale: "" });
  const [newDecisionError, setNewDecisionError] = useState<string | null>(null);
  const dirtyTextFieldsRef = useRef(new Set<BriefTextField>());
  const dirtyListItemsRef = useRef(new Set<string>());
  const dirtyReferenceFieldsRef = useRef(new Set<string>());
  const dirtyDecisionFieldsRef = useRef(new Set<string>());

  useEffect(() => {
    setTextDrafts((current) => {
      const next = { ...current };
      let changed = false;
      for (const field of TEXT_FIELD_NAMES) {
        if (!dirtyTextFieldsRef.current.has(field) || current[field] === content[field]) {
          if (next[field] !== content[field]) changed = true;
          next[field] = content[field];
          if (current[field] === content[field]) dirtyTextFieldsRef.current.delete(field);
        }
      }
      return changed ? next : current;
    });

    setListDrafts((current) => {
      const next: Partial<Record<BriefListField, Record<string, string>>> = { ...current };
      let changed = false;
      for (const field of LIST_FIELD_NAMES) {
        const previous = current[field] ?? {};
        const fieldNext: Record<string, string> = {};
        content[field].forEach((value, index) => {
          const key = listDraftKey(field, index);
          if (!dirtyListItemsRef.current.has(key) || previous[key] === value) {
            fieldNext[key] = value;
            if (previous[key] !== value) changed = true;
            if (previous[key] === value) dirtyListItemsRef.current.delete(key);
          } else {
            fieldNext[key] = previous[key];
          }
        });
        if (Object.keys(previous).length !== Object.keys(fieldNext).length) changed = true;
        next[field] = fieldNext;
      }
      return changed ? next : current;
    });

    setReferenceDrafts((current) => {
      const next: Record<string, ReferenceDraft> = {};
      let changed = Object.keys(current).length !== content.references.length;
      for (const reference of content.references) {
        const previous = current[reference.id] ?? createReferenceDraft(reference);
        const draft = { ...previous };
        for (const field of ["label", "url", "note"] as const) {
          const key = referenceDraftKey(reference.id, field);
          if (!dirtyReferenceFieldsRef.current.has(key) || previous[field] === reference[field]) {
            draft[field] = reference[field];
            if (previous[field] !== reference[field]) changed = true;
            if (previous[field] === reference[field]) dirtyReferenceFieldsRef.current.delete(key);
          }
        }
        next[reference.id] = draft;
      }
      return changed ? next : current;
    });

    setDecisionDrafts((current) => {
      const next: Record<string, DecisionDraft> = {};
      let changed = Object.keys(current).length !== content.confirmedDecisions.length;
      for (const decision of content.confirmedDecisions) {
        const previous = current[decision.id] ?? createDecisionDraft(decision);
        const draft = { ...previous };
        for (const field of ["statement", "rationale"] as const) {
          const key = decisionDraftKey(decision.id, field);
          if (!dirtyDecisionFieldsRef.current.has(key) || previous[field] === decision[field]) {
            draft[field] = decision[field];
            if (previous[field] !== decision[field]) changed = true;
            if (previous[field] === decision[field]) dirtyDecisionFieldsRef.current.delete(key);
          }
        }
        next[decision.id] = draft;
      }
      return changed ? next : current;
    });
  }, [briefFrame.revision, content]);

  const commitTextField = (field: BriefTextField) => {
    const value = textDrafts[field];
    if (value === content[field]) {
      dirtyTextFieldsRef.current.delete(field);
      return;
    }
    onUpdateBriefField({ field, value });
  };

  const commitListItem = (field: BriefListField, index: number) => {
    const key = listDraftKey(field, index);
    const value = listDrafts[field]?.[key] ?? content[field][index] ?? "";
    const next = content[field].map((item, itemIndex) => itemIndex === index ? value : item);
    if (value === content[field][index]) {
      dirtyListItemsRef.current.delete(key);
      return;
    }
    onUpdateBriefField({ field, value: next });
  };

  const addListItem = (field: BriefListField) => {
    const value = listAddDrafts[field]?.trim() ?? "";
    if (!value) {
      setListErrors((current) => ({ ...current, [field]: "Add a short entry before saving." }));
      return;
    }
    onUpdateBriefField({ field, value: [...content[field], value] });
    setListAddDrafts((current) => ({ ...current, [field]: "" }));
    setListErrors((current) => ({ ...current, [field]: undefined }));
  };

  const removeListItem = (field: BriefListField, index: number) => {
    dirtyListItemsRef.current.delete(listDraftKey(field, index));
    onUpdateBriefField({ field, value: content[field].filter((_, itemIndex) => itemIndex !== index) });
  };

  const commitReferenceField = (reference: BriefReference, field: keyof ReferenceDraft) => {
    const draft = referenceDrafts[reference.id] ?? createReferenceDraft(reference);
    const value = draft[field];
    if (field === "url") {
      const error = validateReferenceUrl(value);
      if (error) {
        setReferenceErrors((current) => ({ ...current, [reference.id]: error }));
        return;
      }
    }
    setReferenceErrors((current) => ({ ...current, [reference.id]: "" }));
    if (value === reference[field]) {
      dirtyReferenceFieldsRef.current.delete(referenceDraftKey(reference.id, field));
      return;
    }
    onUpdateReference({ referenceId: reference.id, patch: { [field]: value } });
  };

  const addReference = () => {
    const urlError = validateReferenceUrl(newReference.url);
    if (!newReference.label.trim() || urlError) {
      setNewReferenceError(!newReference.label.trim() ? "Add a label for this reference." : urlError);
      return;
    }
    onAddReference({ id: createStableId("reference"), ...newReference, label: newReference.label.trim() });
    setNewReference({ label: "", url: "", note: "" });
    setNewReferenceError(null);
  };

  const commitDecisionField = (decision: ConfirmedDecision, field: keyof DecisionDraft) => {
    const draft = decisionDrafts[decision.id] ?? createDecisionDraft(decision);
    const value = draft[field];
    if (value === decision[field]) {
      dirtyDecisionFieldsRef.current.delete(decisionDraftKey(decision.id, field));
      return;
    }
    onUpdateDecision({ decisionId: decision.id, patch: { [field]: value } });
  };

  const addDecision = () => {
    if (!newDecision.statement.trim()) {
      setNewDecisionError("Add the decision before saving.");
      return;
    }
    onAddDecision({ id: createStableId("decision"), ...newDecision, statement: newDecision.statement.trim() });
    setNewDecision({ statement: "", rationale: "" });
    setNewDecisionError(null);
  };

  return (
    <section
      aria-label="Project brief"
      className="canvas-frame brief-frame"
      data-brief-frame-id={briefFrame.id}
      data-canvas-control
      data-selected={isSelected ? "true" : "false"}
      data-testid="brief-frame"
      onClick={() => onSelect(briefFrame.id)}
      style={{
        width: briefFrame.width,
        height: briefFrame.height,
        transform: `translate3d(${briefFrame.x}px, ${briefFrame.y}px, 0)`,
      }}
    >
      <button
        aria-label={`Move ${briefFrame.name}`}
        className="frame-label"
        data-brief-frame-drag-handle={briefFrame.id}
        onPointerDown={(event) => onStartMove(briefFrame.id, event)}
        type="button"
      >
        <span>{briefFrame.name}</span>
        <span className="brief-frame-label-kind">Brief</span>
      </button>
      <div className="brief-frame-content">
        <header className="brief-frame-header">
          <span className="brief-frame-eyebrow">Brainstorming mode</span>
          <h2>Project brief</h2>
          <p data-testid="brief-opening-prompt">{BRAINSTORM_OPENING_PROMPT}</p>
          <span className="brief-save-hint">Changes save when you leave a field. Local drafts stay intact while Codex updates the brief.</span>
        </header>

        <div className="brief-frame-fields">
          {TEXT_FIELDS.map(({ field, label, placeholder }) => (
            <label className="brief-field" key={field}>
              <span className="brief-field-label">{label}</span>
              <textarea
                aria-label={label}
                data-testid={`brief-field-${field}`}
                onBlur={() => commitTextField(field)}
                onChange={(event) => {
                  dirtyTextFieldsRef.current.add(field);
                  setTextDrafts((current) => ({ ...current, [field]: event.target.value }));
                }}
                placeholder={placeholder}
                rows={field === "visualDirection" ? 2 : 3}
                value={textDrafts[field]}
              />
            </label>
          ))}

          {LIST_FIELDS.map(({ field, label, placeholder }) => (
            <section className="brief-field brief-list-field" key={field} aria-labelledby={`brief-list-label-${field}`}>
              <span className="brief-field-label" id={`brief-list-label-${field}`}>{label}</span>
              <div className="brief-list-items">
                {content[field].map((value, index) => {
                  const key = listDraftKey(field, index);
                  return (
                    <div className="brief-list-row" key={key}>
                      <input
                        aria-label={`${label} ${index + 1}`}
                        onBlur={() => commitListItem(field, index)}
                        onChange={(event) => {
                          dirtyListItemsRef.current.add(key);
                          setListDrafts((current) => ({
                            ...current,
                            [field]: { ...(current[field] ?? {}), [key]: event.target.value },
                          }));
                        }}
                        value={listDrafts[field]?.[key] ?? value}
                      />
                      <button
                        aria-label={`Remove ${label} ${index + 1}`}
                        className="brief-icon-button"
                        onClick={() => removeListItem(field, index)}
                        type="button"
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="brief-add-row">
                <input
                  aria-label={`${label} new entry`}
                  onChange={(event) => setListAddDrafts((current) => ({ ...current, [field]: event.target.value }))}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addListItem(field); } }}
                  placeholder={placeholder}
                  value={listAddDrafts[field] ?? ""}
                />
                <button aria-label={`Add ${label}`} className="brief-add-button" onClick={() => addListItem(field)} type="button">
                  <Plus size={13} aria-hidden="true" /> Add
                </button>
              </div>
              {listErrors[field] ? <span className="brief-field-error" role="alert">{listErrors[field]}</span> : null}
            </section>
          ))}

          <section className="brief-field brief-list-field" aria-labelledby="brief-references-label">
            <span className="brief-field-label" id="brief-references-label">References & links</span>
            <div className="brief-reference-list">
              {content.references.map((reference) => {
                const draft = referenceDrafts[reference.id] ?? createReferenceDraft(reference);
                const error = referenceErrors[reference.id];
                return (
                  <div className="brief-reference-card" key={reference.id}>
                    <div className="brief-reference-card-header">
                      <span>{draft.label || "Untitled reference"}</span>
                      <button aria-label={`Remove reference ${draft.label || reference.id}`} className="brief-icon-button" onClick={() => onRemoveReference(reference.id)} type="button"><Trash2 size={13} aria-hidden="true" /></button>
                    </div>
                    <input aria-label={`Reference ${draft.label || reference.id} label`} onChange={(event) => { dirtyReferenceFieldsRef.current.add(referenceDraftKey(reference.id, "label")); setReferenceDrafts((current) => ({ ...current, [reference.id]: { ...draft, label: event.target.value } })); }} onBlur={() => commitReferenceField(reference, "label")} value={draft.label} />
                    <input aria-label={`Reference ${draft.label || reference.id} URL`} onChange={(event) => { dirtyReferenceFieldsRef.current.add(referenceDraftKey(reference.id, "url")); setReferenceDrafts((current) => ({ ...current, [reference.id]: { ...draft, url: event.target.value } })); }} onBlur={() => commitReferenceField(reference, "url")} value={draft.url} />
                    <input aria-label={`Reference ${draft.label || reference.id} note`} onChange={(event) => { dirtyReferenceFieldsRef.current.add(referenceDraftKey(reference.id, "note")); setReferenceDrafts((current) => ({ ...current, [reference.id]: { ...draft, note: event.target.value } })); }} onBlur={() => commitReferenceField(reference, "note")} placeholder="Why it matters" value={draft.note} />
                    {safeReferenceUrl(draft.url) ? <a href={safeReferenceUrl(draft.url)!} rel="noopener noreferrer" target="_blank"><ExternalLink size={12} aria-hidden="true" /> Open link</a> : null}
                    {error ? <span className="brief-field-error" role="alert">{error}</span> : null}
                  </div>
                );
              })}
            </div>
            <div className="brief-reference-new">
              <input aria-label="New reference label" onChange={(event) => setNewReference((current) => ({ ...current, label: event.target.value }))} placeholder="Reference name" value={newReference.label} />
              <input aria-label="New reference URL" onChange={(event) => setNewReference((current) => ({ ...current, url: event.target.value }))} placeholder="https://example.com" value={newReference.url} />
              <input aria-label="New reference note" onChange={(event) => setNewReference((current) => ({ ...current, note: event.target.value }))} placeholder="Why it matters" value={newReference.note} />
              <button aria-label="Add reference" className="brief-add-button" onClick={addReference} type="button"><Plus size={13} aria-hidden="true" /> Add reference</button>
            </div>
            {newReferenceError ? <span className="brief-field-error" role="alert">{newReferenceError}</span> : null}
          </section>

          <section className="brief-field brief-list-field" aria-labelledby="brief-decisions-label">
            <span className="brief-field-label" id="brief-decisions-label">Confirmed decisions</span>
            <div className="brief-decision-list">
              {content.confirmedDecisions.map((decision) => {
                const draft = decisionDrafts[decision.id] ?? createDecisionDraft(decision);
                return (
                  <div className="brief-decision-card" key={decision.id}>
                    <div className="brief-decision-card-header">
                      <span>Decision</span>
                      <button aria-label={`Remove decision ${draft.statement || decision.id}`} className="brief-icon-button" onClick={() => onRemoveDecision(decision.id)} type="button"><Trash2 size={13} aria-hidden="true" /></button>
                    </div>
                    <input aria-label={`Decision ${decision.id} statement`} onChange={(event) => { dirtyDecisionFieldsRef.current.add(decisionDraftKey(decision.id, "statement")); setDecisionDrafts((current) => ({ ...current, [decision.id]: { ...draft, statement: event.target.value } })); }} onBlur={() => commitDecisionField(decision, "statement")} value={draft.statement} />
                    <textarea aria-label={`Decision ${decision.id} rationale`} onChange={(event) => { dirtyDecisionFieldsRef.current.add(decisionDraftKey(decision.id, "rationale")); setDecisionDrafts((current) => ({ ...current, [decision.id]: { ...draft, rationale: event.target.value } })); }} onBlur={() => commitDecisionField(decision, "rationale")} placeholder="Why this is confirmed" rows={2} value={draft.rationale} />
                  </div>
                );
              })}
            </div>
            <div className="brief-decision-new">
              <input aria-label="New decision statement" onChange={(event) => setNewDecision((current) => ({ ...current, statement: event.target.value }))} placeholder="What did we decide?" value={newDecision.statement} />
              <textarea aria-label="New decision rationale" onChange={(event) => setNewDecision((current) => ({ ...current, rationale: event.target.value }))} placeholder="Why?" rows={2} value={newDecision.rationale} />
              <button aria-label="Add confirmed decision" className="brief-add-button" onClick={addDecision} type="button"><Plus size={13} aria-hidden="true" /> Add decision</button>
            </div>
            {newDecisionError ? <span className="brief-field-error" role="alert">{newDecisionError}</span> : null}
          </section>
        </div>
      </div>
    </section>
  );
}
