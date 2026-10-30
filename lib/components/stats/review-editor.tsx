"use client";
import Link from "next/link";
import { useState } from "react";
import type { AdminGameView } from "@/server/stats/admin-queries";
import type { StatsReview } from "@/types/stats";
import type { CreateStatsPerson } from "@/server/stats/people";
import type { ReviewPatch } from "@/server/stats/reviews";
import { projectGame } from "@/server/stats/projection";
import { inferQuestionMaximum } from "@/server/stats/metrics";
import { hostSummary, playerSummary, replaceHostAggregate, replacePlayerAggregate } from "@/server/stats/aggregates";
import { readJsonResponse } from "@/lib/api-response";
import { stableJson, statsNumber, statsPercent } from "@/lib/stats/value";
import PersonPicker, { type PersonChoice } from "./person-picker";
import StatsStages from "./stages";

type PickerTarget = { kind: "host" } | { kind: "appearance"; id: string };

export default function ReviewEditor({ initial, publicEnabled }: { initial: AdminGameView; publicEnabled: boolean }) {
  const [view, setView] = useState(initial), [draft, setDraft] = useState<StatsReview | null>(initial.review);
  const [people, setPeople] = useState<PersonChoice[]>(initial.people), [creations, setCreations] = useState<CreateStatsPerson[]>([]);
  const [picker, setPicker] = useState<PickerTarget | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState(false), [acknowledged, setAcknowledged] = useState(false), [message, setMessage] = useState<string | null>(null);
  const dirty = draft !== null && view.review !== null && stableJson(draft) !== stableJson(view.review);
  let before: ReturnType<typeof projectGame> | null = null, after: ReturnType<typeof projectGame> | null = null, invalid: string | null = null;
  if (view.snapshot && view.review && draft) try { before = projectGame(view.snapshot, view.review, view.version); after = projectGame(view.snapshot, draft, view.version + 1); }
  catch (error) { invalid = error instanceof Error ? error.message : "Invalid review changes."; }
  const name = (id: string | null) => id ? people.find((person) => person.id === id)?.displayName ?? "Name unavailable" : "Unresolved";
  async function reload() {
    const next = await readJsonResponse<AdminGameView>(await fetch(`/api/stats/admin/games/${encodeURIComponent(view.id)}`, { cache: "no-store" }), "Reload review");
    setView(next); setDraft(next.review); setPeople(next.people); setCreations([]); setConfirmation(false); setAcknowledged(false);
  }
  async function snapshot() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/stats/admin/games/${encodeURIComponent(view.id)}/snapshot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: view.version }) });
      if (response.status === 409) { await reload(); throw new Error("The review changed. The current saved results have been loaded."); }
      await readJsonResponse(response, "Save room snapshot"); await reload();
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save snapshot."); }
    finally { setBusy(false); }
  }
  function patch(): ReviewPatch {
    const current = view.review!, next = draft!, mappings: NonNullable<ReviewPatch["mappings"]> = {}, maxima: NonNullable<ReviewPatch["maxima"]> = [];
    for (const id of new Set([...Object.keys(current.mappings), ...Object.keys(next.mappings)])) if (stableJson(current.mappings[id] ?? null) !== stableJson(next.mappings[id] ?? null)) mappings[id] = next.mappings[id] ?? { personId: null, duplicateOf: null };
    for (const roundId of new Set([...Object.keys(current.maxima), ...Object.keys(next.maxima)])) for (const questionId of new Set([...Object.keys(current.maxima[roundId] ?? {}), ...Object.keys(next.maxima[roundId] ?? {})])) {
      const a = current.maxima[roundId]?.[questionId], b = next.maxima[roundId]?.[questionId]; if (a !== b) maxima.push({ roundId, questionId, points: b ?? null });
    }
    const linked = new Set([next.hostPersonId, ...Object.values(next.mappings).map((mapping) => mapping.personId)]);
    return { expectedVersion: view.version, mappings, maxima, hostPersonId: next.hostPersonId, completedAt: next.completedAt, packLabel: next.packLabel,
      createPeople: creations.filter((person) => linked.has(person.id)), confirmedImpact: view.published };
  }
  async function save() {
    if (!draft || invalid) return;
    if (view.published && !confirmation) { setConfirmation(true); return; }
    setBusy(true); setError(null); setMessage(null);
    try { await readJsonResponse(await fetch(`/api/stats/admin/games/${encodeURIComponent(view.id)}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch()) }), "Save review"); await reload(); setMessage("Review saved."); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to save review."); }
    finally { setBusy(false); }
  }
  async function publish() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/stats/admin/games/${encodeURIComponent(view.id)}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: view.version, approvedDigest: view.snapshot!.digest, acknowledgeIncompleteGrading: acknowledged }) });
      if (response.status === 409) { await reload(); throw new Error("Results or review changed. Review the current saved results before publishing."); }
      await readJsonResponse(response, "Publish game"); await reload(); setMessage("Game published.");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to publish game."); }
    finally { setBusy(false); }
  }
  function choose(person: PersonChoice, creation?: CreateStatsPerson) {
    setPeople((previous) => [...previous.filter((item) => item.id !== person.id), person]);
    if (creation) setCreations((previous) => [...previous.filter((item) => item.id !== creation.id), creation]);
    setDraft((previous) => previous && picker ? picker.kind === "host" ? { ...previous, hostPersonId: person.id }
      : { ...previous, mappings: { ...previous.mappings, [picker.id]: { personId: person.id, duplicateOf: null } } } : previous);
    setConfirmation(false); setPicker(null);
  }
  function unresolved() {
    setDraft((previous) => {
      if (!previous || !picker) return previous;
      if (picker.kind === "host") return { ...previous, hostPersonId: null };
      const mappings = { ...previous.mappings }; delete mappings[picker.id]; return { ...previous, mappings };
    }); setConfirmation(false); setPicker(null);
  }
  const snapshotData = view.snapshot;
  const assets = snapshotData ? Object.fromEntries(Object.entries(snapshotData.assets).map(([id, data]) => [id, { filename: data.storagePath.split("/").at(-1)! }])) : {};
  const assetUrl = (id: string) => `/api/stats/admin/games/${encodeURIComponent(view.id)}/assets/${id}`;
  const affected = new Set([...(before?.players.keys() ?? []), ...(after?.players.keys() ?? []), before?.host?.personId, after?.host?.personId].filter((id): id is string => typeof id === "string"));
  return <section className="space-y-6"><header className="space-y-3"><Link className="text-sm text-emerald-700 underline" href="/stats/admin">Game review queue</Link><h1 className="text-3xl font-semibold">{view.title || view.id}</h1><p>{view.published ? "Published scores are frozen. You can correct identity mappings, maxima, or verified metadata." : "Save a snapshot of this ended room, review its recorded results, then publish explicitly."}</p></header>
    {error && <p className="rounded-lg border border-red-500 p-3 text-red-700" role="alert">{error}</p>}{message && <p role="status" className="text-emerald-700">{message}</p>}{initial.version > view.version && <p role="alert" className="text-amber-700">A newer review is available. Reload before saving your changes.</p>}
    <div className="flex flex-wrap gap-4">{!view.published && <button className="rounded-lg border px-4 py-2 font-semibold disabled:opacity-50" disabled={busy || dirty} onClick={() => void snapshot()}>{snapshotData ? "Refresh saved room results" : "Create snapshot"}</button>}<button className="text-sm underline" disabled={busy} onClick={() => void reload().catch((error) => setError(error.message))}>Reload review</button>{view.published && publicEnabled && <Link className="text-emerald-700 underline" href={`/stats/games/${view.id}`}>View published game</Link>}</div>
    {snapshotData && draft && <>
      <p className="text-xs text-zinc-500">Saved at {snapshotData.snapshotAt}. Result reference: {snapshotData.digest.slice(0, 12)}. Snapshot/publication times do not substitute for an unknown completion date.</p>
      <fieldset className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2" disabled={busy}><legend className="px-2 font-semibold">Verified game metadata</legend><label className="flex flex-col gap-1">Completion date (UTC)<input type="date" className="rounded-lg border bg-transparent p-2" value={draft.completedAt?.slice(0, 10) ?? ""} onChange={(event) => { setDraft({ ...draft, completedAt: event.target.value ? `${event.target.value}T00:00:00.000Z` : null }); setConfirmation(false); }} /></label><label className="flex flex-col gap-1">Pack label<input className="rounded-lg border bg-transparent p-2" maxLength={200} value={draft.packLabel ?? ""} onChange={(event) => { setDraft({ ...draft, packLabel: event.target.value || null }); setConfirmation(false); }} /></label><p className="text-xs text-zinc-500 sm:col-span-2">Leave unknown metadata empty. A pack label is display metadata, not a unique pack identifier.</p></fieldset>
      <section className="space-y-3 rounded-xl border p-5"><h2 className="text-xl font-semibold">Host identity</h2><p>Recorded host: {snapshotData.host?.alias || "Unavailable"}</p><p>Linked person: {name(draft.hostPersonId)}</p>{snapshotData.host && <button className="text-emerald-700 underline" disabled={busy} onClick={() => setPicker({ kind: "host" })}>Link host</button>}</section>
      <section className="space-y-3"><h2 className="text-xl font-semibold">Player identities</h2><p className="text-sm text-zinc-500">Link only identities you can verify. Same-person duplicates on one team must select a canonical entry; conflicting cross-team appearances cannot count twice.</p><div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><thead><tr>{["Recorded alias", "Team", "Linked person", "Duplicate resolution", "Action"].map((label) => <th scope="col" className="p-3 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{snapshotData.appearances.map((appearance) => {
        const mapping = draft.mappings[appearance.id]; const candidates = snapshotData.appearances.filter((other) => other.id !== appearance.id && other.teamId === appearance.teamId && mapping?.personId && draft.mappings[other.id]?.personId === mapping.personId && !draft.mappings[other.id]?.duplicateOf);
        return <tr className="border-t align-top" key={appearance.id}><td className="p-3">{appearance.alias || "Unavailable"}</td><td className="p-3">{snapshotData.teams.find((team) => team.id === appearance.teamId)?.name ?? "Unassigned"}</td><td className="p-3">{name(mapping?.personId ?? null)}</td><td className="p-3">{mapping?.personId && <select aria-label={`Canonical appearance for ${appearance.alias || "member"}`} className="max-w-52 rounded border bg-transparent p-1" value={mapping.duplicateOf ?? ""} disabled={busy} onChange={(event) => { setDraft({ ...draft, mappings: { ...draft.mappings, [appearance.id]: { ...mapping, duplicateOf: event.target.value || null } } }); setConfirmation(false); }}><option value="">Canonical entry</option>{candidates.map((other) => <option key={other.id} value={other.id}>Duplicate of {other.alias || "member"}</option>)}</select>}</td><td className="p-3"><button className="text-emerald-700 underline" aria-label={`Link ${appearance.alias || "member"}`} disabled={busy} onClick={() => setPicker({ kind: "appearance", id: appearance.id })}>Link person</button></td></tr>;
      })}</tbody></table></div><p className="text-xs text-zinc-500">The saved roster reflects membership at the snapshot. Earlier participation cannot be reconstructed. Unassigned members receive no player result credit.</p></section>
      <section className="space-y-4"><h2 className="text-xl font-semibold">Recorded scores and question maxima</h2><div className="flex flex-wrap gap-4">{snapshotData.teams.map((team) => <p className="rounded-lg border p-3" key={team.id}>{team.name ?? "Team"}: <strong>{statsNumber(team.score)}</strong> recorded final points</p>)}</div><p className="text-sm text-zinc-500">Maximum edits change statistical denominators. Awarded points and game results remain recorded as saved.</p>
        {snapshotData.rounds.map((round) => <details className="rounded-xl border p-4" key={round.id}><summary className="cursor-pointer font-semibold">{round.title || "Round"} ({round.scoring.type})</summary><div className="mt-4 space-y-5">{round.questions.map((question) => {
          const maximum = inferQuestionMaximum(round.scoring, draft.maxima[round.id]?.[question.id]);
          return <section className="grid gap-4 border-t pt-4 sm:grid-cols-[1fr,14rem]" key={question.id}><div className="space-y-2"><h3 className="font-semibold">Question {question.order + 1}</h3><StatsStages stages={question.prompt} assets={assets} assetUrl={assetUrl} label="Question media" />{question.answerHint && <p className="text-sm">Accepted answer: {question.answerHint}</p>}<StatsStages stages={question.acceptedAnswer} assets={assets} assetUrl={assetUrl} label="Accepted answer media" /></div><div className="space-y-2"><label className="flex flex-col gap-1">Maximum for {round.title || round.id}, question {question.order + 1}<input aria-label={`Maximum for ${round.title || "round"}, question ${question.order + 1}`} className="rounded-lg border bg-transparent p-2" type="number" min={0} step="any" value={maximum.points} disabled={busy} onChange={(event) => { const points = Number(event.target.value); if (!Number.isFinite(points) || points < 0) return; setDraft({ ...draft, maxima: { ...draft.maxima, [round.id]: { ...draft.maxima[round.id], [question.id]: points } } }); setConfirmation(false); }} /></label><p className="text-xs text-zinc-500">{maximum.provenance === "default-unverified" ? "Unverified fallback" : maximum.provenance === "configured" ? "From scoring rules" : "Admin verified"}</p>{maximum.provenance === "default-unverified" && <button className="text-xs underline" disabled={busy} onClick={() => setDraft({ ...draft, maxima: { ...draft.maxima, [round.id]: { ...draft.maxima[round.id], [question.id]: maximum.points } } })}>Confirm fallback maximum</button>}{maximum.provenance === "admin" && <button className="block text-xs underline" disabled={busy} onClick={() => { const maxima = structuredClone(draft.maxima); delete maxima[round.id][question.id]; if (!Object.keys(maxima[round.id]).length) delete maxima[round.id]; setDraft({ ...draft, maxima }); setConfirmation(false); }}>Use scoring rule</button>}</div></section>;
        })}{!round.questions.length && <p>Question details unavailable.</p>}</div></details>)}
      </section>
      {invalid && <p role="alert" className="text-red-600">{invalid}</p>}
      <button className="rounded-lg bg-emerald-600 px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy || !dirty || Boolean(invalid)} onClick={() => void save()}>{busy ? "Saving…" : view.published ? "Review correction" : "Save review"}</button>
      {confirmation && before && after && <section className="space-y-4 rounded-xl border border-amber-500 p-5" aria-label="Confirm correction"><h2 className="text-xl font-semibold">Confirm correction</h2><p>These profiles will use the corrected mappings or maxima. Recorded scores and winners stay frozen.</p><ul className="space-y-4">{[...affected].map((id) => { const person = people.find((person) => person.id === id)!; if (!person) return null;
        const currentPlayer = playerSummary(person.player.counters), nextPlayer = playerSummary(replacePlayerAggregate(person.player, before!.players.get(id) ?? null, after!.players.get(id) ?? null).counters);
        const currentHost = hostSummary(person.host.counters), nextHost = hostSummary(replaceHostAggregate(person.host, before!.host?.personId === id ? before!.host : null, after!.host?.personId === id ? after!.host : null).counters);
        return <li className="rounded-lg border p-3" key={id}><strong>{person.displayName}</strong>{(before!.players.has(id) || after!.players.has(id)) && <p className="mt-1 text-sm">Games played: {currentPlayer.gamesPlayed} → {nextPlayer.gamesPlayed}; team points: {statsNumber(currentPlayer.teamPoints)} → {statsNumber(nextPlayer.teamPoints)}; point percentage: {statsPercent(currentPlayer.pointPercentage)} → {statsPercent(nextPlayer.pointPercentage)}.</p>}{(before!.host?.personId === id || after!.host?.personId === id) && <p className="mt-1 text-sm">Games hosted: {currentHost.gamesHosted} → {nextHost.gamesHosted}; points teams earned: {statsPercent(currentHost.difficulty)} → {statsPercent(nextHost.difficulty)}.</p>}</li>;
      })}</ul><div className="flex gap-4"><button className="rounded-lg bg-emerald-600 px-4 py-2 text-white" disabled={busy} onClick={() => void save()}>Confirm and save correction</button><button className="underline" disabled={busy} onClick={() => setConfirmation(false)}>Cancel</button></div></section>}
      {before?.metrics.warnings.length ? <details className="rounded-xl border p-4" open><summary className="cursor-pointer font-semibold">Recorded warnings</summary><ul className="mt-3 list-inside list-disc text-sm">{before.metrics.warnings.map((warning, index) => <li key={index}>{warning.code.replaceAll("-", " ")}{warning.roundId && `: ${snapshotData.rounds.find((round) => round.id === warning.roundId)?.title ?? "Round"}`}{warning.teamId && `, ${snapshotData.teams.find((team) => team.id === warning.teamId)?.name ?? "Team"}`}{warning.difference !== undefined && ` (difference ${statsNumber(warning.difference)})`}</li>)}</ul></details> : null}
      {!view.published && <section className="space-y-4 rounded-xl border p-5"><h2 className="text-xl font-semibold">Publish saved results</h2><p>Only an ended room can be published. Unresolved identities may remain; mapped players and hosts still receive their own history.</p>{before?.summary.provisional && <label className="flex items-start gap-3"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I acknowledge incomplete grading. These scores and the warning will stay frozen even if grading changes later.</span></label>}<button className="rounded-lg bg-emerald-600 px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy || dirty || Boolean(invalid) || (Boolean(before?.summary.provisional) && !acknowledged)} onClick={() => void publish()}>Publish game</button>{dirty && <p className="text-sm text-amber-700">Save review changes before publishing or refreshing room results.</p>}</section>}
    </>}
    {picker && draft && snapshotData && <PersonPicker key={picker.kind === "host" ? "host" : picker.id} alias={picker.kind === "host" ? snapshotData.host?.alias ?? null : snapshotData.appearances.find((appearance) => appearance.id === picker.id)?.alias ?? null} localChoices={people} onChoose={choose} onUnresolved={unresolved} onClose={() => setPicker(null)} />}
  </section>;
}
