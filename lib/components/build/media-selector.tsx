"use client";

import { useMemo, useState } from "react";
import {
  ROOT_ID,
  type MediaTreeFile,
  FileIcon,
  FolderIcon,
  buildTreeFromMediaFiles,
} from "@/lib/components/build/media-tree-shared";

let lastSelectedMediaPath: string | null = null;

export default function MediaSelector({
  value,
  mediaFiles,
  onChange,
  placeholder = "No media file selected",
}: {
  value: string | null;
  mediaFiles: MediaTreeFile[];
  onChange: (next: string | null) => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [candidatePath, setCandidatePath] = useState<string | null>(value);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set([ROOT_ID]));

  const { folders, fileMap } = useMemo(() => buildTreeFromMediaFiles(mediaFiles), [mediaFiles]);

  function folderPathFromMediaPath(path: string | null): Set<string> {
    const expanded = new Set<string>([ROOT_ID]);
    if (!path) return expanded;
    const parts = path.split("/").filter(Boolean);
    const folderParts = parts.slice(0, -1);
    let acc = "";
    folderParts.forEach((part) => {
      acc = acc ? `${acc}/${part}` : part;
      const folderId = `folder:${acc}`;
      if (folders[folderId]) {
        expanded.add(folderId);
      }
    });
    return expanded;
  }

  function openModal() {
    if (candidatePath === null && value) {
      setCandidatePath(value);
    }
    setExpandedFolders(folderPathFromMediaPath(lastSelectedMediaPath));
    setIsOpen(true);
  }

  function closeModal() {
    setIsOpen(false);
  }

  function confirmSelection() {
    onChange(candidatePath);
    lastSelectedMediaPath = candidatePath;
    setIsOpen(false);
  }

  function toggleFolder(folderId: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function renderFolder(folderId: string, depth: number): React.ReactNode {
    const folder = folders[folderId];
    if (!folder) return null;
    const expanded = expandedFolders.has(folderId);

    return (
      <div key={folderId} className="space-y-1">
        <div
          className="flex items-center gap-2 rounded px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
        >
          <button
            type="button"
            onClick={() => toggleFolder(folderId)}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-xs text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
          <FolderIcon className="h-4 w-4 text-zinc-500" />
          <span className="truncate">{folder.name}</span>
        </div>
        {expanded ? (
          <div className="space-y-1">
            {folder.childFolderIds.map((childId) => renderFolder(childId, depth + 1))}
            {folder.fileIds.map((fileId) => {
              const file = fileMap[fileId];
              if (!file) return null;
              const selected = candidatePath === file.path;
              return (
                <button
                  key={fileId}
                  type="button"
                  onClick={() => setCandidatePath(file.path)}
                  className={[
                    "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm",
                    selected
                      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ paddingLeft: `${(depth + 1) * 14 + 20}px` }}
                  title={file.path}
                >
                  <FileIcon className="h-4 w-4 text-zinc-500" />
                  <span className="truncate">{file.path}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <span
          className={[
            "min-w-0 flex-1 truncate",
            value ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500",
          ]
            .filter(Boolean)
            .join(" ")}
          title={value ?? placeholder}
        >
          {value ?? placeholder}
        </span>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex h-7 w-7 items-center justify-center rounded bg-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
            title="Clear selected media"
            aria-label="Clear selected media"
          >
            ×
          </button>
        ) : null}
        <button
          type="button"
          onClick={openModal}
          className="inline-flex h-7 w-7 items-center justify-center rounded bg-zinc-900 text-zinc-100 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          title="Select media file"
          aria-label="Select media file"
        >
          <FolderIcon className="h-4 w-4" />
        </button>
      </div>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeModal}>
          <div
            className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                confirmSelection();
              }
            }}
          >
            <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Select media file</p>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-7 w-7 items-center justify-center rounded bg-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
              >
                ×
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {mediaFiles.length ? (
                <div className="space-y-1">{renderFolder(ROOT_ID, 0)}</div>
              ) : (
                <p className="px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No media files available.
                </p>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md bg-zinc-200 px-3 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSelection}
                className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-400"
              >
                Select
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
