import { isDesktopApp } from "./platform";

export type DesktopOpenedFilePayload = {
  path: string;
  name: string;
  contents: number[];
};

const createAbortError = () => {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The user aborted a request.", "AbortError");
  }

  const error = new Error("The user aborted a request.");
  error.name = "AbortError";
  return error;
};

const mapExtensions = (extensions?: string[]) =>
  extensions?.map((extension) => extension.replace(/^\./, "")) ?? [];

const getDialogFilters = (opts: {
  description: string;
  extensions?: string[];
}) => {
  if (!opts.extensions?.length) {
    return undefined;
  }

  return [
    {
      name: opts.description,
      extensions: mapExtensions(opts.extensions),
    },
  ];
};

const createDesktopFileHandle = (
  path: string,
  name: string,
): ExcalidrawDesktopFileHandle => ({
  __EXCALIDRAW_DESKTOP_FILE_HANDLE__: true,
  kind: "file",
  name,
  path,
});

const isDesktopFileHandle = (
  handle: ExcalidrawFileHandle | null | undefined,
): handle is ExcalidrawDesktopFileHandle =>
  !!handle && "__EXCALIDRAW_DESKTOP_FILE_HANDLE__" in handle;

export const desktopFileFromPayload = (payload: DesktopOpenedFilePayload) => {
  const file = new File([new Uint8Array(payload.contents)], payload.name);
  file.handle = createDesktopFileHandle(payload.path, payload.name);
  return file;
};

export const openExternalLink = async (url: string) => {
  if (isDesktopApp()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
};

const showOpenFileDialog = async (opts: {
  description: string;
  extensions?: string[];
  multiple?: boolean;
}) => {
  if (!isDesktopApp()) {
    return null;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const filters = getDialogFilters(opts);

  return open({
    multiple: opts.multiple ?? false,
    directory: false,
    ...(filters ? { filters } : {}),
  });
};

const showSaveFileDialog = async (opts: {
  description: string;
  name: string;
  extensions?: string[];
}) => {
  if (!isDesktopApp()) {
    return null;
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const filters = getDialogFilters(opts);

  return save({
    defaultPath: opts.name,
    ...(filters ? { filters } : {}),
  });
};

const readDesktopFile = async (path: string) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DesktopOpenedFilePayload>("read_desktop_file", { path });
};

const writeDesktopFile = async (path: string, contents: Uint8Array) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<{ path: string; name: string }>("write_desktop_file", {
    path,
    contents: Array.from(contents),
  });
};

export const installDesktopBridge = () => {
  if (!isDesktopApp() || window.__EXCALIDRAW_DESKTOP__) {
    return;
  }

  window.__EXCALIDRAW_DESKTOP__ = {
    openExternal: openExternalLink,
    openFile: async (opts) => {
      const selection = await showOpenFileDialog(opts);

      if (!selection || (Array.isArray(selection) && selection.length === 0)) {
        throw createAbortError();
      }

      const paths = Array.isArray(selection) ? selection : [selection];
      const files = await Promise.all(
        paths.map(async (path) => desktopFileFromPayload(await readDesktopFile(path))),
      );

      return opts.multiple ? files : files[0];
    },
    saveFile: async (blob, opts) => {
      const resolvedBlob = await blob;
      let path = isDesktopFileHandle(opts.fileHandle)
        ? opts.fileHandle.path
        : null;

      if (!path) {
        path = await showSaveFileDialog({
          description: opts.description,
          name: opts.name,
          extensions: [opts.extension],
        });
      }

      if (!path) {
        throw createAbortError();
      }

      const contents = new Uint8Array(await resolvedBlob.arrayBuffer());
      const savedFile = await writeDesktopFile(path, contents);
      return createDesktopFileHandle(savedFile.path, savedFile.name);
    },
  };
};

export const getPendingDesktopFiles = async () => {
  if (!isDesktopApp()) {
    return [];
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DesktopOpenedFilePayload[]>("pending_desktop_files");
};

export const onDesktopFileOpened = async (
  handler: (payload: DesktopOpenedFilePayload) => void | Promise<void>,
) => {
  if (!isDesktopApp()) {
    return () => {};
  }

  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<DesktopOpenedFilePayload>(
    "desktop-file-opened",
    async (event) => {
      await handler(event.payload);
    },
  );

  return () => {
    unlisten();
  };
};

installDesktopBridge();
