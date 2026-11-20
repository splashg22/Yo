declare module "*/web/ring.js" {
  export function depth(angleDeg: number): number;
  export function frontIndex(spin: number, n: number): number;
  export function wheelPose(k: number, radius?: number, stepDeg?: number): { x: number; y: number; rot: number; opacity: number; blur: number };
}
