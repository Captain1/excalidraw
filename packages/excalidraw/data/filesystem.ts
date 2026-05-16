import {
  fileOpen as _fileOpen,
  fileSave as _fileSave,
  supported as browserNativeFileSystemSupported,
} from "browser-fs-access";

import { MIME_TYPES } from "@excalidraw/common";

import { normalizeFile } from "./blob";

const isDesktopBridgeAvailable = () => !!window.__EXCALIDRAW_DESKTOP__;

const isDesktopFileHandle = (
  handle: ExcalidrawFileHandle | null | undefined,
): handle is ExcalidrawDesktopFileHandle =>
  !!handle && "__EXCALIDRAW_DESKTOP_FILE_HANDLE__" in handle;

export const nativeFileSystemSupported =
  browserNativeFileSystemSupported || isDesktopBridgeAvailable();

type FILE_EXTENSION = Exclude<keyof typeof MIME_TYPES, "binary">;

export const fileOpen = async <M extends boolean | undefined = false>(opts: {
  extensions?: FILE_EXTENSION[];
  description: string;
  multiple?: M;
}): Promise<M extends false | undefined ? File : File[]> => {
  // an unsafe TS hack, alas not much we can do AFAIK
  type RetType = M extends false | undefined ? File : File[];

  const mimeTypes = opts.extensions?.reduce((mimeTypes, type) => {
    mimeTypes.push(MIME_TYPES[type]);

    return mimeTypes;
  }, [] as string[]);

  const extensions = opts.extensions?.reduce((acc, ext) => {
    if (ext === "jpg") {
      return acc.concat(".jpg", ".jpeg");
    }
    return acc.concat(`.${ext}`);
  }, [] as string[]);

  if (window.__EXCALIDRAW_DESKTOP__) {
    const files = await window.__EXCALIDRAW_DESKTOP__.openFile({
      description: opts.description,
      extensions,
      multiple: opts.multiple,
    });

    if (Array.isArray(files)) {
      return (await Promise.all(files.map((file) => normalizeFile(file)))) as RetType;
    }

    return (await normalizeFile(files)) as RetType;
  }

  const files = await _fileOpen({
    description: opts.description,
    extensions,
    mimeTypes,
    multiple: opts.multiple ?? false,
  });

  if (Array.isArray(files)) {
    return (await Promise.all(
      files.map((file) => normalizeFile(file)),
    )) as RetType;
  }
  return (await normalizeFile(files)) as RetType;
};

export const fileSave = async (
  blob: Blob | Promise<Blob>,
  opts: {
    /** supply without the extension */
    name: string;
    /** file extension */
    extension: FILE_EXTENSION;
    mimeTypes?: string[];
    description: string;
    /** existing FileSystemFileHandle */
    fileHandle?: ExcalidrawFileHandle | null;
  },
) => {
  if (window.__EXCALIDRAW_DESKTOP__) {
    const handle = await window.__EXCALIDRAW_DESKTOP__.saveFile(blob, {
      description: opts.description,
      name: `${opts.name}.${opts.extension}`,
      extension: opts.extension,
      mimeTypes: opts.mimeTypes,
      fileHandle: opts.fileHandle,
    });
    return handle;
  }

  return _fileSave(
    blob,
    {
      fileName: `${opts.name}.${opts.extension}`,
      description: opts.description,
      extensions: [`.${opts.extension}`],
      mimeTypes: opts.mimeTypes,
    },
    isDesktopFileHandle(opts.fileHandle) ? null : opts.fileHandle,
    false,
  );
};
