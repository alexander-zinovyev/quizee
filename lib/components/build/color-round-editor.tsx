"use client";

import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Plus, X } from "lucide-react";
import type { ColorScoring } from "@/types/color";
import { HEX_COLOR } from "@/types/color";
import type { MediaTreeFile } from "./media-tree-shared";
import MediaSelector from "./media-selector";
import { ColorImage } from "../color-image";
import { loadColorArtwork, type ColorArtwork } from "@/lib/media/color-artwork";
import { parseColorSvg } from "@/lib/media/color-svg";
import { validateColorFiles } from "@/lib/build/color-assets";

export type BuildColorQuestion = { id: string; image: string | null; mask?: string | null; regionIds?: string[]; initialColor: string; targetColor: string };
export function createColorQuestion(): BuildColorQuestion {
  return { id: crypto.randomUUID(), image: null, mask: null, initialColor: "#83C547", targetColor: "#4285F4" };
}

function ColorQuestionEditor({ question, mediaFiles, onChange }: {
  question: BuildColorQuestion; mediaFiles: MediaTreeFile[]; onChange: (question: BuildColorQuestion) => void;
}) {
  const image = mediaFiles.find((file) => file.path === question.image)?.file;
  const mask = mediaFiles.find((file) => file.path === question.mask)?.file;
  const svg = question.image?.endsWith(".svg") ?? false;
  const [state, setState] = useState<{ imageFile: File; maskFile?: File; artwork?: ColorArtwork; error?: string } | null>(null);
  const [preview, setPreview] = useState<"initialColor" | "targetColor">("initialColor");
  const current = state?.imageFile === image && state?.maskFile === (svg ? undefined : mask) ? state : null;
  const artwork = current?.artwork?.kind === "svg" ? { ...current.artwork, regionIds: question.regionIds ?? [] } : current?.artwork;
  useEffect(() => {
    if (!image || (!svg && !mask)) return;
    let cancelled = false;
    const urls: string[] = [];
    const load = async () => {
      if (svg) return parseColorSvg(await image.text());
      await validateColorFiles(image, mask!);
      urls.push(URL.createObjectURL(image), URL.createObjectURL(mask!));
      return loadColorArtwork(urls[0], urls[1]);
    };
    void load().then((artwork) => {
      if (!cancelled) setState({ imageFile: image, maskFile: svg ? undefined : mask, artwork });
    }).catch((error: Error) => { if (!cancelled) setState({ imageFile: image, maskFile: svg ? undefined : mask, error: error.message }); });
    return () => { cancelled = true; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [image, mask, svg]);
  const regionError = artwork?.kind === "svg" && (!(question.regionIds?.length) || question.regionIds.some((id) => !artwork.eligibleRegionIds.includes(id))) ? "Select at least one valid SVG region." : null;
  const validationError = current?.error ?? regionError;
  const inputClass = "min-w-0 rounded border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700";
  return <div className="grid min-w-0 gap-4 md:grid-cols-2">
    <div className="space-y-3">
      <div><p className="mb-1 text-sm font-semibold">Image</p><MediaSelector mediaFiles={mediaFiles.filter((file) => /\.(png|jpe?g|webp|svg)$/i.test(file.path))} value={question.image} onChange={(image) => { if (image !== question.image) onChange({ ...question, image, mask: image?.endsWith(".svg") ? undefined : null, regionIds: image?.endsWith(".svg") ? [] : undefined }); }} /></div>
      {svg ? <fieldset className="space-y-2"><legend className="mb-1 text-sm font-semibold">Regions</legend>
        {artwork?.kind === "svg" ? <>
          {(question.regionIds ?? []).map((id, index) => <div key={index} className="flex min-w-0 items-center gap-2">
            <select aria-label={`SVG region ${index + 1}`} className={`${inputClass} flex-1 text-sm`} value={id} onChange={(event) => onChange({ ...question, regionIds: question.regionIds!.map((region, row) => row === index ? event.target.value : region) })}>
              {!artwork.eligibleRegionIds.includes(id) ? <option value={id}>{id}</option> : null}
              {artwork.eligibleRegionIds.filter((region) => region === id || !question.regionIds?.includes(region)).map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
            <button type="button" title={`Remove region ${index + 1}`} aria-label={`Remove region ${index + 1}`} onClick={() => onChange({ ...question, regionIds: question.regionIds!.filter((_region, row) => row !== index) })} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-red-500"><X size={16} /></button>
          </div>)}
          <button type="button" disabled={artwork.eligibleRegionIds.every((id) => question.regionIds?.includes(id))} className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-emerald-600 disabled:opacity-40" onClick={() => {
            const next = artwork.eligibleRegionIds.find((id) => !question.regionIds?.includes(id));
            if (next) onChange({ ...question, regionIds: [...(question.regionIds ?? []), next] });
          }}><Plus size={16} />Add region</button>
        </> : null}
      </fieldset> : <div><p className="mb-1 text-sm font-semibold">Mask</p><MediaSelector mediaFiles={mediaFiles.filter((file) => /\.(png|jpe?g|webp)$/i.test(file.path))} value={question.mask ?? null} onChange={(mask) => onChange({ ...question, mask })} /></div>}
      {(["initialColor", "targetColor"] as const).map((field) => <label key={field} className="block text-sm">
        <span className="mb-1 block">{field === "initialColor" ? "Initial color" : "Target color"}</span>
        <span className="flex items-center gap-2"><span className="h-8 w-8 shrink-0 rounded border border-zinc-400" aria-label={HEX_COLOR.test(question[field]) ? question[field] : "Invalid color"} style={{ backgroundColor: HEX_COLOR.test(question[field]) ? question[field] : "transparent" }} />
          <input aria-label={field === "initialColor" ? "Initial HEX color" : "Target HEX color"} className={inputClass} value={question[field]} maxLength={7} onChange={(event) => onChange({ ...question, [field]: event.target.value.toUpperCase() })} aria-invalid={!HEX_COLOR.test(question[field])} />
        </span>{!HEX_COLOR.test(question[field]) ? <span className="text-red-500">Enter a six-digit HEX color.</span> : null}
      </label>)}
      {validationError ? <p role="alert" className="text-sm text-red-500">{validationError}</p> : null}
    </div>
    <div className="min-w-0">
      <div className="mb-3 flex gap-1" role="group" aria-label="Preview color">{(["initialColor", "targetColor"] as const).map((field) => <button key={field} type="button" aria-pressed={preview === field} onClick={() => setPreview(field)} className={`rounded px-3 py-1 text-sm ${preview === field ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-800"}`}>{field === "initialColor" ? "Initial" : "Target"}</button>)}</div>
      {artwork && !current?.error && HEX_COLOR.test(question[preview]) ? <ColorImage artwork={artwork} color={question[preview]} label="Question preview" /> : null}
    </div>
  </div>;
}

export function ColorRoundEditor({ questions, scoring, mediaFiles, onQuestionsChange, onScoringChange }: {
  questions: BuildColorQuestion[]; scoring: ColorScoring; mediaFiles: MediaTreeFile[];
  onQuestionsChange: (questions: BuildColorQuestion[]) => void; onScoringChange: (scoring: ColorScoring) => void;
}) {
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-4">
      <label className="text-sm">Scoring mode<select aria-label="Scoring mode" className="ml-2 rounded border border-zinc-400 bg-transparent p-2" value={scoring.mode} onChange={(event) => onScoringChange(event.target.value === "threshold" ? { mode: "threshold", points: scoring.points, threshold: 8.5 } : { mode: "closest", points: scoring.points, tieTolerance: 0.05 })}><option value="threshold">Threshold</option><option value="closest">Closest team</option></select></label>
      <label className="text-sm">Points<input aria-label="Color points" type="number" min={0.01} step="any" className="ml-2 w-20 rounded border border-zinc-400 bg-transparent p-2" value={scoring.points} onChange={(event) => onScoringChange({ ...scoring, points: event.target.valueAsNumber })} /></label>
      <label className="text-sm">{scoring.mode === "threshold" ? "Threshold" : "Tie tolerance"}<input aria-label={scoring.mode === "threshold" ? "Threshold" : "Tie tolerance"} type="number" min={0} max={10} step={0.01} className="ml-2 w-20 rounded border border-zinc-400 bg-transparent p-2" value={scoring.mode === "threshold" ? scoring.threshold : scoring.tieTolerance} onChange={(event) => onScoringChange(scoring.mode === "threshold" ? { ...scoring, threshold: event.target.valueAsNumber } : { ...scoring, tieTolerance: event.target.valueAsNumber })} /></label>
    </div>
    {questions.map((question, index) => <section key={question.id} className="space-y-3 border-t border-zinc-300 py-4 dark:border-zinc-700">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Question {index + 1}</h3><div className="flex gap-2">
        <button type="button" title="Move question up" aria-label="Move question up" disabled={index === 0} onClick={() => { const next = [...questions]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onQuestionsChange(next); }} className="px-2 disabled:opacity-30"><ArrowUp size={16} /></button>
        <button type="button" title="Move question down" aria-label="Move question down" disabled={index === questions.length - 1} onClick={() => { const next = [...questions]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; onQuestionsChange(next); }} className="px-2 disabled:opacity-30"><ArrowDown size={16} /></button>
        <button type="button" title="Remove question" aria-label="Remove question" onClick={() => onQuestionsChange(questions.filter((q) => q.id !== question.id))} className="px-2 text-red-500"><X size={16} /></button>
      </div></div>
      <ColorQuestionEditor question={question} mediaFiles={mediaFiles} onChange={(updated) => onQuestionsChange(questions.map((q) => q.id === updated.id ? updated : q))} />
    </section>)}
    <button type="button" className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => onQuestionsChange([...questions, createColorQuestion()])}>Add question</button>
  </div>;
}
