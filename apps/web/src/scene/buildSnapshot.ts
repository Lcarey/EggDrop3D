import type { Camera, Scene, WebGLRenderer } from "three";

/**
 * Lets non-R3F code (the Save flow in App.tsx) grab a thumbnail of the build
 * canvas. The build canvas runs frameloop="demand" without a preserved
 * drawing buffer, so the capture re-renders synchronously right before
 * reading pixels.
 */
type SnapshotSource = { gl: WebGLRenderer; scene: Scene; camera: Camera };

let source: SnapshotSource | null = null;

export const registerBuildSnapshotSource = (next: SnapshotSource | null) => {
  source = next;
};

export const BUILD_THUMBNAIL_SIZE_PX = 128;

/** Centre-cropped square JPEG data URL of the current build view, or null if the build canvas is not mounted. */
export const captureBuildThumbnail = (): string | null => {
  if (!source) return null;
  try {
    const { gl, scene, camera } = source;
    gl.render(scene, camera);
    const frame = gl.domElement;
    if (frame.width === 0 || frame.height === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = BUILD_THUMBNAIL_SIZE_PX;
    canvas.height = BUILD_THUMBNAIL_SIZE_PX;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const cropSize = Math.min(frame.width, frame.height);
    context.drawImage(
      frame,
      (frame.width - cropSize) / 2,
      (frame.height - cropSize) / 2,
      cropSize,
      cropSize,
      0,
      0,
      BUILD_THUMBNAIL_SIZE_PX,
      BUILD_THUMBNAIL_SIZE_PX,
    );
    return canvas.toDataURL("image/jpeg", .78);
  } catch {
    return null;
  }
};
