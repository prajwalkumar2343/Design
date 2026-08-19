export {
  classifyGestureActivity,
  classifyPointerActivity,
  isFixingEditCommand,
  FIXING_EDIT_COMMANDS,
  type PointerBehavior,
} from "./activity";
export {
  MAX_ACTIVE_STROKES,
  MAX_DISTINCT_ELEMENTS,
  MAX_FIX_EVENTS,
  MAX_STROKE_SAMPLES,
  MAX_TRAIL_SAMPLES,
  MAX_TRAIL_WINDOW_MS,
  MIN_SAMPLE_DISTANCE,
  PointerInteractionRecorder,
  PointerInteractionRecorderError,
  type MarkFixInput,
  type PointerInteractionRecorderOptions,
  type PointerSampleInput,
} from "./recorder";
export {
  INTERACTION_SNAPSHOT_SCHEMA_VERSION,
  type FixEvent,
  type InteractionPoint,
  type InteractionSample,
  type InteractionStroke,
  type PointerActivityKind,
  type PointerInteractionSnapshot,
} from "./types";
export {
  toVoiceInteractionContext,
  toVoicePointerContext,
  type VoiceContextBase,
} from "./voice-context";
