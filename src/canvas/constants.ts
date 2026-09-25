export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 4;
export const OVERSCAN_SCREEN_PX = 560;
/**
 * Upper bound on simultaneously mounted frame iframes. Each live iframe
 * carries a parsed document + bridge runtime (~2-3 MB), so unbounded
 * keep-alive would exhaust the tab on very large canvases. Interaction-mounted
 * frames are pinned and never evicted; visibility-scan mounts beyond this cap
 * evict farthest-from-view first.
 */
export const MAX_MOUNTED_FRAMES = 64;
/**
 * Bound on frames that may be loading/initializing at once. Iframe srcDoc
 * parse + bridge runtime + font decode costs ~0.3-0.5s of main-thread time
 * each, so mounts are serialized: a new frame is only granted a slot when a
 * prior mount signals readiness (first bridge snapshot) or times out.
 */
export const MAX_INFLIGHT_MOUNTS = 3;
/** Failsafe for mounts that never report readiness (error, navigation loss). */
export const MOUNT_READY_TIMEOUT_MS = 6000;
