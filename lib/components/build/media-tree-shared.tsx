"use client";

export type FolderNode = {
  id: string;
  name: string;
  parentId: string | null;
  childFolderIds: string[];
  fileIds: string[];
};

export type MediaTreeFile = {
  id: string;
  name: string;
  path: string;
  file: File;
};

export const ROOT_ID = "root";

export function FolderIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11z" />
    </svg>
  );
}

export function FileIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M7 3h7l5 5v12.5A1.5 1.5 0 0 1 17.5 22h-10A1.5 1.5 0 0 1 6 20.5v-16A1.5 1.5 0 0 1 7.5 3z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

export function buildTreeFromMediaFiles(mediaFiles: MediaTreeFile[]) {
  const folders: Record<string, FolderNode> = {
    [ROOT_ID]: {
      id: ROOT_ID,
      name: "media",
      parentId: null,
      childFolderIds: [],
      fileIds: [],
    },
  };

  const fileMap: Record<string, MediaTreeFile> = {};

  function ensureFolder(pathParts: string[]) {
    if (!pathParts.length) return ROOT_ID;
    let parentId = ROOT_ID;
    let pathAcc = "";
    pathParts.forEach((part) => {
      pathAcc = pathAcc ? `${pathAcc}/${part}` : part;
      const folderId = `folder:${pathAcc}`;
      if (!folders[folderId]) {
        folders[folderId] = {
          id: folderId,
          name: part,
          parentId,
          childFolderIds: [],
          fileIds: [],
        };
        folders[parentId].childFolderIds.push(folderId);
      }
      parentId = folderId;
    });
    return parentId;
  }

  mediaFiles.forEach((file) => {
    fileMap[file.id] = file;
    const parts = file.path.split("/").filter(Boolean);
    const folderParts = parts.slice(0, -1);
    const parentId = ensureFolder(folderParts);
    folders[parentId].fileIds.push(file.id);
  });

  return { folders, fileMap };
}
