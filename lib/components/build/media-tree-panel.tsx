"use client";

import { type DragEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ROOT_ID,
  type FolderNode,
  type MediaTreeFile,
  FileIcon,
  FolderIcon,
} from "@/lib/components/build/media-tree-shared";

export type MediaFileNode = {
  id: string;
  name: string;
  file: File;
  parentFolderId: string;
};

export type MediaTreePanelState = {
  folders: Record<string, FolderNode>;
  files: Record<string, MediaFileNode>;
  selectedFolderId: string;
  activeFileId: string | null;
  expandedFolderIds: string[];
  selectedFileIds: string[];
};

type EditingNode = {
  kind: "folder" | "file";
  id: string;
};

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function splitFileName(name: string) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return { base: name, ext: "" };
  }
  return {
    base: name.slice(0, dotIndex),
    ext: name.slice(dotIndex),
  };
}

export default function MediaTreePanel({
  onMediaFilesChange,
  initialState,
  onStateChange,
}: {
  onMediaFilesChange?: (files: MediaTreeFile[]) => void;
  initialState?: MediaTreePanelState;
  onStateChange?: (state: MediaTreePanelState) => void;
}) {
  const defaultFolders: Record<string, FolderNode> = {
    [ROOT_ID]: {
      id: ROOT_ID,
      name: "media",
      parentId: null,
      childFolderIds: [],
      fileIds: [],
    },
  };

  const initialFolders =
    initialState?.folders && initialState.folders[ROOT_ID]
      ? initialState.folders
      : defaultFolders;
  const initialSelectedFolderId =
    initialState?.selectedFolderId && initialFolders[initialState.selectedFolderId]
      ? initialState.selectedFolderId
      : ROOT_ID;
  const initialActiveFileId =
    initialState?.activeFileId && initialState.files?.[initialState.activeFileId]
      ? initialState.activeFileId
      : null;
  const initialExpandedFolderIds =
    initialState?.expandedFolderIds?.filter((folderId) => Boolean(initialFolders[folderId])) ?? [ROOT_ID];
  if (!initialExpandedFolderIds.includes(ROOT_ID)) {
    initialExpandedFolderIds.push(ROOT_ID);
  }
  const initialSelectedFileIds =
    initialState?.selectedFileIds?.filter((fileId) => Boolean(initialState.files?.[fileId])) ?? [];

  const [folders, setFolders] = useState<Record<string, FolderNode>>(initialFolders);
  const [files, setFiles] = useState<Record<string, MediaFileNode>>(initialState?.files ?? {});
  const [selectedFolderId, setSelectedFolderId] = useState(initialSelectedFolderId);
  const [activeFileId, setActiveFileId] = useState<string | null>(initialActiveFileId);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(initialExpandedFolderIds)
  );
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(
    () => new Set(initialSelectedFileIds)
  );
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<EditingNode | null>(null);
  const [editingName, setEditingName] = useState("");
  const dragFileIdsRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editingInputRef = useRef<HTMLInputElement>(null);

  const selectedFolder = folders[selectedFolderId] ?? folders[ROOT_ID];
  const fileCount = useMemo(() => Object.keys(files).length, [files]);

  const focusedFolderId = useMemo(() => {
    if (activeFileId) {
      const file = files[activeFileId];
      if (file) return file.parentFolderId;
    }
    return selectedFolderId;
  }, [activeFileId, files, selectedFolderId]);

  const selectedPathFolderIds = useMemo(() => {
    const ids: string[] = [];
    let cursor: string | null = focusedFolderId;
    while (cursor) {
      ids.push(cursor);
      cursor = folders[cursor]?.parentId ?? null;
    }
    return new Set(ids);
  }, [focusedFolderId, folders]);

  const mediaFiles = useMemo<MediaTreeFile[]>(() => {
    function getFolderPath(folderId: string) {
      const names: string[] = [];
      let cursor: string | null = folderId;
      while (cursor && cursor !== ROOT_ID) {
        const folder: FolderNode | undefined = folders[cursor];
        if (!folder) break;
        names.unshift(folder.name);
        cursor = folder.parentId;
      }
      return names;
    }

    return Object.values(files)
      .map((file) => {
        const folderParts = getFolderPath(file.parentFolderId);
        const fullPath = [...folderParts, file.name].join("/");
        return {
          id: file.id,
          name: file.name,
          path: fullPath,
          file: file.file,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [files, folders]);

  useEffect(() => {
    onMediaFilesChange?.(mediaFiles);
  }, [mediaFiles, onMediaFilesChange]);

  useEffect(() => {
    onStateChange?.({
      folders,
      files,
      selectedFolderId,
      activeFileId,
      expandedFolderIds: Array.from(expandedFolders),
      selectedFileIds: Array.from(selectedFileIds),
    });
  }, [activeFileId, expandedFolders, files, folders, onStateChange, selectedFolderId, selectedFileIds]);

  function beginRename(kind: EditingNode["kind"], id: string, currentName: string) {
    setEditingNode({ kind, id });
    if (kind === "file") {
      setEditingName(splitFileName(currentName).base);
    } else {
      setEditingName(currentName);
    }
    queueMicrotask(() => {
      editingInputRef.current?.focus();
      editingInputRef.current?.select();
    });
  }

  function commitRename() {
    if (!editingNode) return;
    const trimmed = editingName.trim();
    const nextName = trimmed.length ? trimmed : editingNode.kind === "folder" ? "New folder" : "file";

    if (editingNode.kind === "folder") {
      setFolders((prev) => {
        const folder = prev[editingNode.id];
        if (!folder) return prev;
        return {
          ...prev,
          [editingNode.id]: {
            ...folder,
            name: nextName,
          },
        };
      });
    } else {
      setFiles((prev) => {
        const file = prev[editingNode.id];
        if (!file) return prev;
        const extension = splitFileName(file.name).ext;
        return {
          ...prev,
          [editingNode.id]: {
            ...file,
            name: `${nextName}${extension}`,
          },
        };
      });
    }
    setEditingNode(null);
    setEditingName("");
  }

  function cancelRename() {
    setEditingNode(null);
    setEditingName("");
  }

  function addFilesToSelectedFolder(selected: FileList | null) {
    if (!selected || !selected.length || !selectedFolder) return;
    const incoming = Array.from(selected).map((file) => {
      const id = makeId();
      return {
        id,
        name: file.name,
        file,
        parentFolderId: selectedFolder.id,
      } satisfies MediaFileNode;
    });

    setFiles((prev) => {
      const next = { ...prev };
      incoming.forEach((entry) => {
        next[entry.id] = entry;
      });
      return next;
    });

    setFolders((prev) => {
      const next = { ...prev };
      const folder = next[selectedFolder.id];
      if (!folder) return prev;
      next[selectedFolder.id] = {
        ...folder,
        fileIds: [...folder.fileIds, ...incoming.map((entry) => entry.id)],
      };
      return next;
    });
  }

  function createFolder() {
    if (!selectedFolder) return;
    const id = makeId();
    const defaultName = "New folder";

    setFolders((prev) => {
      const next = { ...prev };
      next[id] = {
        id,
        name: defaultName,
        parentId: selectedFolder.id,
        childFolderIds: [],
        fileIds: [],
      };
      const parent = next[selectedFolder.id];
      if (!parent) return prev;
      next[selectedFolder.id] = {
        ...parent,
        childFolderIds: [...parent.childFolderIds, id],
      };
      return next;
    });

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.add(selectedFolder.id);
      next.add(id);
      return next;
    });
    setSelectedFolderId(id);
    setActiveFileId(null);
    setSelectedFileIds(new Set());
    beginRename("folder", id, defaultName);
  }

  function removeFile(fileId: string) {
    const file = files[fileId];
    if (!file) return;

    setFiles((prev) => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
    setFolders((prev) => {
      const next = { ...prev };
      const parent = next[file.parentFolderId];
      if (!parent) return prev;
      next[file.parentFolderId] = {
        ...parent,
        fileIds: parent.fileIds.filter((id) => id !== fileId),
      };
      return next;
    });
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });
    if (activeFileId === fileId) {
      setActiveFileId(null);
    }
  }

  function removeFolder(folderId: string) {
    if (folderId === ROOT_ID) return;
    const folder = folders[folderId];
    if (!folder) return;

    const folderIdsToDelete: string[] = [];
    const fileIdsToDelete = new Set<string>();

    const stack = [folderId];
    while (stack.length) {
      const currentId = stack.pop() as string;
      const current = folders[currentId];
      if (!current) continue;
      folderIdsToDelete.push(currentId);
      current.fileIds.forEach((id) => fileIdsToDelete.add(id));
      current.childFolderIds.forEach((id) => stack.push(id));
    }

    setFolders((prev) => {
      const next = { ...prev };
      const parentId = folder.parentId;
      if (parentId && next[parentId]) {
        next[parentId] = {
          ...next[parentId],
          childFolderIds: next[parentId].childFolderIds.filter((id) => id !== folderId),
        };
      }
      folderIdsToDelete.forEach((id) => {
        delete next[id];
      });
      return next;
    });

    setFiles((prev) => {
      const next = { ...prev };
      fileIdsToDelete.forEach((id) => {
        delete next[id];
      });
      return next;
    });

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      folderIdsToDelete.forEach((id) => next.delete(id));
      return next;
    });

    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      fileIdsToDelete.forEach((id) => next.delete(id));
      return next;
    });

    if (activeFileId && fileIdsToDelete.has(activeFileId)) {
      setActiveFileId(null);
    }
    if (selectedFolderId === folderId || folderIdsToDelete.includes(selectedFolderId)) {
      setSelectedFolderId(ROOT_ID);
    }
  }

  function moveFilesToFolder(fileIds: string[], targetFolderId: string) {
    if (!folders[targetFolderId]) return;
    const validFileIds = fileIds.filter((id) => Boolean(files[id]));
    if (!validFileIds.length) return;

    setFolders((prev) => {
      const next: Record<string, FolderNode> = {};
      Object.entries(prev).forEach(([id, folder]) => {
        const removed = folder.fileIds.filter((fileId) => !validFileIds.includes(fileId));
        next[id] = {
          ...folder,
          fileIds: removed,
        };
      });
      const target = next[targetFolderId];
      if (!target) return prev;
      const dedup = new Set(target.fileIds);
      validFileIds.forEach((id) => dedup.add(id));
      next[targetFolderId] = {
        ...target,
        fileIds: Array.from(dedup),
      };
      return next;
    });

    setFiles((prev) => {
      const next = { ...prev };
      validFileIds.forEach((fileId) => {
        const file = next[fileId];
        if (!file) return;
        next[fileId] = {
          ...file,
          parentFolderId: targetFolderId,
        };
      });
      return next;
    });
  }

  function toggleFolder(folderId: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function handleFolderClick(folderId: string) {
    setSelectedFolderId(folderId);
    setActiveFileId(null);
    setSelectedFileIds(new Set());
  }

  function handleFileClick(fileId: string, event: MouseEvent<HTMLButtonElement>) {
    const withToggle = event.metaKey || event.ctrlKey;
    if (withToggle) {
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        if (next.has(fileId)) next.delete(fileId);
        else next.add(fileId);
        return next;
      });
    } else {
      setSelectedFileIds(new Set([fileId]));
    }
    setActiveFileId(fileId);
    const parent = files[fileId]?.parentFolderId;
    if (parent) setSelectedFolderId(parent);
  }

  function handleFileDragStart(fileId: string, event: DragEvent<HTMLDivElement>) {
    const dragIds =
      selectedFileIds.has(fileId) && selectedFileIds.size > 1
        ? Array.from(selectedFileIds)
        : [fileId];
    dragFileIdsRef.current = dragIds;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-quizee-file-ids", dragIds.join(","));
  }

  function handleFolderDrop(folderId: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const fromTransfer = event.dataTransfer.getData("application/x-quizee-file-ids");
    const draggedIds =
      dragFileIdsRef.current.length > 0
        ? dragFileIdsRef.current
        : fromTransfer
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);
    dragFileIdsRef.current = [];
    setDragOverFolderId(null);
    if (!draggedIds.length) return;
    moveFilesToFolder(draggedIds, folderId);
  }

  function renderFolder(folderId: string, depth: number): React.ReactNode {
    const folder = folders[folderId];
    if (!folder) return null;

    const isExpanded = expandedFolders.has(folderId);
    const isSelected = selectedFolderId === folderId && !activeFileId;
    const isPath = selectedPathFolderIds.has(folderId);
    const indentStyle = { paddingLeft: `${depth * 14 + 8}px` };
    const isEditing = editingNode?.kind === "folder" && editingNode.id === folderId;

    return (
      <div key={folderId} className="space-y-1">
        <div
          className={[
            "flex items-center gap-2 rounded-md px-2 py-1 text-sm text-zinc-700 transition dark:text-zinc-200",
            isPath ? "bg-emerald-100/70 dark:bg-emerald-900/30" : "",
            isSelected ? "font-semibold text-emerald-800 dark:text-emerald-200" : "",
            dragOverFolderId === folderId ? "bg-emerald-200/80 dark:bg-emerald-800/40" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={indentStyle}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragOverFolderId(folderId);
          }}
          onDragLeave={() => setDragOverFolderId((prev) => (prev === folderId ? null : prev))}
          onDrop={(event) => handleFolderDrop(folderId, event)}
        >
          <button
            type="button"
            onClick={() => toggleFolder(folderId)}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-xs text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            title={isExpanded ? "Collapse folder" : "Expand folder"}
          >
            {isExpanded ? "▾" : "▸"}
          </button>

          <FolderIcon className="h-4 w-4 shrink-0 text-zinc-500" />

          {isEditing ? (
            <input
              ref={editingInputRef}
              type="text"
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename();
                if (event.key === "Escape") cancelRename();
              }}
              className="min-w-0 flex-1 rounded bg-white px-1.5 py-0.5 text-sm text-zinc-900 outline-none ring-1 ring-emerald-400 dark:bg-zinc-900 dark:text-zinc-100"
            />
          ) : (
            <button
              type="button"
              onClick={() => handleFolderClick(folderId)}
              onDoubleClick={() => beginRename("folder", folderId, folder.name)}
              className="min-w-0 flex-1 truncate text-left"
              title={folder.name}
            >
              {folder.name}
            </button>
          )}

          <button
            type="button"
            onClick={() => beginRename("folder", folderId, folder.name)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            title="Rename folder"
          >
            ✎
          </button>
          {folderId !== ROOT_ID ? (
            <button
              type="button"
              onClick={() => removeFolder(folderId)}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40"
              title="Remove folder"
            >
              ×
            </button>
          ) : null}
        </div>

        {isExpanded ? (
          <div className="space-y-1">
            {folder.childFolderIds.map((childId) => renderFolder(childId, depth + 1))}
            {folder.fileIds.map((fileId) => {
              const file = files[fileId];
              if (!file) return null;
              const isActiveFile = activeFileId === fileId;
              const selected = selectedFileIds.has(fileId);
              const isEditingFile = editingNode?.kind === "file" && editingNode.id === fileId;
              return (
                <div
                  key={fileId}
                  draggable
                  onDragStart={(event) => handleFileDragStart(fileId, event)}
                  onDragEnd={() => {
                    dragFileIdsRef.current = [];
                    setDragOverFolderId(null);
                  }}
                  className={[
                    "flex items-center gap-2 rounded-md px-2 py-1 text-sm text-zinc-700 dark:text-zinc-200",
                    selected ? "bg-blue-100/80 dark:bg-blue-900/30" : "",
                    isActiveFile ? "font-semibold text-blue-900 dark:text-blue-200" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ paddingLeft: `${(depth + 1) * 14 + 16}px` }}
                >
                  <FileIcon className="h-4 w-4 shrink-0 text-zinc-500" />
                  {isEditingFile ? (
                    <input
                      ref={editingInputRef}
                      type="text"
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename();
                        if (event.key === "Escape") cancelRename();
                      }}
                      className="min-w-0 flex-1 rounded bg-white px-1.5 py-0.5 text-sm text-zinc-900 outline-none ring-1 ring-emerald-400 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => handleFileClick(fileId, event)}
                      onDoubleClick={() => beginRename("file", fileId, file.name)}
                      className="min-w-0 flex-1 truncate text-left"
                      title={file.name}
                    >
                      {file.name}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => beginRename("file", fileId, file.name)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    title="Rename file"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFile(fileId)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40"
                    title="Remove file"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-500">
          Pack media
        </p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          {fileCount} file{fileCount === 1 ? "" : "s"} in pack
        </p>
      </header>

      <div className="space-y-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-400"
          >
            Add file(s)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              addFilesToSelectedFolder(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={createFolder}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Create folder
          </button>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Current folder: <span className="font-semibold">{selectedFolder?.name}</span>
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Multi-select files with <span className="font-semibold">Cmd/Ctrl + click</span>.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div
          className="space-y-1"
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragOverFolderId(ROOT_ID);
          }}
          onDrop={(event) => handleFolderDrop(ROOT_ID, event)}
        >
          {renderFolder(ROOT_ID, 0)}
        </div>
      </div>
    </section>
  );
}
