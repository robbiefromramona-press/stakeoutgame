import React from "react";
import { Composition } from "remotion";
import { KenBurns } from "./KenBurns";
import { LineDraw } from "./LineDraw";

const FPS = 30;
const W = 1920;
const H = 1080;

/**
 * One Composition per scene. Filenames point at whatever you copied into
 * remotion/public/ from episodes/<episode>/stills/.
 *
 * Preview everything:  npx remotion studio
 * Render one scene:    npx remotion render Scene3-Occupy out/scene3.mp4
 */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Scene1-Hook"
      component={KenBurns}
      durationInFrames={5 * FPS}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{
        src: "01-hook.png",
        zoom: [1.0, 1.07] as [number, number],
        pan: { x: [0, -2] as [number, number], y: [0, 1] as [number, number] },
      }}
    />
    <Composition
      id="Scene3-Occupy"
      component={LineDraw}
      durationInFrames={6 * FPS}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{
        src: "03-occupy-diagram.png",
        // One backsight line. Retune these against your actual generated still.
        shots: [{ x1: 50, y1: 62, x2: 88, y2: 48 }],
        drawFrames: 24,
      }}
    />
    <Composition
      id="Scene4-Resection"
      component={LineDraw}
      durationInFrames={7 * FPS}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{
        src: "04-resection-diagram.png",
        // Three non-collinear shots, deliberately unequal angles.
        shots: [
          { x1: 50, y1: 58, x2: 14, y2: 34 },
          { x1: 50, y1: 58, x2: 78, y2: 22 },
          { x1: 50, y1: 58, x2: 90, y2: 66 },
        ],
        staggerFrames: 14,
        drawFrames: 22,
        snapAt: 5 * FPS,
      }}
    />
  </>
);
