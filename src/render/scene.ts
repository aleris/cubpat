import * as pc from "playcanvas";
import { normalize, quatRotate, type Quat, type Vec3 } from "../core/math.ts";
import { TILT_MAX, VIEW_DIR } from "../core/view.ts";

export interface GameApp {
  app: pc.AppBase;
  camera: pc.Entity;
  canvas: HTMLCanvasElement;
}

const CAMERA_DIR = new pc.Vec3(VIEW_DIR[0], VIEW_DIR[1], VIEW_DIR[2]);
/** Circumscribed radius of the unit cube [-0.5, 0.5]^3. */
const CUBE_RADIUS = Math.sqrt(3) * 0.5;
const FOV = 30;
/**
 * Share of the screen width the cube may span on a narrow (portrait) screen,
 * measured at its widest lean. The rest is a hairline gutter for the raised
 * tiles and the antialiased edge.
 */
const WIDTH_FILL = 0.96;
/**
 * Share of the view height the cube sits below the middle of the screen. The
 * message bar runs along the top edge while playing, so the cube is dropped
 * far enough for that bar to clear its silhouette.
 */
const CUBE_DROP = 0.055;

/**
 * Cube corners under every lean the pointer can cause, as interleaved pairs of
 * (|screen-right offset|, offset towards the camera). The lean turns the cube
 * by up to `TILT_MAX` about any axis in the image plane, which widens the
 * silhouette, so fitting the width to the rest pose would clip a leaning cube.
 */
const LEAN_CORNERS: Float64Array = (() => {
  const right = normalize([VIEW_DIR[2], 0, -VIEW_DIR[0]]);
  const up: Vec3 = [
    VIEW_DIR[1] * right[2] - VIEW_DIR[2] * right[1],
    VIEW_DIR[2] * right[0] - VIEW_DIR[0] * right[2],
    VIEW_DIR[0] * right[1] - VIEW_DIR[1] * right[0]
  ];
  const AZIMUTHS = 72;
  const ANGLES = 6;
  const out: number[] = [];
  for (let a = 0; a < AZIMUTHS; a++) {
    const phi = (a / AZIMUTHS) * Math.PI * 2;
    const axis: Vec3 = [
      right[0] * Math.cos(phi) + up[0] * Math.sin(phi),
      right[1] * Math.cos(phi) + up[1] * Math.sin(phi),
      right[2] * Math.cos(phi) + up[2] * Math.sin(phi)
    ];
    for (let k = 0; k <= ANGLES; k++) {
      const s = Math.sin(((k / ANGLES) * TILT_MAX) / 2);
      const q: Quat = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(((k / ANGLES) * TILT_MAX) / 2)];
      for (let corner = 0; corner < 8; corner++) {
        const p = quatRotate(q, [corner & 1 ? 0.5 : -0.5, corner & 2 ? 0.5 : -0.5, corner & 4 ? 0.5 : -0.5]);
        out.push(
          Math.abs(p[0] * right[0] + p[1] * right[1] + p[2] * right[2]),
          p[0] * VIEW_DIR[0] + p[1] * VIEW_DIR[1] + p[2] * VIEW_DIR[2]
        );
      }
    }
  }
  return Float64Array.from(out);
})();

/**
 * Camera distance at which the widest leaning cube spans `WIDTH_FILL` of the
 * view, given the tangent of the horizontal half field of view. A corner at
 * screen-right offset x and depth z towards the camera projects to x / (d - z).
 */
function widthFitDistance(tanHalfWidth: number): number {
  const limit = tanHalfWidth * WIDTH_FILL;
  let distance = 0;
  for (let i = 0; i < LEAN_CORNERS.length; i += 2) {
    distance = Math.max(distance, LEAN_CORNERS[i + 1] + LEAN_CORNERS[i] / limit);
  }
  return distance;
}

/** Boot a standalone PlayCanvas 2 application with a fixed isometric camera. */
export async function createGameApp(canvas: HTMLCanvasElement): Promise<GameApp> {
  const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes: [pc.DEVICETYPE_WEBGL2],
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });

  const app = new pc.AppBase(canvas);
  const options = new pc.AppOptions();
  options.graphicsDevice = device;
  options.componentSystems = [
    pc.RenderComponentSystem,
    pc.CameraComponentSystem,
    pc.LightComponentSystem
  ];
  options.resourceHandlers = [];
  options.devtools = false;
  app.init(options);

  // PlayCanvas's AppBase leaves RESOLUTION_AUTO at a 1× backing store. Phones
  // report 3–4× and the cube is the whole game, so render at the real density
  // up to 2×: crisp on retina, while keeping the fill rate and texture memory
  // affordable on mobile GPUs.
  app.graphicsDevice.maxPixelRatio = Math.min(2, window.devicePixelRatio || 1);

  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);

  app.scene.ambientLight = new pc.Color(0.5, 0.53, 0.62);

  const camera = new pc.Entity("camera");
  camera.addComponent("camera", {
    clearColor: new pc.Color(0, 0, 0, 0),
    fov: FOV,
    nearClip: 0.1,
    farClip: 50
  });
  app.root.addChild(camera);
  camera.setPosition(CAMERA_DIR.x * 3.2, CAMERA_DIR.y * 3.2, CAMERA_DIR.z * 3.2);
  camera.lookAt(0, 0, 0);

  const key = new pc.Entity("key-light");
  key.addComponent("light", {
    type: "directional",
    color: new pc.Color(1.0, 0.97, 0.92),
    intensity: 1.55
  });
  key.setEulerAngles(48, -34, 0);
  app.root.addChild(key);

  const fill = new pc.Entity("fill-light");
  fill.addComponent("light", {
    type: "directional",
    color: new pc.Color(0.55, 0.68, 1.0),
    intensity: 0.75
  });
  fill.setEulerAngles(-60, 140, 0);
  app.root.addChild(fill);

  let fittedWidth = 0;
  let fittedHeight = 0;
  // Wide screens frame the cube's bounding sphere with a margin against the
  // height. Narrow (portrait, i.e. phone) screens would leave it small that
  // way, so there the cube's actual silhouette fills the width instead; the
  // farther of the two distances wins, so neither axis clips.
  const fitCamera = (): void => {
    const width = Math.max(1, app.graphicsDevice.width);
    const height = Math.max(1, app.graphicsDevice.height);
    fittedWidth = width;
    fittedHeight = height;
    const vHalf = (FOV * Math.PI) / 360;
    const heightFit = (CUBE_RADIUS / Math.sin(vHalf)) * 1.2;
    const distance = Math.max(heightFit, widthFitDistance(Math.tan(vHalf) * (width / height)));
    // Camera and aim point rise together, so the view direction, the fitted
    // width and every picking ray are unchanged; only the cube's place in the
    // frame moves, by `CUBE_DROP` of the visible height at its distance.
    const drop = CUBE_DROP * 2 * distance * Math.tan(vHalf);
    camera.setPosition(
      CAMERA_DIR.x * distance,
      CAMERA_DIR.y * distance + drop,
      CAMERA_DIR.z * distance
    );
    camera.lookAt(0, drop, 0);
  };
  fitCamera();

  const onResize = (): void => {
    app.resizeCanvas();
    fitCamera();
  };
  window.addEventListener("resize", onResize);
  app.on("destroy", () => window.removeEventListener("resize", onResize));

  // The canvas backing store can change size without a window resize event
  // (initial layout, device pixel ratio changes), so keep the framing honest.
  app.on("update", () => {
    if (app.graphicsDevice.width !== fittedWidth || app.graphicsDevice.height !== fittedHeight) {
      fitCamera();
    }
  });

  app.start();

  return { app, camera, canvas };
}
