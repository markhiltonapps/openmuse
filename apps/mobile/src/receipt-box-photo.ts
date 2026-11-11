import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { API_URL, type MuseApi } from "./api";
import { fitWithin, type SnapAnswer } from "./receipt-box-logic";

/**
 * Photos for the Receipt box: the picker (the phone's camera on a phone, a file chooser on a
 * computer), a smaller copy for upload, and the upload itself (POST /api/receipt-box/snap, field
 * `photo`). The reader refuses a photo over 5 MB, so the copy sent is at most 1600 pixels on its
 * longest side as a JPEG.
 */

/** The reader's limit; a photo that is still bigger after shrinking is not sent. */
export const MAX_BYTES = 5 * 1024 * 1024;
const QUALITY = 0.85;

const web = () => Platform.OS === "web" && typeof document !== "undefined";

/**
 * A copy small enough to upload. Photos from a phone are far bigger than a receipt needs; a
 * picture that can't be decoded here (some HEIC files) is sent as it is, if it fits.
 */
export async function shrinkReceiptPhoto(file: File): Promise<File> {
  const tooBig = () =>
    new Error("That photo is too big for me to read. Try a smaller one, or take a new photo.");
  if (!web() || typeof createImageBitmap !== "function") {
    if (file.size > MAX_BYTES) throw tooBig();
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const size = fitWithin(bitmap.width, bitmap.height);
    // Already small, and a JPEG: nothing to gain.
    if (!size.scaled && file.type === "image/jpeg" && file.size <= 1.5 * 1024 * 1024) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob) throw new Error("no blob");
    const name = `${file.name.replace(/\.[^.]+$/, "") || "receipt"}.jpg`;
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    if (file.size > MAX_BYTES) throw tooBig();
    return file;
  }
}

/**
 * Opens the camera (a phone) or a file chooser (a computer) and resolves with the picture, or
 * undefined if they back out. Call it straight from a tap: the chooser opens before anything is
 * awaited, which browsers require.
 */
export function pickReceiptPhoto(camera: boolean): Promise<File | undefined> {
  return new Promise((resolve) => {
    if (!web()) return resolve(undefined);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    // On a phone this opens the camera itself; a computer ignores it and shows its chooser.
    if (camera) input.setAttribute("capture", "environment");
    input.style.display = "none";
    let done = false;
    const finish = (file?: File) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(file);
    };
    input.onchange = () => finish(input.files?.[0] ?? undefined);
    input.addEventListener("cancel", () => finish(undefined));
    document.body.appendChild(input);
    input.click();
  });
}

/** Whether the browser says the camera is blocked for this site (undefined when it can't tell). */
export async function cameraBlocked(): Promise<boolean | undefined> {
  if (!web() || !("permissions" in navigator)) return undefined;
  try {
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    return status.state === "denied";
  } catch {
    return undefined;
  }
}

let blocked: boolean | undefined;
/** Looks at the camera permission again (call it when a screen that offers Snap opens). */
export async function refreshCamera() {
  blocked = await cameraBlocked();
  return blocked;
}
/** What the last look found: the tap handler can't wait for an answer (the chooser must open at once). */
export const cameraIsBlocked = () => blocked === true;

/** Sends a (shrunk) photo to be read. Throws the server's own words, or TypeError when offline. */
export function sendReceiptPhoto(api: MuseApi, file: File | Blob, name = "receipt.jpg") {
  const form = new FormData();
  form.append("photo", file, name);
  return api.request<SnapAnswer>("/api/receipt-box/snap", form);
}

/** Whether the failure is the network's (offline, server unreachable), not the server's answer. */
export function isOffline(error: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return error instanceof TypeError;
}

/**
 * On a phone app (no web page): the document picker, then the upload. There is no smaller copy
 * here (no image library is installed), so a very large photo is turned away by the server.
 */
export async function pickAndSendNative(api: MuseApi): Promise<SnapAnswer | undefined> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["image/*"],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return undefined;
  const file = result.assets[0];
  if (!file) return undefined;
  if (file.size && file.size > MAX_BYTES)
    throw new Error(
      "That photo is too big for me to read. Try a smaller one, or take a new photo.",
    );
  const response = await FileSystem.uploadAsync(`${API_URL}/api/receipt-box/snap`, file.uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "photo",
    mimeType: file.mimeType ?? "image/jpeg",
    headers: { Authorization: `Bearer ${api.token}` },
  });
  const payload = JSON.parse(response.body) as SnapAnswer & { error?: string };
  if (response.status < 200 || response.status >= 300)
    throw new Error(payload.error || "I couldn’t read that photo. Try again.");
  return payload;
}
