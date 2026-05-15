import {
  clearAppStateForLocalStorage,
  getDefaultAppState,
} from "@excalidraw/excalidraw/appState";
import { getNonDeletedElements } from "@excalidraw/element";
import { createStore, del, getMany, setMany } from "idb-keyval";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { STORAGE_KEYS } from "../app_constants";

export type WorkspaceDocumentSource =
  | "blank"
  | "local-file"
  | "drag-drop"
  | "share-link"
  | "backend-json"
  | "collab-room";

export type WorkspaceDocumentSnapshot = {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

export type WorkspaceDocumentRecord = {
  id: string;
  title: string;
  source: WorkspaceDocumentSource;
  dirty: boolean;
  updatedAt: number;
  snapshot: WorkspaceDocumentSnapshot;
};

type WorkspaceDocumentMetadata = Omit<WorkspaceDocumentRecord, "snapshot">;

type StoredWorkspace = {
  version: 1;
  activeDocumentId: string | null;
  documents: WorkspaceDocumentMetadata[];
};

const workspaceStore = createStore(
  `${STORAGE_KEYS.IDB_WORKSPACE}-db`,
  `${STORAGE_KEYS.IDB_WORKSPACE}-store`,
);
const WORKSPACE_DOCUMENT_PREFIX = "document:";

const getWorkspaceDocumentKey = (documentId: string) =>
  `${WORKSPACE_DOCUMENT_PREFIX}${documentId}`;

const parseLocalStorageValue = <T>(key: string): T | null => {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch (error: any) {
    console.error(error);
    return null;
  }
};

const restoreStoredAppState = (savedState: Partial<AppState> | null) => {
  if (!savedState) {
    return null;
  }

  return {
    ...getDefaultAppState(),
    ...clearAppStateForLocalStorage(savedState),
  };
};

const saveActiveSceneToLocalStorage = (
  snapshot: WorkspaceDocumentSnapshot | null,
) => {
  try {
    if (!snapshot) {
      localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
      localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);
      return;
    }

    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
      JSON.stringify(getNonDeletedElements(snapshot.elements)),
    );
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify(clearAppStateForLocalStorage(snapshot.appState)),
    );
  } catch (error: any) {
    console.error(error);
  }
};

export const saveUsernameToLocalStorage = (username: string) => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_COLLAB,
      JSON.stringify({ username }),
    );
  } catch (error: any) {
    // Unable to access window.localStorage
    console.error(error);
  }
};

export const importUsernameFromLocalStorage = (): string | null => {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_COLLAB);
    if (data) {
      return JSON.parse(data).username;
    }
  } catch (error: any) {
    // Unable to access localStorage
    console.error(error);
  }

  return null;
};

export const saveWorkspaceToLocalStorage = async (workspace: {
  documents: readonly WorkspaceDocumentRecord[];
  activeDocumentId: string | null;
}) => {
  const previousWorkspace = parseLocalStorageValue<StoredWorkspace>(
    STORAGE_KEYS.LOCAL_STORAGE_WORKSPACE,
  );
  const documentKeys = workspace.documents.map((document) => [
    getWorkspaceDocumentKey(document.id),
    document.snapshot,
  ]) as [string, WorkspaceDocumentSnapshot][];

  try {
    await setMany(documentKeys, workspaceStore);

    const removedDocumentIds =
      previousWorkspace?.documents
        .filter(
          (document) =>
            !workspace.documents.some(
              (currentDocument) => currentDocument.id === document.id,
            ),
        )
        .map((document) => document.id) ?? [];

    if (removedDocumentIds.length) {
      await Promise.all(
        removedDocumentIds.map((documentId) =>
          del(getWorkspaceDocumentKey(documentId), workspaceStore),
        ),
      );
    }

    const documents = workspace.documents.map(
      ({ snapshot, ...document }) => document,
    );
    const storedWorkspace: StoredWorkspace = {
      version: 1,
      activeDocumentId: workspace.activeDocumentId,
      documents,
    };
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_WORKSPACE,
      JSON.stringify(storedWorkspace),
    );

    const activeDocument =
      workspace.documents.find(
        (document) => document.id === workspace.activeDocumentId,
      ) ??
      workspace.documents[0] ??
      null;
    saveActiveSceneToLocalStorage(activeDocument?.snapshot ?? null);
  } catch (error: any) {
    console.error(error);
    throw error;
  }
};

export const importWorkspaceFromLocalStorage = async (): Promise<{
  activeDocumentId: string | null;
  documents: WorkspaceDocumentRecord[];
} | null> => {
  const storedWorkspace = parseLocalStorageValue<StoredWorkspace>(
    STORAGE_KEYS.LOCAL_STORAGE_WORKSPACE,
  );

  if (!storedWorkspace?.documents?.length) {
    return null;
  }

  try {
    const snapshots = (await getMany(
      storedWorkspace.documents.map((document) =>
        getWorkspaceDocumentKey(document.id),
      ),
      workspaceStore,
    )) as (WorkspaceDocumentSnapshot | undefined)[];

    const documents = storedWorkspace.documents.map((document, index) => ({
      ...document,
      snapshot: snapshots[index] ?? {
        elements: [],
        appState: { name: null },
        files: {},
      },
    }));

    return {
      activeDocumentId: storedWorkspace.activeDocumentId,
      documents,
    };
  } catch (error: any) {
    console.error(error);
    return null;
  }
};

export const importFromLocalStorage = () => {
  let savedElements = null;
  let savedState = null;

  try {
    savedElements = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
    savedState = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);
  } catch (error: any) {
    // Unable to access localStorage
    console.error(error);
  }

  let elements: ExcalidrawElement[] = [];
  if (savedElements) {
    try {
      elements = JSON.parse(savedElements);
    } catch (error: any) {
      console.error(error);
    }
  }

  const appState = savedState
    ? restoreStoredAppState(
        parseLocalStorageValue<Partial<AppState>>(
          STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
        ),
      )
    : null;

  return { elements, appState };
};

export const getElementsStorageSize = () => {
  try {
    const elements = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
    const elementsSize = elements?.length || 0;
    return elementsSize;
  } catch (error: any) {
    console.error(error);
    return 0;
  }
};

export const getTotalStorageSize = () => {
  try {
    const appState = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);
    const collab = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_COLLAB);
    const workspace = localStorage.getItem(
      STORAGE_KEYS.LOCAL_STORAGE_WORKSPACE,
    );

    const appStateSize = appState?.length || 0;
    const collabSize = collab?.length || 0;
    const workspaceSize = workspace?.length || 0;

    return appStateSize + collabSize + workspaceSize + getElementsStorageSize();
  } catch (error: any) {
    console.error(error);
    return 0;
  }
};
