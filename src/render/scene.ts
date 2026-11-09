import * as pc from "playcanvas";

export interface GameApp {
  app: pc.AppBase;
  camera: pc.Entity;
  canvas: HTMLCanvasElement;
}

const CAMERA_DIR = new pc.Vec3(1, 1, 1).normalize();
/** Circumscribed radius of the unit cube [-0.5, 0.5]^3. */
const CUBE_RADIUS = Math.sqrt(3) * 0.5;
const FOV = 30;

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
  const fitCamera = (): void => {
    const width = Math.max(1, app.graphicsDevice.width);
    const height = Math.max(1, app.graphicsDevice.height);
    fittedWidth = width;
    fittedHeight = height;
    const aspect = width / height;
    const vHalf = (FOV * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const half = Math.min(vHalf, hHalf);
    const distance = (CUBE_RADIUS / Math.sin(half)) * 1.2;
    camera.setPosition(CAMERA_DIR.x * distance, CAMERA_DIR.y * distance, CAMERA_DIR.z * distance);
    camera.lookAt(0, 0, 0);
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
