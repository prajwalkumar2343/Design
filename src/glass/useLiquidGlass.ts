import { useEffect, useRef } from "react";

import { attachLiquidGlass, type LiquidGlassOptions } from "./liquid-glass";

/**
 * Attaches Apple-style Liquid Glass refraction to a floating surface for its
 * whole lifetime. Re-attaches only when an option value actually changes.
 */
export function useLiquidGlass<T extends HTMLElement>(options: LiquidGlassOptions = {}) {
  const ref = useRef<T | null>(null);
  const { radius, bezel, scale, blur, saturation } = options;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return attachLiquidGlass(element, { radius, bezel, scale, blur, saturation });
  }, [radius, bezel, scale, blur, saturation]);
  return ref;
}
