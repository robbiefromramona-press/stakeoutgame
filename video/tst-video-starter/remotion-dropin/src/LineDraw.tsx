import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

const YELLOW = "#F2C200";
const RED = "#E03030";

export type Shot = { x1: number; y1: number; x2: number; y2: number };

/**
 * Draws measurement lines on top of a still, one after another.
 *
 * This is why the diagram stills are generated WITHOUT their lines baked in where
 * possible: an SVG line can be drawn on, re-timed and re-colored. A line painted
 * into a PNG is a line you are stuck with.
 *
 * Coordinates are percentages of the frame, so they survive a resolution change.
 * `snapAt` is the frame where the line flicks from yellow to red -- the "solved" beat.
 */
export const LineDraw: React.FC<{
  src: string;
  shots: Shot[];
  staggerFrames?: number;
  drawFrames?: number;
  snapAt?: number;
  strokeWidth?: number;
}> = ({ src, shots, staggerFrames = 12, drawFrames = 20, snapAt, strokeWidth = 4 }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: "#0C0D0F" }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <AbsoluteFill>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          {shots.map((shot, i) => {
            const start = i * staggerFrames;
            const progress = interpolate(frame, [start, start + drawFrames], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            if (progress <= 0) return null;
            return (
              <line
                key={i}
                x1={shot.x1}
                y1={shot.y1}
                x2={shot.x1 + (shot.x2 - shot.x1) * progress}
                y2={shot.y1 + (shot.y2 - shot.y1) * progress}
                stroke={snapAt !== undefined && frame >= snapAt ? RED : YELLOW}
                // non-scaling-stroke means these are PIXELS, not viewBox units.
                strokeWidth={strokeWidth}
                strokeDasharray="18 12"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
