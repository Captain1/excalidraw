import {
  Excalidraw,
  LiveCollaborationTrigger,
  TTDDialogTrigger,
  CaptureUpdateAction,
  reconcileElements,
  useEditorInterface,
  ExcalidrawAPIProvider,
  useExcalidrawAPI,
  hashElementsVersion,
} from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import {
  clearAppStateForLocalStorage,
  getDefaultAppState,
} from "@excalidraw/excalidraw/appState";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@excalidraw/excalidraw/components/CommandPalette/CommandPalette";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { OverwriteConfirmDialog } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { ShareableLinkDialog } from "@excalidraw/excalidraw/components/ShareableLinkDialog";
import Trans from "@excalidraw/excalidraw/components/Trans";
import {
  APP_NAME,
  EVENT,
  MIME_TYPES,
  THEME,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  isRunningInIframe,
  isDevEnv,
} from "@excalidraw/common";
import polyfill from "@excalidraw/excalidraw/polyfill";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadFromBlob,
  loadSceneOrLibraryFromBlob,
} from "@excalidraw/excalidraw/data/blob";
import { fileOpen } from "@excalidraw/excalidraw/data/filesystem";
import { t } from "@excalidraw/excalidraw/i18n";

import {
  GithubIcon,
  XBrandIcon,
  DiscordIcon,
  ExcalLogo,
  usersIcon,
  exportToPlus,
  share,
  youtubeIcon,
} from "@excalidraw/excalidraw/components/icons";
import { isElementLink } from "@excalidraw/element";
import {
  bumpElementVersions,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { newElementWith } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "@excalidraw/excalidraw/data/library";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { RestoredDataState } from "@excalidraw/excalidraw/data/restore";
import type {
  ExcalidrawElement,
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ResolutionType } from "@excalidraw/common/utility-types";

import CustomStats from "./CustomStats";
import {
  Provider,
  useAtom,
  useAtomValue,
  useAtomWithInitialValue,
  appJotaiStore,
} from "./app-jotai";
import {
  FIREBASE_STORAGE_PREFIXES,
  isExcalidrawPlusSignedUser,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
} from "./collab/Collab";
import { AppFooter } from "./components/AppFooter";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import {
  ExportToExcalidrawPlus,
  exportToExcalidrawPlus,
} from "./components/ExportToExcalidrawPlus";
import { TopErrorBoundary } from "./components/TopErrorBoundary";

import {
  exportToBackend,
  getCollaborationLinkData,
  importFromBackend,
  isCollaborationLink,
} from "./data";

import { updateStaleImageStatuses } from "./data/FileManager";
import { FileStatusStore } from "./data/fileStatusStore";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
  importWorkspaceFromLocalStorage,
  type WorkspaceDocumentRecord as DocumentRecord,
  type WorkspaceDocumentSnapshot as DocumentSnapshot,
  type WorkspaceDocumentSource as DocumentSource,
} from "./data/localStorage";

import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
  localStorageQuotaExceededAtom,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import { useHandleAppTheme } from "./useHandleAppTheme";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { AIComponents } from "./components/AI";
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";

import "./index.scss";

import { ExcalidrawPlusPromoBanner } from "./components/ExcalidrawPlusPromoBanner";
import { AppSidebar } from "./components/AppSidebar";

import type { CollabAPI } from "./collab/Collab";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const createDocumentId = () => `doc-${Math.random().toString(36).slice(2, 10)}`;

const createBlankDocumentSnapshot = (): DocumentSnapshot => ({
  elements: [],
  appState: {
    name: null,
  },
  files: {},
});

const getDocumentFiles = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): BinaryFiles => {
  return elements.reduce((acc, element) => {
    if (
      isInitializedImageElement(element) &&
      element.fileId &&
      files[element.fileId]
    ) {
      acc[element.fileId] = files[element.fileId];
    }
    return acc;
  }, {} as BinaryFiles);
};

const getActiveDocument = (
  documents: readonly DocumentRecord[],
  activeDocumentId: string | null,
) => {
  return documents.find((document) => document.id === activeDocumentId) ?? null;
};

const sanitizeAppStateForDocument = (
  appState: Partial<AppState> | null | undefined,
): Partial<AppState> => {
  if (!appState) {
    return { name: null };
  }

  const sanitized = {
    ...restoreAppState(
      clearAppStateForLocalStorage(appState),
      getDefaultAppState() as AppState,
    ),
    name: appState.name ?? null,
    fileHandle: appState.fileHandle ?? null,
  } as Partial<AppState>;

  delete sanitized.openDialog;
  delete sanitized.openMenu;
  delete sanitized.openPopup;
  delete sanitized.contextMenu;
  delete sanitized.toast;
  delete sanitized.errorMessage;
  delete sanitized.isLoading;
  delete sanitized.collaborators;
  delete sanitized.userToFollow;
  delete sanitized.followedBy;
  delete sanitized.selectedElementsAreBeingDragged;
  delete sanitized.selectionElement;
  delete sanitized.suggestedBinding;
  delete sanitized.snapLines;
  delete sanitized.hoveredElementIds;
  delete sanitized.elementsToHighlight;
  delete sanitized.activeEmbeddable;
  delete sanitized.newElement;
  delete sanitized.multiElement;
  delete sanitized.resizingElement;
  delete sanitized.editingTextElement;
  delete sanitized.selectedLinearElement;
  delete sanitized.searchMatches;
  delete sanitized.editingFrame;
  delete sanitized.frameToHighlight;
  delete sanitized.activeLockedId;
  delete sanitized.originSnapOffset;
  delete sanitized.width;
  delete sanitized.height;
  delete sanitized.offsetLeft;
  delete sanitized.offsetTop;

  return sanitized;
};

const createDocumentRecord = (opts?: {
  title?: string | null;
  source?: DocumentSource;
  snapshot?: Partial<DocumentSnapshot>;
}): DocumentRecord => ({
  id: createDocumentId(),
  title: opts?.title || t("labels.untitled"),
  source: opts?.source || "blank",
  dirty: false,
  updatedAt: Date.now(),
  snapshot: {
    ...createBlankDocumentSnapshot(),
    ...opts?.snapshot,
    appState: sanitizeAppStateForDocument(opts?.snapshot?.appState),
  },
});

const updateDocumentRecords = (
  documents: readonly DocumentRecord[],
  documentId: string,
  snapshot: DocumentSnapshot,
  opts?: { dirty?: boolean; title?: string | null },
): DocumentRecord[] => {
  return documents.map((document) =>
    document.id === documentId
      ? {
          ...document,
          title:
            opts?.title ??
            snapshot.appState.name ??
            document.title ??
            t("labels.untitled"),
          dirty: opts?.dirty ?? document.dirty,
          updatedAt: Date.now(),
          snapshot: {
            elements: snapshot.elements,
            files: snapshot.files,
            appState: sanitizeAppStateForDocument(snapshot.appState),
          },
        }
      : document,
  );
};

const areDocumentFilesEqual = (
  prevFiles: BinaryFiles | null | undefined,
  nextFiles: BinaryFiles | null | undefined,
) => {
  const prev = prevFiles ?? {};
  const next = nextFiles ?? {};
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  if (prevKeys.length !== nextKeys.length) {
    return false;
  }

  return prevKeys.every(
    (key) => key in next && prev[key as FileId] === next[key as FileId],
  );
};

const areDocumentSnapshotsEqual = (
  prevSnapshot: DocumentSnapshot,
  nextSnapshot: DocumentSnapshot,
) => {
  const prevAppState = sanitizeAppStateForDocument(prevSnapshot.appState);
  const nextAppState = sanitizeAppStateForDocument(nextSnapshot.appState);

  return (
    prevSnapshot.elements.length === nextSnapshot.elements.length &&
    hashElementsVersion(prevSnapshot.elements) ===
      hashElementsVersion(nextSnapshot.elements) &&
    JSON.stringify(prevAppState) === JSON.stringify(nextAppState) &&
    areDocumentFilesEqual(prevSnapshot.files, nextSnapshot.files)
  );
};

const getAllDocumentFileIds = (documents: readonly DocumentRecord[]) => {
  return Array.from(
    new Set(
      documents.flatMap((document) =>
        document.snapshot.elements.flatMap((element) =>
          isInitializedImageElement(element) && element.fileId
            ? [element.fileId]
            : [],
        ),
      ),
    ),
  );
};

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  let scene: Omit<
    RestoredDataState,
    // we're not storing files in the scene database/localStorage, and instead
    // fetch them async from a different store
    "files"
  > & {
    scrollToContent?: boolean;
  } = {
    elements: restoreElements(localDataState?.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    }),
    appState: restoreAppState(localDataState?.appState, null),
  };

  let roomLinkData = getCollaborationLinkData(window.location.href);
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        const imported = await importFromBackend(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
        );

        scene = {
          elements: bumpElementVersions(
            restoreElements(imported.elements, null, {
              repairBindings: true,
              deleteInvisibleElements: true,
            }),
            localDataState?.elements,
          ),
          appState: restoreAppState(
            imported.appState,
            // local appState when importing from backend to ensure we restore
            // localStorage user settings which we do not persist on server.
            localDataState?.appState,
          ),
        };
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const ExcalidrawWrapper = () => {
  const excalidrawAPI = useExcalidrawAPI();

  const [errorMessage, setErrorMessage] = useState("");
  const isCollabDisabled = isRunningInIframe();

  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  const [langCode, setLangCode] = useAppLangCode();

  const editorInterface = useEditorInterface();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const switchingDocumentRef = useRef(false);
  const documentsRef = useRef<DocumentRecord[]>([]);
  const activeDocumentIdRef = useRef<string | null>(null);

  const activeDocument = useMemo(
    () => getActiveDocument(documents, activeDocumentId),
    [documents, activeDocumentId],
  );

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    activeDocumentIdRef.current = activeDocumentId;
  }, [activeDocumentId]);

  const createInitialDocument = useCallback(
    (scene: ExcalidrawInitialDataState | null) => {
      return createDocumentRecord({
        title: scene?.appState?.name ?? null,
        source: "blank",
        snapshot: {
          elements: scene?.elements ?? [],
          appState: scene?.appState ?? { name: null },
          files: scene?.files ?? {},
        },
      });
    },
    [],
  );

  const getSnapshotFromAPI = useCallback(
    (api: ExcalidrawImperativeAPI): DocumentSnapshot => {
      const elements = api.getSceneElementsIncludingDeleted();
      return {
        elements,
        appState: sanitizeAppStateForDocument(api.getAppState()),
        files: getDocumentFiles(elements, api.getFiles()),
      };
    },
    [],
  );

  const applyDocumentToEditor = useCallback(
    (document: DocumentRecord) => {
      if (!excalidrawAPI) {
        return;
      }

      switchingDocumentRef.current = true;
      excalidrawAPI.resetScene({ resetLoadingState: true });
      const restoredAppState = restoreAppState(
        clearAppStateForLocalStorage(document.snapshot.appState),
        getDefaultAppState() as AppState,
      );
      const {
        viewModeEnabled: _vme,
        zenModeEnabled: _zne,
        gridModeEnabled: _gme,
        objectsSnapModeEnabled: _osme,
        ...restAppState
      } = restoredAppState;
      excalidrawAPI.updateScene({
        elements: document.snapshot.elements,
        appState: {
          ...restAppState,
          name: document.snapshot.appState.name ?? null,
          isLoading: false,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      if (Object.keys(document.snapshot.files).length) {
        excalidrawAPI.addFiles(Object.values(document.snapshot.files));
      }
      excalidrawAPI.history.clear();
      switchingDocumentRef.current = false;
    },
    [excalidrawAPI],
  );

  const persistWorkspace = useCallback(
    (
      nextDocuments: readonly DocumentRecord[],
      nextActiveDocumentId: string | null,
    ) => {
      if (!nextDocuments.length) {
        return;
      }
      LocalData.saveWorkspace({
        documents: nextDocuments,
        activeDocumentId: nextActiveDocumentId,
      }).catch((error) => {
        console.error(error);
      });
    },
    [],
  );

  const captureCurrentDocument = useCallback(() => {
    if (!excalidrawAPI || !activeDocumentId) {
      return documents;
    }

    const nextDocuments = updateDocumentRecords(
      documents,
      activeDocumentId,
      getSnapshotFromAPI(excalidrawAPI),
      {
        dirty: getActiveDocument(documents, activeDocumentId)?.dirty,
        title: excalidrawAPI.getAppState().name ?? null,
      },
    );
    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
    return nextDocuments;
  }, [activeDocumentId, documents, excalidrawAPI, getSnapshotFromAPI]);

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const collabError = useAtomValue(collabErrorIndicatorAtom);

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  const [, forceRefresh] = useState(false);

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  // ---------------------------------------------------------------------------
  // Hoisted loadImages
  // ---------------------------------------------------------------------------
  const loadImages = useCallback(
    (data: ResolutionType<typeof initializeScene>, isInitialLoad = false) => {
      if (!data.scene || !excalidrawAPI) {
        return;
      }

      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          if (fileIds.length) {
            // Direct Firebase call (not through FileManager), so track manually
            FileStatusStore.updateStatuses(
              fileIds.map((id) => [id, "loading"]),
            );
          }
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
            FileStatusStore.updateStatuses([
              ...loadedFiles.map((f) => [f.id, "loaded"] as [FileId, "loaded"]),
              ...[...erroredFiles.keys()].map(
                (id) => [id, "error"] as [FileId, "error"],
              ),
            ]);
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(async ({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          LocalData.fileStorage.clearObsoleteFiles({
            currentFileIds: getAllDocumentFileIds(documentsRef.current).length
              ? getAllDocumentFileIds(documentsRef.current)
              : fileIds,
          });
        }
      }
    },
    [collabAPI, excalidrawAPI],
  );

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
      const restoredWorkspace = await importWorkspaceFromLocalStorage();
      const initialDocuments = restoredWorkspace?.documents.length
        ? restoredWorkspace.documents
        : [createInitialDocument(data.scene)];
      const initialActiveDocument =
        getActiveDocument(
          initialDocuments,
          restoredWorkspace?.activeDocumentId ??
            initialDocuments[0]?.id ??
            null,
        ) ?? initialDocuments[0];

      documentsRef.current = initialDocuments;
      activeDocumentIdRef.current = initialActiveDocument?.id ?? null;
      loadImages(data, /* isInitialLoad */ true);
      setDocuments(initialDocuments);
      setActiveDocumentId(initialActiveDocument?.id ?? null);
      if (initialActiveDocument) {
        applyDocumentToEditor(initialActiveDocument);
      }
      persistWorkspace(initialDocuments, initialActiveDocument?.id ?? null);
    });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
          loadImages(data);
          const currentActiveDocumentId = activeDocumentIdRef.current;
          if (data.scene && currentActiveDocumentId) {
            const nextSnapshot: DocumentSnapshot = {
              elements: restoreElements(data.scene.elements, null, {
                repairBindings: true,
              }),
              appState: restoreAppState(data.scene.appState, null),
              files: data.scene.files ?? {},
            };
            const nextDocuments = updateDocumentRecords(
              documentsRef.current,
              currentActiveDocumentId,
              nextSnapshot,
              {
                dirty: false,
                title: nextSnapshot.appState.name ?? null,
              },
            );
            setDocuments(nextDocuments);
            applyDocumentToEditor({
              id: currentActiveDocumentId,
              title: nextSnapshot.appState.name ?? t("labels.untitled"),
              source: "blank",
              dirty: false,
              updatedAt: Date.now(),
              snapshot: nextSnapshot,
            });
          }
        });
      }
    };

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (
          isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_WORKSPACE) ||
          isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)
        ) {
          importWorkspaceFromLocalStorage().then((workspace) => {
            if (workspace?.documents.length) {
              setDocuments(workspace.documents);
              const nextActiveDocument =
                getActiveDocument(
                  workspace.documents,
                  workspace.activeDocumentId ??
                    workspace.documents[0]?.id ??
                    null,
                ) ?? workspace.documents[0];
              setActiveDocumentId(nextActiveDocument?.id ?? null);
              if (nextActiveDocument) {
                applyDocumentToEditor(nextActiveDocument);
              }
            } else {
              const localDataState = importFromLocalStorage();
              excalidrawAPI.updateScene({
                ...localDataState,
                captureUpdate: CaptureUpdateAction.NEVER,
              });
            }
          });
          const username = importUsernameFromLocalStorage();
          setLangCode(getPreferredLanguage());
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          collabAPI?.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [
    isCollabDisabled,
    collabAPI,
    excalidrawAPI,
    setLangCode,
    loadImages,
    applyDocumentToEditor,
    createInitialDocument,
    persistWorkspace,
  ]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (switchingDocumentRef.current) {
      return;
    }

    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    const nextSnapshot: DocumentSnapshot = {
      elements,
      appState,
      files: getDocumentFiles(elements, files),
    };
    const currentDocument = activeDocumentId
      ? getActiveDocument(documents, activeDocumentId)
      : null;
    const didDocumentSnapshotChange = currentDocument
      ? !areDocumentSnapshotsEqual(currentDocument.snapshot, nextSnapshot)
      : false;
    const nextDocuments =
      activeDocumentId && didDocumentSnapshotChange
        ? updateDocumentRecords(documents, activeDocumentId, nextSnapshot, {
            dirty: true,
            title: appState.name ?? null,
          })
        : documents;

    if (activeDocumentId && didDocumentSnapshotChange) {
      setDocuments(nextDocuments);
    }

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (didDocumentSnapshotChange && !LocalData.isSavePaused()) {
      LocalData.save(
        elements,
        appState,
        files,
        {
          documents: nextDocuments,
          activeDocumentId,
        },
        () => {
          if (excalidrawAPI) {
            let didChange = false;

            const elements = excalidrawAPI
              .getSceneElementsIncludingDeleted()
              .map((element) => {
                if (
                  LocalData.fileStorage.shouldUpdateImageElementStatus(element)
                ) {
                  const newElement = newElementWith(element, {
                    status: "saved",
                  });
                  if (newElement !== element) {
                    didChange = true;
                  }
                  return newElement;
                }
                return element;
              });

            if (didChange) {
              excalidrawAPI.updateScene({
                elements,
                captureUpdate: CaptureUpdateAction.NEVER,
              });
            }
          }
        },
      );
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const switchToDocument = useCallback(
    (nextDocumentId: string) => {
      if (!excalidrawAPI || nextDocumentId === activeDocumentId) {
        return;
      }

      const nextDocuments = captureCurrentDocument();
      const nextDocument = getActiveDocument(nextDocuments, nextDocumentId);
      if (!nextDocument) {
        return;
      }

      setActiveDocumentId(nextDocumentId);
      applyDocumentToEditor(nextDocument);
      persistWorkspace(nextDocuments, nextDocumentId);
    },
    [
      activeDocumentId,
      applyDocumentToEditor,
      captureCurrentDocument,
      excalidrawAPI,
      persistWorkspace,
    ],
  );

  const createBlankDocument = useCallback(() => {
    const nextDocument = createDocumentRecord();
    const nextDocuments = captureCurrentDocument();
    const updatedDocuments = [...nextDocuments, nextDocument];
    setDocuments(updatedDocuments);
    setActiveDocumentId(nextDocument.id);
    applyDocumentToEditor(nextDocument);
    persistWorkspace(updatedDocuments, nextDocument.id);
  }, [applyDocumentToEditor, captureCurrentDocument, persistWorkspace]);

  const closeDocument = useCallback(
    (documentId: string) => {
      if (documents.length <= 1) {
        return;
      }

      const nextDocuments = documents.filter(
        (document) => document.id !== documentId,
      );
      setDocuments(nextDocuments);

      if (activeDocumentId === documentId) {
        const nextActive =
          nextDocuments[nextDocuments.length - 1] ?? nextDocuments[0] ?? null;
        setActiveDocumentId(nextActive?.id ?? null);
        if (nextActive) {
          applyDocumentToEditor(nextActive);
        }
        persistWorkspace(nextDocuments, nextActive?.id ?? null);
      } else {
        persistWorkspace(nextDocuments, activeDocumentId);
      }
    },
    [activeDocumentId, applyDocumentToEditor, documents, persistWorkspace],
  );

  const openSceneInNewTab = useCallback(
    async (source: DocumentSource = "local-file") => {
      try {
        const file = await fileOpen({
          description: "Excalidraw files",
        });
        const result = await loadSceneOrLibraryFromBlob(
          file,
          null,
          null,
          file.handle,
        );
        if (result.type !== MIME_TYPES.excalidraw) {
          setErrorMessage(t("alerts.couldNotLoadInvalidFile"));
          return;
        }
        const nextDocuments = captureCurrentDocument();
        const nextDocument = createDocumentRecord({
          title:
            result.data.appState?.name ??
            file.name.replace(/\.excalidraw$/i, ""),
          source,
          snapshot: {
            elements: result.data.elements ?? [],
            appState: result.data.appState ?? { name: null },
            files: result.data.files ?? {},
          },
        });
        const updatedDocuments = [...nextDocuments, nextDocument];
        setDocuments(updatedDocuments);
        setActiveDocumentId(nextDocument.id);
        applyDocumentToEditor(nextDocument);
        persistWorkspace(updatedDocuments, nextDocument.id);
      } catch (error: any) {
        if (error?.name !== "AbortError") {
          setErrorMessage(
            error?.message || t("alerts.couldNotLoadInvalidFile"),
          );
        }
      }
    },
    [applyDocumentToEditor, captureCurrentDocument, persistWorkspace],
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);

  const localStorageQuotaExceeded = useAtomValue(localStorageQuotaExceededAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  // ---------------------------------------------------------------------------
  // onExport — intercepts file save to wait for pending image loads
  // ---------------------------------------------------------------------------
  const onExport: Required<ExcalidrawProps>["onExport"] = useCallback(
    async function* () {
      let snapshot = FileStatusStore.getSnapshot();
      const { pending, total } = FileStatusStore.getPendingCount(
        snapshot.value,
      );
      if (pending === 0) {
        return;
      }

      // Yield initial progress
      yield {
        type: "progress",
        progress: (total - pending) / total,
        message: `Loading images (${total - pending}/${total})...`,
      };

      // Wait for all pending images to finish
      while (true) {
        snapshot = await FileStatusStore.pull(snapshot.version);
        const { pending: nowPending, total: nowTotal } =
          FileStatusStore.getPendingCount(snapshot.value);

        yield {
          type: "progress",
          progress: (nowTotal - nowPending) / nowTotal,
          message: `Loading images (${nowTotal - nowPending}/${nowTotal})...`,
        };

        if (nowPending === 0) {
          await new Promise((r) => setTimeout(r, 500));
          yield {
            type: "progress",
            message: `Preparing export...`,
          };
          return;
        }
      }
    },
    [],
  );

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  const ExcalidrawPlusCommand = {
    label: "Excalidraw+",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: ["plus", "cloud", "server"],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_LP
        }/plus?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };
  const ExcalidrawPlusAppCommand = {
    label: "Sign up",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: [
      "excalidraw",
      "plus",
      "cloud",
      "server",
      "signin",
      "login",
      "signup",
    ],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_APP
        }?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };

  return (
    <div
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <div className="excalidraw-app-tabs">
        <div className="excalidraw-app-tabs__list">
          {documents.map((document) => (
            <button
              key={document.id}
              type="button"
              className={clsx("excalidraw-app-tabs__tab", {
                "is-active": document.id === activeDocumentId,
              })}
              onClick={() => switchToDocument(document.id)}
            >
              <span className="excalidraw-app-tabs__title">
                {document.title}
              </span>
              {document.dirty && (
                <span className="excalidraw-app-tabs__dirty" />
              )}
              {documents.length > 1 && (
                <span
                  role="button"
                  tabIndex={0}
                  className="excalidraw-app-tabs__close"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeDocument(document.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      closeDocument(document.id);
                    }
                  }}
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            className="excalidraw-app-tabs__add"
            onClick={createBlankDocument}
          >
            +
          </button>
        </div>
      </div>
      <Excalidraw
        onChange={onChange}
        onExport={onExport}
        onSceneFileOpen={async (data, file) => {
          const nextDocuments = captureCurrentDocument();
          const nextDocument = createDocumentRecord({
            title:
              data.appState?.name ?? file.name.replace(/\.excalidraw$/i, ""),
            source: "drag-drop",
            snapshot: {
              elements: data.elements ?? [],
              appState: data.appState ?? { name: null },
              files: data.files ?? {},
            },
          });
          const updatedDocuments = [...nextDocuments, nextDocument];
          setDocuments(updatedDocuments);
          setActiveDocumentId(nextDocument.id);
          applyDocumentToEditor(nextDocument);
          persistWorkspace(updatedDocuments, nextDocument.id);
          return true;
        }}
        initialData={activeDocument?.snapshot ?? null}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            loadScene: false,
            export: {
              onExportToBackend,
              renderCustomUI: excalidrawAPI
                ? (elements, appState, files) => {
                    return (
                      <ExportToExcalidrawPlus
                        elements={elements}
                        appState={appState}
                        files={files}
                        name={excalidrawAPI.getName()}
                        onError={(error) => {
                          excalidrawAPI?.updateScene({
                            appState: {
                              errorMessage: error.message,
                            },
                          });
                        }}
                        onSuccess={() => {
                          excalidrawAPI.updateScene({
                            appState: { openDialog: null },
                          });
                        }}
                      />
                    );
                  }
                : undefined,
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        theme={editorTheme}
        renderTopRightUI={(isMobile) => {
          if (isMobile || !collabAPI || isCollabDisabled) {
            return null;
          }

          return (
            <div className="excalidraw-ui-top-right">
              {excalidrawAPI?.getEditorInterface().formFactor === "desktop" && (
                <ExcalidrawPlusPromoBanner
                  isSignedIn={isExcalidrawPlusSignedUser}
                />
              )}

              {collabError.message && <CollabError collabError={collabError} />}
              <LiveCollaborationTrigger
                isCollaborating={isCollaborating}
                onSelect={() =>
                  setShareDialogState({ isOpen: true, type: "share" })
                }
                editorInterface={editorInterface}
              />
            </div>
          );
        }}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            excalidrawAPI?.scrollToContent(element.link, { animate: true });
          }
        }}
      >
        <AppMainMenu
          onCollabDialogOpen={onCollabDialogOpen}
          onLoadScene={() => openSceneInNewTab()}
          isCollaborating={isCollaborating}
          isCollabEnabled={!isCollabDisabled}
          theme={appTheme}
          setTheme={(theme) => setAppTheme(theme)}
          refresh={() => forceRefresh((prev) => !prev)}
        />
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          onLoadScene={() => openSceneInNewTab()}
          isCollabEnabled={!isCollabDisabled}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
          {excalidrawAPI && (
            <OverwriteConfirmDialog.Action
              title={t("overwriteConfirm.action.excalidrawPlus.title")}
              actionLabel={t("overwriteConfirm.action.excalidrawPlus.button")}
              onClick={() => {
                exportToExcalidrawPlus(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                  excalidrawAPI.getName(),
                );
              }}
            >
              {t("overwriteConfirm.action.excalidrawPlus.description")}
            </OverwriteConfirmDialog.Action>
          )}
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => excalidrawAPI?.refresh()} />
        {excalidrawAPI && <AIComponents excalidrawAPI={excalidrawAPI} />}

        <TTDDialogTrigger />
        {isCollaborating && isOffline && (
          <div className="alertalert--warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {localStorageQuotaExceeded && (
          <div className="alert alert--danger">
            {t("alerts.localStorageQuotaExceeded")}
          </div>
        )}
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}

        <ShareDialog
          collabAPI={collabAPI}
          onExportToBackend={async () => {
            if (excalidrawAPI) {
              try {
                await onExportToBackend(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              } catch (error: any) {
                setErrorMessage(error.message);
              }
            }
          }}
        />

        <AppSidebar />

        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: t("labels.liveCollaboration"),
              category: DEFAULT_CATEGORIES.app,
              keywords: [
                "team",
                "multiplayer",
                "share",
                "public",
                "session",
                "invite",
              ],
              icon: usersIcon,
              perform: () => {
                setShareDialogState({
                  isOpen: true,
                  type: "collaborationOnly",
                });
              },
            },
            {
              label: t("roomDialog.button_stopSession"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!collabAPI?.isCollaborating(),
              keywords: [
                "stop",
                "session",
                "end",
                "leave",
                "close",
                "exit",
                "collaboration",
              ],
              perform: () => {
                if (collabAPI) {
                  collabAPI.stopCollaboration();
                  if (!collabAPI.isCollaborating()) {
                    setShareDialogState({ isOpen: false });
                  }
                }
              },
            },
            {
              label: t("labels.share"),
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              icon: share,
              keywords: [
                "link",
                "shareable",
                "readonly",
                "export",
                "publish",
                "snapshot",
                "url",
                "collaborate",
                "invite",
              ],
              perform: async () => {
                setShareDialogState({ isOpen: true, type: "share" });
              },
            },
            {
              label: "GitHub",
              icon: GithubIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: [
                "issues",
                "bugs",
                "requests",
                "report",
                "features",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://github.com/excalidraw/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.followUs"),
              icon: XBrandIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["twitter", "contact", "social", "community"],
              perform: () => {
                window.open(
                  "https://x.com/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.discordChat"),
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              icon: DiscordIcon,
              keywords: [
                "chat",
                "talk",
                "contact",
                "bugs",
                "requests",
                "report",
                "feedback",
                "suggestions",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://discord.gg/UexuTaE",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: "YouTube",
              icon: youtubeIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["features", "tutorials", "howto", "help", "community"],
              perform: () => {
                window.open(
                  "https://youtube.com/@excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            ...(isExcalidrawPlusSignedUser
              ? [
                  {
                    ...ExcalidrawPlusAppCommand,
                    label: "Sign in / Go to Excalidraw+",
                  },
                ]
              : [ExcalidrawPlusCommand, ExcalidrawPlusAppCommand]),

            {
              label: t("overwriteConfirm.action.excalidrawPlus.button"),
              category: DEFAULT_CATEGORIES.export,
              icon: exportToPlus,
              predicate: true,
              keywords: ["plus", "export", "save", "backup"],
              perform: () => {
                if (excalidrawAPI) {
                  exportToExcalidrawPlus(
                    excalidrawAPI.getSceneElements(),
                    excalidrawAPI.getAppState(),
                    excalidrawAPI.getFiles(),
                    excalidrawAPI.getName(),
                  );
                }
              },
            },
            {
              ...CommandPalette.defaultItems.toggleTheme,
              perform: () => {
                setAppTheme(
                  editorTheme === THEME.DARK ? THEME.LIGHT : THEME.DARK,
                );
              },
            },
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
          ]}
        />
        {isVisualDebuggerEnabled() && excalidrawAPI && (
          <DebugCanvas
            appState={excalidrawAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Excalidraw>
    </div>
  );
};

const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === "/excalidraw-plus-export";
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <ExcalidrawAPIProvider>
          <ExcalidrawWrapper />
        </ExcalidrawAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
