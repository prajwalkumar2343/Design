import type { TraceLog } from "../../trace";
import {
  boundResult,
  type HarnessTool,
  type HarnessToolContext,
} from "../tools";
import type { HarnessSkill } from "./live-wireframes";

export const CONCEPT_BRAINSTORM_SKILL_NAME = "concept-brainstorm" as const;
export const CONCEPT_BRAINSTORM_SKILL_VERSION = 1 as const;

export const CONCEPT_BRAINSTORM_SKILL_PROMPT = `Concept brainstorming is active. You lead with ideas first and use wireframes as the way to show them: never jump straight to a wireframe without naming the concept it expresses.

Working style:
1. When the user wants ideas, directions, or "what could this be", call concept.propose_concepts once with 2-4 genuinely distinct concepts (different audience emphasis, different core loop, different shape — never near-duplicates). Each concept names what it is, who it serves best, the key moments it must nail, what makes it different, and its main tradeoff.
2. Present the concepts briefly, compare them against the brief, state which one you would pick and why, and ask which to keep or combine.
3. Call concept.list_concepts whenever you are unsure which concepts are on the table.
4. When the user picks one, call concept.select_concept to lock it in as a confirmed decision, then show it: call brainstorm.draft_wireframe for a single quick visual, or live.explore_variants to compare contrasting visual directions of the same concept side by side.
5. After every visual change, say in one short line what changed and invite the next reaction. Keep the loop fast: concepts -> react -> select -> show -> refine.
6. Use brainstorm.edit_wireframe only for a structural rethink of a shown frame, live.pinpoint_edit when the user points at one element, and main.generate_wireframe only for the final approved handoff.

If the user's pick matches no proposed concept, ask one clarifying question or propose fresh concepts first; never invent a selection silently.`;

export interface BrainstormConcept {
  name: string;
  summary: string;
  audienceFit: string;
  keyMoments: string[];
  differentiator: string;
  tradeoff: string;
}

const MIN_CONCEPTS = 2;
const MAX_CONCEPTS = 4;
const MAX_NAME_CHARS = 60;
const MAX_SUMMARY_CHARS = 600;
const MAX_SHORT_FIELD_CHARS = 300;
const MAX_MOMENTS = 5;
const MAX_MOMENT_CHARS = 160;
const MAX_RATIONALE_CHARS = 500;

function requireNonEmptyString(value: unknown, label: string, maxChars: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Concept field "${label}" must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new Error(`Concept field "${label}" must be at most ${maxChars} characters`);
  }
  return trimmed;
}

function parseConcept(raw: unknown, index: number): BrainstormConcept {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Concept at index ${index} must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const keyMoments = record["keyMoments"];
  if (!Array.isArray(keyMoments) || keyMoments.length === 0 || keyMoments.length > MAX_MOMENTS) {
    throw new Error(`Concept at index ${index} must list 1-${MAX_MOMENTS} key moments`);
  }
  return {
    name: requireNonEmptyString(record["name"], "name", MAX_NAME_CHARS),
    summary: requireNonEmptyString(record["summary"], "summary", MAX_SUMMARY_CHARS),
    audienceFit: requireNonEmptyString(record["audienceFit"], "audienceFit", MAX_SHORT_FIELD_CHARS),
    keyMoments: keyMoments.map((moment, momentIndex) => {
      if (typeof moment !== "string" || moment.trim().length === 0) {
        throw new Error(`Concept at index ${index} has an empty key moment at position ${momentIndex}`);
      }
      const trimmed = moment.trim();
      if (trimmed.length > MAX_MOMENT_CHARS) {
        throw new Error(`Concept at index ${index} key moment ${momentIndex} must be at most ${MAX_MOMENT_CHARS} characters`);
      }
      return trimmed;
    }),
    differentiator: requireNonEmptyString(record["differentiator"], "differentiator", MAX_SHORT_FIELD_CHARS),
    tradeoff: requireNonEmptyString(record["tradeoff"], "tradeoff", MAX_SHORT_FIELD_CHARS),
  };
}

function parseConceptList(args: Record<string, unknown>): BrainstormConcept[] {
  const raw = args["concepts"];
  if (!Array.isArray(raw)) {
    throw new Error('Tool argument "concepts" must be an array of concept objects');
  }
  if (raw.length < MIN_CONCEPTS || raw.length > MAX_CONCEPTS) {
    throw new Error(`Provide between ${MIN_CONCEPTS} and ${MAX_CONCEPTS} distinct concepts`);
  }
  const concepts = raw.map((item, index) => parseConcept(item, index));
  const names = concepts.map((concept) => concept.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    throw new Error("Concepts must have distinct names; near-duplicates are not useful to compare");
  }
  const summaries = concepts.map((concept) => concept.summary.toLowerCase());
  if (new Set(summaries).size !== summaries.length) {
    throw new Error("Concepts must differ in substance, not just in name");
  }
  return concepts;
}

function isBrainstormConcept(value: unknown): value is BrainstormConcept {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["name"] === "string" &&
    typeof record["summary"] === "string" &&
    typeof record["audienceFit"] === "string" &&
    Array.isArray(record["keyMoments"]) &&
    typeof record["differentiator"] === "string" &&
    typeof record["tradeoff"] === "string"
  );
}

/** All proposed concepts in first-seen order, deduplicated by name. */
function readProposedConcepts(trace: TraceLog): BrainstormConcept[] {
  const seen = new Set<string>();
  const concepts: BrainstormConcept[] = [];
  for (const event of trace.all()) {
    if (event.type !== "concept/proposed") continue;
    const stored = (event.data as { concepts?: unknown }).concepts;
    if (!Array.isArray(stored)) continue;
    for (const item of stored) {
      if (!isBrainstormConcept(item)) continue;
      const key = item.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      concepts.push(item);
    }
  }
  return concepts;
}

function readSelectedNames(trace: TraceLog): Set<string> {
  const selected = new Set<string>();
  for (const event of trace.all()) {
    if (event.type !== "concept/selected") continue;
    const name = (event.data as { name?: unknown }).name;
    if (typeof name === "string" && name.trim().length > 0) {
      selected.add(name.toLowerCase());
    }
  }
  return selected;
}

function renderConcept(concept: BrainstormConcept, selected: boolean): string {
  const marker = selected ? " (selected)" : "";
  return [
    `- ${concept.name}${marker}`,
    `  What it is: ${concept.summary}`,
    `  Serves best: ${concept.audienceFit}`,
    `  Key moments: ${concept.keyMoments.join("; ")}`,
    `  Different because: ${concept.differentiator}`,
    `  Tradeoff: ${concept.tradeoff}`,
  ].join("\n");
}

function proposeConceptsTool(): HarnessTool {
  return {
    name: "concept.propose_concepts",
    description: "Propose 2-4 genuinely distinct product/design concepts for the current brief. Use when brainstorming what the project could be, before showing anything as wireframes.",
    parameters: {
      type: "object",
      properties: {
        concepts: {
          type: "array",
          description: "2-4 distinct concepts to compare",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Short distinct name, e.g. Guided checklist" },
              summary: { type: "string", description: "What the concept is in plain language" },
              audienceFit: { type: "string", description: "Who it serves best and why" },
              keyMoments: { type: "array", items: { type: "string" }, description: "1-5 key moments the concept must nail" },
              differentiator: { type: "string", description: "What makes it different from the other concepts" },
              tradeoff: { type: "string", description: "The main tradeoff or risk of this concept" },
            },
            required: ["name", "summary", "audienceFit", "keyMoments", "differentiator", "tradeoff"],
          },
        },
      },
      required: ["concepts"],
    },
    permission: "allow",
    async execute(args, context) {
      const concepts = parseConceptList(args);
      context.trace.push({
        traceId: context.traceId,
        type: "concept/proposed",
        at: Date.now(),
        data: { concepts, count: concepts.length },
      });
      const summary = [
        `Proposed ${concepts.length} concepts to compare:`,
        ...concepts.map((concept) => renderConcept(concept, false)),
        "Compare them briefly against the brief, say which you would pick and why, and ask the user which to keep or combine.",
      ].join("\n");
      return boundResult(summary, context.maxToolResultChars);
    },
  };
}

function listConceptsTool(): HarnessTool {
  return {
    name: "concept.list_concepts",
    description: "List the brainstorm concepts proposed so far and which one was selected. Use before referencing concepts so you always cite real names.",
    parameters: { type: "object", properties: {} },
    permission: "allow",
    async execute(_args, context) {
      const concepts = readProposedConcepts(context.trace);
      if (concepts.length === 0) {
        return "No concepts on the table yet. Call concept.propose_concepts with 2-4 distinct directions first.";
      }
      const selected = readSelectedNames(context.trace);
      const lines = concepts.map((concept) => renderConcept(concept, selected.has(concept.name.toLowerCase())));
      return boundResult(lines.join("\n"), context.maxToolResultChars);
    },
  };
}

function selectConceptTool(): HarnessTool {
  return {
    name: "concept.select_concept",
    description: "Lock in the user's chosen concept as a confirmed decision and say what to show first as wireframes. Call only after the user picks a proposed concept.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact name of a proposed concept" },
        rationale: { type: "string", description: "Why this concept won" },
        whatToShow: { type: "string", description: "Which screens or moments to show first as wireframes" },
      },
      required: ["name", "rationale", "whatToShow"],
    },
    permission: "allow",
    async execute(args, context) {
      const rawName = args["name"];
      if (typeof rawName !== "string" || rawName.trim().length === 0) {
        throw new Error('Tool argument "name" must be a non-empty string');
      }
      const name = rawName.trim();
      const rationale = requireNonEmptyString(args["rationale"], "rationale", MAX_RATIONALE_CHARS);
      const whatToShow = requireNonEmptyString(args["whatToShow"], "whatToShow", MAX_RATIONALE_CHARS);
      const match = readProposedConcepts(context.trace).find(
        (concept) => concept.name.toLowerCase() === name.toLowerCase(),
      );
      if (!match) {
        throw new Error(
          `Unknown concept "${name}". Call concept.list_concepts to see the proposed names, or propose fresh concepts first.`,
        );
      }
      const revision = context.session.getSnapshot().revision;
      const result = context.session.addDecision({
        expectedRevision: revision,
        decision: {
          id: context.createId("decision"),
          statement: `Selected brainstorm concept: ${match.name}`,
          rationale: `${rationale} (Show first: ${whatToShow})`,
        },
      });
      context.trace.push({
        traceId: context.traceId,
        type: "concept/selected",
        at: Date.now(),
        data: { name: match.name, rationale, whatToShow, revision: result.revision },
      });
      const summary = [
        `Selected concept "${match.name}" and recorded it as a confirmed decision (revision ${result.revision}).`,
        `Show next: ${whatToShow}.`,
        "Put it on the canvas now with brainstorm.draft_wireframe, or compare its visual directions with live.explore_variants.",
      ].join("\n");
      return boundResult(summary, context.maxToolResultChars);
    },
  };
}

export function createConceptBrainstormSkill(): HarnessSkill {
  return {
    name: CONCEPT_BRAINSTORM_SKILL_NAME,
    description: "Concept-first brainstorming: propose distinct product directions, compare them with the user, lock in the pick, then show it as wireframes.",
    prompt: CONCEPT_BRAINSTORM_SKILL_PROMPT,
    tools: [
      proposeConceptsTool(),
      listConceptsTool(),
      selectConceptTool(),
    ],
  };
}
