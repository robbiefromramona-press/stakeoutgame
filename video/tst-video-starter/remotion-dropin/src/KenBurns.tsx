import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * Slow push/pan across a still. This is what carries images 01 and 03 --
 * a locked-off still reads as a dead frame; 4% of drift reads as a camera.
 *
 * Keep `zoom` small. Anything past ~1.10 starts showing the upscaler's sins.
 */
export const KenBurns: React.FC<{
  src: string;
  zoom?: [number, number];
  pan?: { x: [number, number]; y: [number, number] };
}> = ({ src, zoom = [1.0, 1.06], pan = { x: [0, -2], y: [0, 1] } }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const span = [0, durationInFrames - 1];
  const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  const scale = interpolate(frame, span, zoom, ease);
  const x = interpolate(frame, span, pan.x, ease);
  const y = interpolate(frame, span, pan.y, ease);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0C0D0F", overflow: "hidden" }}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translate(${x}%, ${y}%)`,
        }}
      />
    </AbsoluteFill>
  );
};
