// Camera manager: permission, device choice (remembered), 1280x720@30 request with graceful fallback.
const STORAGE_KEY = 'move-arcade.cameraId';

// `ideal`, not `exact`: a camera that can't do 720p30 still opens at its closest mode.
const CAPTURE: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

export function rememberedCameraId(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Opens `deviceId` if given; if that device is gone or busy, falls back to the default camera. */
export async function openCamera(deviceId?: string): Promise<MediaStream> {
  let stream: MediaStream;
  let fellBack = false;
  try {
    const video = deviceId ? { ...CAPTURE, deviceId: { exact: deviceId } } : CAPTURE;
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (err) {
    // Name, not instanceof: OverconstrainedError isn't a DOMException in every engine.
    const name = (err as { name?: string }).name;
    if (!deviceId || name === 'NotAllowedError') throw err;
    console.warn(`camera ${deviceId} failed (${name}); falling back to default`);
    stream = await navigator.mediaDevices.getUserMedia({ video: CAPTURE, audio: false });
    fellBack = true;
  }
  const id = stream.getVideoTracks()[0]?.getSettings().deviceId;
  try {
    // A fallback (chosen camera busy/unplugged for now) must not overwrite the user's choice.
    if (id && !fellBack) localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // storage blocked: the choice just isn't remembered
  }
  return stream;
}

/** Only has labels after permission was granted, so call it after `openCamera`. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}
