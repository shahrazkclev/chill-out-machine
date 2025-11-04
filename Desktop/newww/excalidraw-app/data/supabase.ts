import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";
import { createClient } from "@supabase/supabase-js";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

import { FILE_CACHE_MAX_AGE_SEC } from "../app_constants";

import { getSyncableElements } from ".";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { Socket } from "socket.io-client";

// private
// -----------------------------------------------------------------------------

let SUPABASE_URL: string;
let SUPABASE_ANON_KEY: string;

try {
  SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
  SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
} catch (error: any) {
  console.warn("Error loading Supabase config:", error);
  SUPABASE_URL = "";
  SUPABASE_ANON_KEY = "";
}

let supabaseClient: ReturnType<typeof createClient> | null = null;

const _getSupabaseClient = () => {
  if (!supabaseClient && SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
};

// -----------------------------------------------------------------------------

export const loadSupabaseStorage = async () => {
  return _getSupabaseClient()?.storage;
};

type SupabaseStoredScene = {
  scene_version: number;
  iv: Uint8Array;
  ciphertext: Uint8Array;
};

type SupabaseSceneRow = {
  room_id: string;
  scene_version: number;
  iv: Uint8Array;
  ciphertext: Uint8Array;
};

const encryptElements = async (
  key: string,
  elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);

  return { ciphertext: encryptedBuffer, iv };
};

const decryptElements = async (
  data: SupabaseStoredScene,
  roomKey: string,
): Promise<readonly ExcalidrawElement[]> => {
  const ciphertext = data.ciphertext;
  const iv = data.iv;

  const decrypted = await decryptData(iv, ciphertext, roomKey);
  const decodedData = new TextDecoder("utf-8").decode(
    new Uint8Array(decrypted),
  );
  return JSON.parse(decodedData);
};

class SupabaseSceneVersionCache {
  private static cache = new WeakMap<Socket, number>();
  static get = (socket: Socket) => {
    return SupabaseSceneVersionCache.cache.get(socket);
  };
  static set = (
    socket: Socket,
    elements: readonly SyncableExcalidrawElement[],
  ) => {
    SupabaseSceneVersionCache.cache.set(socket, getSceneVersion(elements));
  };
}

export const isSavedToSupabase = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    const sceneVersion = getSceneVersion(elements);

    return SupabaseSceneVersionCache.get(portal.socket) === sceneVersion;
  }
  // if no room exists, consider the room saved so that we don't unnecessarily
  // prevent unload (there's nothing we could do at that point anyway)
  return true;
};

export const saveFilesToSupabase = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const storage = await loadSupabaseStorage();
  if (!storage) {
    throw new Error("Supabase storage not initialized");
  }

  const erroredFiles: FileId[] = [];
  const savedFiles: FileId[] = [];

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        const filePath = `${prefix}/${id}`;
        const { error } = await storage.from("excalidraw-files").upload(
          filePath,
          buffer,
          {
            cacheControl: `public, max-age=${FILE_CACHE_MAX_AGE_SEC}`,
            upsert: true,
          },
        );

        if (error) {
          throw error;
        }

        savedFiles.push(id);
      } catch (error: any) {
        console.error(`Error saving file ${id}:`, error);
        erroredFiles.push(id);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

const createSupabaseSceneDocument = async (
  elements: readonly SyncableExcalidrawElement[],
  roomKey: string,
): Promise<SupabaseStoredScene> => {
  const sceneVersion = getSceneVersion(elements);
  const { ciphertext, iv } = await encryptElements(roomKey, elements);
  return {
    scene_version: sceneVersion,
    ciphertext: new Uint8Array(ciphertext),
    iv: iv,
  };
};

export const saveToSupabase = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (
    // bail if no room exists as there's nothing we could do at this point
    !roomId ||
    !roomKey ||
    !socket ||
    isSavedToSupabase(portal, elements)
  ) {
    return null;
  }

  const supabase = _getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase client not initialized");
  }

  // Use a transaction-like approach with Supabase
  const { data: existingScene } = await (supabase
    .from("excalidraw_scenes") as any)
    .select("*")
    .eq("room_id", roomId)
    .single();

  let storedScene: SupabaseStoredScene;

  if (!existingScene) {
    // Create new scene
    storedScene = await createSupabaseSceneDocument(elements, roomKey);
    const { error } = await (supabase
      .from("excalidraw_scenes") as any)
      .insert({
        room_id: roomId,
        scene_version: storedScene.scene_version,
        iv: storedScene.iv,
        ciphertext: storedScene.ciphertext,
      });

    if (error) {
      throw error;
    }
  } else {
    // Update existing scene with reconciliation
    const existingSceneData = existingScene as SupabaseSceneRow;
    const prevStoredScene: SupabaseStoredScene = {
      scene_version: existingSceneData.scene_version,
      iv: new Uint8Array(existingSceneData.iv),
      ciphertext: new Uint8Array(existingSceneData.ciphertext),
    };

    const prevStoredElements = getSyncableElements(
      restoreElements(await decryptElements(prevStoredScene, roomKey), null),
    );
    const reconciledElements = getSyncableElements(
      reconcileElements(
        elements,
        prevStoredElements as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
        appState,
      ),
    );

    storedScene = await createSupabaseSceneDocument(reconciledElements, roomKey);

    const { error } = await (supabase
      .from("excalidraw_scenes") as any)
      .update({
        scene_version: storedScene.scene_version,
        iv: storedScene.iv,
        ciphertext: storedScene.ciphertext,
      })
      .eq("room_id", roomId);

    if (error) {
      throw error;
    }
  }

  const storedElements = getSyncableElements(
    restoreElements(await decryptElements(storedScene, roomKey), null),
  );

  SupabaseSceneVersionCache.set(socket, storedElements);

  return storedElements;
};

export const loadFromSupabase = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  const supabase = _getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await (supabase
    .from("excalidraw_scenes") as any)
    .select("*")
    .eq("room_id", roomId)
    .single();

  if (error || !data) {
    return null;
  }

  const sceneData = data as SupabaseSceneRow;
  const storedScene: SupabaseStoredScene = {
    scene_version: sceneData.scene_version,
    iv: new Uint8Array(sceneData.iv),
    ciphertext: new Uint8Array(sceneData.ciphertext),
  };

  const elements = getSyncableElements(
    restoreElements(await decryptElements(storedScene, roomKey), null, {
      deleteInvisibleElements: true,
    }),
  );

  if (socket) {
    SupabaseSceneVersionCache.set(socket, elements);
  }

  return elements;
};

export const loadFilesFromSupabase = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const storage = await loadSupabaseStorage();
  if (!storage) {
    return { loadedFiles: [], erroredFiles: new Map<FileId, true>() };
  }

  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const filePath = `${prefix}/${id}`;
        const { data, error } = await storage
          .from("excalidraw-files")
          .download(filePath);

        if (error || !data) {
          erroredFiles.set(id, true);
          return;
        }

        const arrayBuffer = await data.arrayBuffer();

        const { data: decompressedData, metadata } =
          await decompressData<BinaryFileMetadata>(
            new Uint8Array(arrayBuffer),
            {
              decryptionKey,
            },
          );

        const dataURL = new TextDecoder().decode(decompressedData) as DataURL;

        loadedFiles.push({
          mimeType: metadata.mimeType || MIME_TYPES.binary,
          id,
          dataURL,
          created: metadata?.created || Date.now(),
          lastRetrieved: metadata?.created || Date.now(),
        });
      } catch (error: any) {
        console.error(`Error loading file ${id}:`, error);
        erroredFiles.set(id, true);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};
