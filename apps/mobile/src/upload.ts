import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import type { Artifact } from "../../../packages/domain/src";
import { API_URL, type MuseApi } from "./api";
import { PICKER_TYPES } from "./file-kinds";
import { shrinkPicture } from "./web-app";

/**
 * Lets the person pick a file (on a phone, "photos" also offers the camera) and adds it to
 * Files. Returns undefined when they cancel.
 */
export async function chooseAndUpload(
  api: MuseApi,
  kind: "any" | "photos" = "any",
): Promise<Artifact | undefined> {
  const result = await DocumentPicker.getDocumentAsync({
    type: kind === "photos" ? ["image/*"] : PICKER_TYPES,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return undefined;
  const file = result.assets[0];
  if (!file) return undefined;
  if (Platform.OS === "web") {
    if (!file.file) throw new Error("The selected file could not be read. Please choose it again.");
    return uploadToFiles(api, file.file);
  }
  const response = await FileSystem.uploadAsync(`${API_URL}/api/files`, file.uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    mimeType: file.mimeType ?? "application/octet-stream",
    headers: { Authorization: `Bearer ${api.token}` },
  });
  const payload = JSON.parse(response.body);
  if (response.status < 200 || response.status >= 300)
    throw new Error(payload.error || "Could not add this file.");
  return payload;
}

/** Adds a file the web app already has (picked, pasted or dropped) to Files. */
export async function uploadToFiles(api: MuseApi, file: File): Promise<Artifact> {
  const upload = await shrinkPicture(file);
  const form = new FormData();
  form.append("file", upload, upload.name);
  return api.request<Artifact>("/api/files", form);
}

/** Lets the person pick a file and sends it to `path` as-is. Undefined when they cancel. */
export async function chooseAndSend<T>(
  api: MuseApi,
  path: string,
  types: string[],
  limit?: { maxBytes: number; tooBig: string },
): Promise<T | undefined> {
  const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
  if (result.canceled) return undefined;
  const file = result.assets[0];
  if (!file) return undefined;
  if (limit && file.size && file.size > limit.maxBytes) throw new Error(limit.tooBig);
  if (Platform.OS === "web") {
    if (!file.file) throw new Error("The selected file could not be read. Please choose it again.");
    const form = new FormData();
    form.append("file", file.file, file.name);
    return api.request<T>(path, form);
  }
  const response = await FileSystem.uploadAsync(`${API_URL}${path}`, file.uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    mimeType: file.mimeType ?? "application/octet-stream",
    headers: { Authorization: `Bearer ${api.token}` },
  });
  const payload = JSON.parse(response.body);
  if (response.status < 200 || response.status >= 300)
    throw new Error(payload.error || "Could not send this file.");
  return payload;
}
