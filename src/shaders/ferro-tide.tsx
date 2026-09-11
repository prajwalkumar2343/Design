import { useEffect, useRef, useState } from "react";
import { Mesh, Program, RenderTarget, Renderer, Triangle, Vec2, Vec3, Vec4 } from "ogl";

type RGB = readonly [number, number, number];

interface FerroTideMood {
  readonly name: string;
  readonly stops: readonly [RGB, RGB, RGB, RGB];
  readonly tint: RGB;
}

/** Five currents for the gallery component. Abyss matches the standalone study. */
export const FERRO_TIDE_MOODS: readonly FerroTideMood[] = [
  { name: "Abyss", stops: [[0.015, 0.05, 0.1], [0.04, 0.25, 0.38], [0.1, 0.65, 0.72], [0.78, 0.95, 0.97]], tint: [0.42, 0.9, 1.0] },
  { name: "Magma", stops: [[0.1, 0.03, 0.03], [0.45, 0.1, 0.08], [0.95, 0.38, 0.12], [1.0, 0.8, 0.42]], tint: [1.0, 0.5, 0.25] },
  { name: "Ultraviolet", stops: [[0.07, 0.03, 0.13], [0.32, 0.12, 0.52], [0.72, 0.35, 0.88], [1.0, 0.82, 0.95]], tint: [0.8, 0.6, 1.0] },
  { name: "Kelp", stops: [[0.02, 0.09, 0.06], [0.05, 0.45, 0.35], [0.35, 0.85, 0.55], [0.9, 1.0, 0.75]], tint: [0.55, 1.0, 0.6] },
  { name: "Porcelain", stops: [[0.03, 0.04, 0.05], [0.2, 0.22, 0.26], [0.55, 0.6, 0.65], [0.93, 0.95, 0.97]], tint: [0.9, 0.92, 1.0] },
];

export type FerroTideMoodName = (typeof FERRO_TIDE_MOODS)[number]["name"];

export interface FerroTideProps {
  width?: string;
  height?: string;
  /** Current name; unknown values fall back to Abyss. */
  mood?: string;
  /** When false the field still drifts but ignores pointer charge. */
  interactive?: boolean;
}

const VERTEX = /* glsl */ `
  attribute vec2 uv;
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

// Low-res charge buffer: paints a decaying trail along the pointer segment
// every frame so the contour field remembers recent motion.
const WAKE_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D u_prev;
  uniform vec2 u_pos;
  uniform vec2 u_prevPos;
  uniform float u_strength;
  uniform float u_radius;
  uniform vec2 u_scale;
  uniform float u_decayW;
  uniform float u_decayH;

  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 prev = texture2D(u_prev, vUv).rg;
    float w = max(prev.r * u_decayW - 0.0016, 0.0);
    float h = max(prev.g * u_decayH - 0.0006, 0.0);

    vec2 px = (vUv - 0.5) * u_scale;
    vec2 pa = (u_prevPos - 0.5) * u_scale;
    vec2 pb = (u_pos - 0.5) * u_scale;
    float d = segDist(px, pa, pb);
    float rr = max(u_radius, 1e-4);
    float qd = d / rr;
    float splat = exp(-qd * qd) * u_strength;

    w = max(w, splat);
    h = max(h, splat * 0.85);
    gl_FragColor = vec4(w, h, 0.0, 1.0);
  }
`;

// Magnetic contours: a domain-warped field drawn as glowing topo lines.
// The cursor combs the domain (direction + perpendicular swirl), its
// velocity smears samples for motion streaks, and clicks pluck the lines
// as expanding surge rings.
const MAIN_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D u_wake;
  uniform float u_time;
  uniform float u_grain;
  uniform float u_aspect;
  uniform vec3 u_s0;
  uniform vec3 u_s1;
  uniform vec3 u_s2;
  uniform vec3 u_s3;
  uniform vec3 u_tint;
  uniform vec2 u_pointer;
  uniform vec2 u_vel;
  uniform float u_speed;
  uniform float u_press;
  uniform vec4 u_ripples[8];

  vec3 grad(float x) {
    float t = clamp(x, 0.0, 1.0) * 3.0;
    vec3 c = mix(u_s0, u_s1, clamp(t, 0.0, 1.0));
    c = mix(c, u_s2, clamp(t - 1.0, 0.0, 1.0));
    c = mix(c, u_s3, clamp(t - 2.0, 0.0, 1.0));
    return c;
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.55;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) {
      v += amp * vnoise(p);
      p = m * p;
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    float t = u_time;
    vec2 sc = vec2(u_aspect, 1.0);
    vec2 p0 = (vUv - 0.5) * sc * 1.9;

    vec2 wk = texture2D(u_wake, vUv).rg;
    float wake = wk.r;
    float heat = wk.g;

    vec2 disp = vec2(0.0);
    float pluck = 0.0;
    float rim = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 rp = u_ripples[i];
      float age = t - rp.z;
      float alive = step(0.0001, rp.w) * step(0.0, age) * step(age, 4.0);
      float radius = age * 0.75;
      vec2 c = (rp.xy - 0.5) * sc * 1.9;
      vec2 dv = p0 - c;
      float d = length(dv) + 1e-4;
      float qd = (d - radius) * 7.0;
      float band = exp(-qd * qd);
      float att = exp(-age * 1.5) * rp.w * alive;
      disp += (dv / d) * band * att * 0.16;
      pluck += band * att;
      rim += band * att * exp(-d * 0.8);
    }

    vec2 toPtr = u_pointer - p0;
    float ptrD = length(toPtr) + 1e-4;
    vec2 dirP = toPtr / ptrD;
    vec2 perp = vec2(-dirP.y, dirP.x);
    float nearField = exp(-ptrD * 1.6);
    float infl = clamp(wake * 1.4 * exp(-ptrD * 0.9) + u_press * nearField * 0.9, 0.0, 2.0);

    vec2 vdir = u_vel / max(length(u_vel), 1e-4);
    float vmag = min(length(u_vel), 2.5);
    vec2 smear = -vdir * (vmag * infl * 0.10);

    vec2 p = p0 + disp + dirP * infl * 0.28 + perp * infl * (0.22 + u_speed * 0.25) + smear;

    vec2 drift = vec2(0.05 * t, -0.04 * t);
    vec2 q = vec2(fbm(p * 1.15 + drift),
                  fbm(p * 1.15 + vec2(5.2, 1.3) - drift * 0.8));
    vec2 r = vec2(fbm(p * 1.3 + 2.2 * q + vec2(1.7, 9.2) + 0.10 * t),
                  fbm(p * 1.3 + 2.2 * q + vec2(8.3, 2.8) - 0.08 * t));
    float f = fbm(p * 1.1 + 2.4 * r + q * 0.8);
    f += infl * 0.28 + pluck * 0.35;
    f = clamp(f, 0.0, 1.4);

    float g1 = fract(f * 15.0 + pluck * 0.9 + q.x * 0.6);
    float line1 = 1.0 - abs(2.0 * g1 - 1.0);
    line1 = pow(smoothstep(0.45, 0.995, line1), 1.6);

    float g2 = fract(f * 44.0 - r.y * 1.2 + pluck * 1.4);
    float line2 = 1.0 - abs(2.0 * g2 - 1.0);
    line2 = pow(smoothstep(0.72, 0.995, line2), 2.0);

    float sa = 0.6 * sin(t * 0.05 + q.y * 4.0) + p.y * 0.2;
    mat2 srot = mat2(cos(sa), -sin(sa), sin(sa), cos(sa));
    vec2 sp2 = srot * p;
    sp2.y *= 3.0;
    float fil = fbm(sp2 * 2.1 + r + vec2(0.0, 0.10 * t));
    fil = 1.0 - abs(2.0 * fil - 1.0);
    fil = pow(smoothstep(0.60, 0.995, fil), 2.2);

    float hueRaw = clamp((q.x - 0.22) * 2.0 + f * 0.25 + u_speed * 0.06, 0.0, 1.0);
    float hue = hueRaw * hueRaw * (3.0 - 2.0 * hueRaw);
    vec3 base = grad(hue);
    vec3 base2 = grad(clamp(hue + 0.18, 0.0, 1.0));

    vec3 col = mix(vec3(0.012, 0.014, 0.020), base * 0.16, smoothstep(0.1, 0.9, f));
    col += u_tint * heat * heat * 0.9;
    col += u_tint * wake * 0.10;

    float glowBoost = 0.55 + infl * 1.5 + pluck * 1.2 + u_speed * 0.25;
    vec3 lineCol = mix(base2, vec3(1.0), clamp(infl * infl * 0.55 + pluck * 0.35, 0.0, 0.85));
    col += lineCol * line1 * (0.35 + 0.65 * smoothstep(0.15, 0.9, f)) * glowBoost * 0.75;
    col += mix(base2, u_tint, 0.4) * line2 * 0.28 * (0.5 + infl);
    col += mix(base2, u_tint, 0.35) * fil * (0.10 + 0.35 * smoothstep(0.3, 0.95, f)) * (0.6 + infl * 0.9);

    float halo = exp(-ptrD * 2.4);
    col += mix(u_tint, vec3(1.0), 0.45) * halo * (0.35 + wake * 1.4 + u_press * 0.6 + pluck * 0.4);

    col += u_tint * rim * 0.7;
    col += vec3(1.0) * rim * rim * 0.35;

    vec2 cellP = p * 34.0;
    vec2 cellId = floor(cellP);
    float rnd = hash21(cellId);
    vec2 star = fract(cellP) - 0.5;
    float tw = 0.5 + 0.5 * sin(t * (2.0 + rnd * 4.0) + rnd * 40.0);
    float spark = smoothstep(0.18, 0.02, length(star)) * step(0.93, rnd) * tw;
    col += mix(vec3(1.0), u_tint, 0.3) * spark * (0.15 + infl * 1.6 + pluck * 0.8);

    col += u_tint * u_press * 0.08 * exp(-ptrD * 3.0);

    float vig = smoothstep(1.55, 0.30, length(p0));
    col *= mix(0.22, 1.0, vig);

    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = clamp(mix(vec3(luma), col, 1.4), 0.0, 4.0);
    col = col / (1.0 + 0.45 * col);
    float gr = hash21(gl_FragCoord.xy + vec2(u_grain)) - 0.5;
    col += gr * 0.028;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function resolveMood(name: string | undefined): FerroTideMood {
  return FERRO_TIDE_MOODS.find((mood) => mood.name === name) ?? FERRO_TIDE_MOODS[0];
}

/**
 * Real elapsed time between frames in seconds, clamped to sane bounds.
 * A zero or negative delta (spec allows non-monotonic timestamps) falls
 * back to a nominal 60fps step so the simulation never runs backwards.
 */
export function frameDeltaSeconds(now: number, lastNow: number): number {
  const dt = (now - lastNow) / 1000;
  return dt > 0 ? Math.min(dt, 0.05) : 0.016;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  } catch {
    return false;
  }
}

/**
 * Ferro Tide as an embeddable canvas element: same OGL field as the
 * standalone study, sized to its parent. Pointer motion combs the contours,
 * velocity smears them, press charges the halo, and clicks fire surges.
 * An idle ghost cursor keeps menu previews alive.
 */
export function FerroTide({ width = "100%", height = "100%", mood = "Abyss", interactive = true }: FerroTideProps) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        antialias: false,
        alpha: false,
      });
    } catch {
      setFailed(true);
      return;
    }

    const gl = renderer.gl;
    if (!gl) {
      setFailed(true);
      return;
    }
    const canvas = gl.canvas;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    holder.appendChild(canvas);

    const reduceMotion = prefersReducedMotion();

    const geometry = new Triangle(gl);
    const wakeProgram = new Program(gl, {
      vertex: VERTEX,
      fragment: WAKE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        u_prev: { value: null },
        u_pos: { value: new Vec2(0.5, 0.5) },
        u_prevPos: { value: new Vec2(0.5, 0.5) },
        u_strength: { value: 0 },
        u_radius: { value: 0.03 },
        u_scale: { value: new Vec2(1, 1) },
        u_decayW: { value: 0.94 },
        u_decayH: { value: 0.98 },
      },
    });
    const firstMood = resolveMood(moodRef.current);
    const mainProgram = new Program(gl, {
      vertex: VERTEX,
      fragment: MAIN_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        u_wake: { value: null },
        u_time: { value: 0 },
        u_grain: { value: 0 },
        u_aspect: { value: 1 },
        u_s0: { value: new Vec3(...firstMood.stops[0]) },
        u_s1: { value: new Vec3(...firstMood.stops[1]) },
        u_s2: { value: new Vec3(...firstMood.stops[2]) },
        u_s3: { value: new Vec3(...firstMood.stops[3]) },
        u_tint: { value: new Vec3(...firstMood.tint) },
        u_pointer: { value: new Vec2(0, 0) },
        u_vel: { value: new Vec2(0, 0) },
        u_speed: { value: 0 },
        u_press: { value: 0 },
        u_ripples: { value: Array.from({ length: 8 }, () => new Vec4(0.5, 0.5, -100, 0)) },
      },
    });
    const meshWake = new Mesh(gl, { geometry, program: wakeProgram });
    const meshMain = new Mesh(gl, { geometry, program: mainProgram });

    const wakeU = wakeProgram.uniforms;
    const mainU = mainProgram.uniforms;
    const setVec2 = (name: string, x: number, y: number) =>
      (mainU[name].value as Vec2).set(x, y);
    const setVec3 = (name: string, v: RGB) =>
      (mainU[name].value as Vec3).set(v[0], v[1], v[2]);

    let trailRead = new RenderTarget(gl, { width: 512, height: 512, depth: false, minFilter: gl.LINEAR, magFilter: gl.LINEAR });
    let trailWrite = new RenderTarget(gl, { width: 512, height: 512, depth: false, minFilter: gl.LINEAR, magFilter: gl.LINEAR });

    const drive = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, vx: 0, vy: 0, speed: 0, press: 0 };
    const raw = { x: 0.5, y: 0.5, active: false };
    let held = false;
    let lastInput = performance.now();
    let ghostEngage = 0;
    let rippleCursor = 0;
    let time = Math.random() * 100;
    let grainSeed = Math.random() * 100;
    let aspect = 1;
    let moodFrom: FerroTideMood | null = null;
    let moodTo: FerroTideMood = firstMood;
    let moodT0 = 0;

    const resize = () => {
      const w = Math.max(holder.clientWidth, 1);
      const h = Math.max(holder.clientHeight, 1);
      const area = w * h * (window.devicePixelRatio || 1) ** 2;
      renderer.dpr = Math.min(window.devicePixelRatio || 1, area > 3.2e6 ? 1.5 : 2);
      renderer.setSize(w, h);
      aspect = w / h;
      mainU.u_aspect.value = aspect;
      wakeU.u_scale.value.set(aspect, 1);
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(holder);

    const toLocal = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5,
        y: rect.height > 0 ? 1 - (clientY - rect.top) / rect.height : 0.5,
      };
    };
    const markInput = () => {
      lastInput = performance.now();
      ghostEngage = 0;
    };
    const spawnRipple = () => {
      const ripples = mainU.u_ripples.value as Vec4[];
      ripples[rippleCursor % ripples.length].set(raw.x, raw.y, time, 1);
      rippleCursor += 1;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!interactiveRef.current) return;
      const local = toLocal(event.clientX, event.clientY);
      raw.x = local.x;
      raw.y = local.y;
      raw.active = true;
      markInput();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!interactiveRef.current) return;
      held = true;
      onPointerMove(event);
      spawnRipple();
    };
    const onPointerUp = () => {
      held = false;
    };
    canvas.addEventListener("pointermove", onPointerMove, { passive: true });
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("blur", onPointerUp);

    const ghostPath = (t: number) => ({
      x: 0.5 + 0.3 * Math.sin(t * 0.27 + 0.6) * Math.cos(t * 0.11 + 2.1),
      y: 0.5 + 0.26 * Math.sin(t * 0.21 + 2.4) * Math.sin(t * 0.15 + 0.9),
    });

    const currentCoeffs = () => {
      if (!moodFrom) return { stops: moodTo.stops, tint: moodTo.tint };
      const e = Math.min((performance.now() - moodT0) / 900, 1);
      if (e >= 1) {
        const done = moodTo;
        moodFrom = null;
        return { stops: done.stops, tint: done.tint };
      }
      const k = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;
      const mix3 = (a: RGB, b: RGB): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      return {
        stops: [mix3(moodFrom.stops[0], moodTo.stops[0]), mix3(moodFrom.stops[1], moodTo.stops[1]), mix3(moodFrom.stops[2], moodTo.stops[2]), mix3(moodFrom.stops[3], moodTo.stops[3])] as const,
        tint: mix3(moodFrom.tint, moodTo.tint),
      };
    };

    let raf = 0;
    let lastNow = performance.now();
    let alive = true;

    const frame = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = frameDeltaSeconds(now, lastNow);
      lastNow = now;

      const wanted = resolveMood(moodRef.current);
      if (wanted.name !== moodTo.name) {
        const live = currentCoeffs();
        moodFrom = { name: "blend", stops: [...live.stops] as unknown as FerroTideMood["stops"], tint: live.tint };
        moodTo = wanted;
        moodT0 = performance.now();
      }

      time += dt * (reduceMotion ? 0.22 : 1);
      if (!reduceMotion) grainSeed = (grainSeed + dt * 61) % 997;

      const idleFor = now - lastInput;
      const ghosting = !reduceMotion && idleFor > 5000;
      if (ghosting && ghostEngage === 0) {
        raw.x = drive.px;
        raw.y = drive.py;
        ghostEngage = 1e-4;
      }
      if (ghosting) {
        ghostEngage = Math.min(ghostEngage + dt / 2.5, 1);
        const g = ghostPath(now / 1000);
        raw.x = g.x;
        raw.y = g.y;
        raw.active = true;
      }
      const engage = ghosting ? ghostEngage * ghostEngage : 1;

      const sm = 1 - Math.exp(-dt * 14);
      drive.px = drive.x;
      drive.py = drive.y;
      drive.x += (raw.x - drive.x) * sm;
      drive.y += (raw.y - drive.y) * sm;

      const instVx = (drive.x - drive.px) / Math.max(dt, 1e-4);
      const instVy = (drive.y - drive.py) / Math.max(dt, 1e-4);
      const kv = 1 - Math.exp(-dt * 7);
      drive.vx += (instVx - drive.vx) * kv;
      drive.vy += (instVy - drive.vy) * kv;
      drive.speed = Math.min(Math.hypot(drive.vx, drive.vy), 3);

      const pressTarget = Math.max(Math.min(drive.speed * 0.9, 1), held ? 1 : 0) * engage;
      drive.press += (pressTarget - drive.press) * (1 - Math.exp(-dt * 8));

      wakeU.u_pos.value.set(drive.x, drive.y);
      wakeU.u_prevPos.value.set(drive.px, drive.py);
      wakeU.u_strength.value = (0.25 + 0.75 * drive.press) * engage;
      wakeU.u_radius.value = 0.026 + 0.02 * drive.press;
      wakeU.u_decayW.value = Math.pow(0.02, dt);
      wakeU.u_decayH.value = Math.pow(0.12, dt);
      wakeU.u_prev.value = trailRead.texture;

      renderer.render({ scene: meshWake, target: trailWrite });
      const swap = trailRead;
      trailRead = trailWrite;
      trailWrite = swap;

      const coeffs = currentCoeffs();
      setVec3("u_s0", coeffs.stops[0]);
      setVec3("u_s1", coeffs.stops[1]);
      setVec3("u_s2", coeffs.stops[2]);
      setVec3("u_s3", coeffs.stops[3]);
      setVec3("u_tint", coeffs.tint);
      mainU.u_time.value = time;
      mainU.u_grain.value = grainSeed;
      mainU.u_wake.value = trailRead.texture;
      setVec2("u_pointer", (drive.x - 0.5) * aspect * 1.9, (drive.y - 0.5) * 1.9);
      setVec2("u_vel", drive.vx * aspect * 1.9, drive.vy * 1.9);
      mainU.u_speed.value = drive.speed;
      mainU.u_press.value = drive.press;

      renderer.render({ scene: meshMain });
    };
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", onPointerUp);
      try {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        // Context already gone: nothing to release.
      }
      canvas.remove();
    };
  }, []);

  if (failed) {
    return (
      <div data-testid="ferro-tide-fallback" style={{ width, height }} aria-label="Ferro Tide unavailable" />
    );
  }

  return (
    <div ref={holderRef} style={{ position: "relative", width, height, overflow: "hidden" }} aria-label="Ferro Tide shader" />
  );
}
