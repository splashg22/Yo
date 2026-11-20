import React from "react";
import { Img, staticFile } from "remotion";
import captured from "../captured.json";

type Sizes = Record<string, { w: number; h: number }>;
const SIZES: Sizes = { ...(captured.home.sizes as Sizes), ...(captured.dashboard.sizes as Sizes) };

/** One captured piece of the real UI (a 2× PNG from public/ui), drawn at its CSS size. */
export const Layer: React.FC<{ name: string; x: number; y: number; style?: React.CSSProperties; scale?: number }> = ({ name, x, y, style, scale = 1 }) => {
  const sz = SIZES[name];
  if (!sz) throw new Error(`no capture named ${name}`);
  return <Img src={staticFile(`ui/${name}.png`)} style={{ position: "absolute", left: x, top: y, width: sz.w * scale, height: sz.h * scale, display: "block", ...style }} />;
};
export const sizeOf = (name: string) => SIZES[name];
