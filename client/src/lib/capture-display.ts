/**
 * Capture the user's chosen application window in the browser.
 * Avoids PowerShell / CopyFromScreen, which antivirus treats as a grabber.
 */

export function canCaptureDisplay(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

/** Chrome extras: open the Window pane and hide Entire Screen. */
type WindowShareOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
  systemAudio?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
  monitorTypeSurfaces?: "include" | "exclude";
};

async function requestWindowShare(): Promise<MediaStream> {
  const windowFirst: WindowShareOptions = {
    video: { displaySurface: "window" },
    audio: false,
    preferCurrentTab: false,
    selfBrowserSurface: "exclude",
    systemAudio: "exclude",
    surfaceSwitching: "exclude",
    monitorTypeSurfaces: "exclude",
  };
  try {
    return await navigator.mediaDevices.getDisplayMedia(windowFirst);
  } catch (err) {
    // Older engines reject unknown picker hints; retry with window preference only.
    if (err instanceof TypeError) {
      return await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "window" },
        audio: false,
      });
    }
    throw err;
  }
}

export async function captureDisplayJpeg(): Promise<string> {
  if (!canCaptureDisplay()) {
    throw new Error("This browser cannot capture the screen. Upload or paste a screenshot instead.");
  }

  let stream: MediaStream;
  try {
    stream = await requestWindowShare();
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "AbortError") {
      throw new Error("Window share was cancelled. Pick the Thinkorswim window and Share.");
    }
    throw err instanceof Error ? err : new Error("Could not capture the window");
  }

  try {
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("No screen track");

    const ImageCaptureCtor = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame: () => Promise<ImageBitmap> } }).ImageCapture;
    if (typeof ImageCaptureCtor === "function") {
      const bitmap = await new ImageCaptureCtor(track).grabFrame();
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not capture the screen");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return canvas.toDataURL("image/jpeg", 0.82);
    }

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    await new Promise<void>((resolve) => {
      if (video.videoWidth > 0) {
        resolve();
        return;
      }
      video.onloadeddata = () => resolve();
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, video.videoWidth);
    canvas.height = Math.max(1, video.videoHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not capture the screen");
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
