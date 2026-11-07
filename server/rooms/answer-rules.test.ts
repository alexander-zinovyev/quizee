import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeApp, deleteApp } from "firebase/app";
import { collection, connectFirestoreEmulator, doc, getDoc, getDocFromServer, getFirestore, onSnapshot, setDoc, terminate, updateDoc } from "firebase/firestore";
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { parseSortingEditSave, saveSortingEdit } from "./sorting-edits";
import { transitionPresentation } from "./presentation";
import { parseAnswerSave, saveTeamAnswer } from "./answer-input";
import { saveImageMatch } from "@/lib/image-match-store";
import { recordedAnswer } from "@/lib/answers";
import { applySortingEdit, parseSortingSnapshot, type SortingEdit } from "@/types/sorting";
import { gradeSortingRound } from "./sorting";

async function main() {
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  if (!address) throw new Error("Run test:rules through the Firestore emulator.");
  const [host, port] = address.split(":");
  const projectId = "demo-quizee-drafts";
  const response = await fetch(`http://${address}/emulator/v1/projects/${projectId}:securityRules`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: await readFile("firestore.rules", "utf8") }] } }),
  });
  assert.ok(response.ok, await response.text());
  const adminApp = initializeAdmin({ projectId }, "answer-rules-admin");
  const admin = getAdminFirestore(adminApp);
  const apps = ["a", "b", "outsider", "host"].map((uid) => {
    const app = initializeApp({ projectId, apiKey: "fake" }, uid);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: uid, user_id: uid } });
    return { app, db, uid };
  });
  const denied = (work: Promise<unknown>) => assert.rejects(work, (error: unknown) => (error as { code: string }).code === "permission-denied");
  try {
    for (const type of ["text", "multi-step"] as const) {
      const roomId = `rules-${type}`;
      const roomPath = `rooms/${roomId}`;
      const answerPath = `${roomPath}/teams/red/rounds/r1/answers/q1`;
      const firstStep = { round: "r1", question: "q1", promptPage: 0, answerPage: 0, withAnswer: false };
      await admin.doc(roomPath).set({ state: "playing", presenting: firstStep });
      for (const { uid } of apps) await admin.doc(`${roomPath}/members/${uid}`).set({
        role: uid === "host" ? "host" : "player", team: uid === "outsider" ? "blue" : "red",
      });
      await admin.doc(`${roomPath}/teams/red`).set({ name: "Red" });
      await admin.doc(`${roomPath}/rounds/r1`).set({ type, state: "active", pointsPerStep: [5, 3], allowAnswerChanges: true });
      await admin.doc(`${roomPath}/rounds/r1/questions/q1`).set({ finalizedStep: -1, stages: [{ text: "First" }, { text: "Second" }] });
      const [a, b, outsider, hostClient] = apps;
      const save = (uid: string, mutation: { answer: string } | { locked: boolean }, step = 0) =>
        saveTeamAnswer(admin, roomId, "r1", "q1", uid, {
          teamId: "red", mutation, expectedStep: type === "multi-step" ? step : undefined,
        });
      const observed: string[] = [];
      let ready!: () => void;
      const initialSnapshot = new Promise<void>((resolve) => { ready = resolve; });
      const unsubscribe = onSnapshot(collection(b.db, `${roomPath}/teams/red/rounds/r1/answers`), { includeMetadataChanges: true }, (snapshot) => {
        const answer = snapshot.docs.find((entry) => entry.id === "q1");
        if (answer) observed.push(answer.data().answer);
        if (!snapshot.metadata.fromCache) ready();
      });
      try {
        await initialSnapshot;
        await save("a", { answer: "Paris" });
        assert.equal((await admin.doc(answerPath).get()).data()?.answer, "Paris");
        assert.equal((await getDocFromServer(doc(b.db, answerPath))).data()?.answer, "Paris");
        assert.equal((await getDoc(doc(b.db, answerPath))).data()?.answer, "Paris");
        assert.ok(observed.includes("Paris"));
        await save("b", { answer: "London" });
        assert.equal((await getDoc(doc(a.db, answerPath))).data()?.answer, "London");
        await denied(getDoc(doc(outsider.db, answerPath)));
        await denied(setDoc(doc(a.db, answerPath), { answer: "Direct write" }, { merge: true }));
        await denied(setDoc(doc(a.db, answerPath), { eligiblePoints: 999, attempts: [] }, { merge: true }));
        assert.throws(() => parseAnswerSave({ teamId: "red", answer: "A", eligiblePoints: 999 }));
        await assert.rejects(save("outsider", { answer: "Foreign team" }));
        await save("a", { locked: true });
        await assert.rejects(save("b", { answer: "Locked edit" }), /Unlock/);
        await save("b", { locked: false });
        await save("a", { answer: "Paris" });
        await denied(updateDoc(doc(hostClient.db, roomPath), { presenting: { ...firstStep, promptPage: 1 } }));
        await denied(updateDoc(doc(hostClient.db, `${roomPath}/rounds/r1`), { state: "closed" }));
        if (type === "multi-step") {
          const secondStep = { ...firstStep, promptPage: 1 };
          await transitionPresentation(admin, roomId, "host", firstStep, secondStep);
          assert.deepEqual(recordedAnswer((await getDoc(doc(b.db, answerPath))).data()!, type), { answer: "Paris", step: 0 });
          await assert.rejects(save("a", { answer: "Late step zero" }), /Step/);
          await save("b", { answer: "London" }, 1);
          await transitionPresentation(admin, roomId, "host", secondStep, { ...secondStep, question: null }, { closeRound: "r1" });
          const graded = (await admin.doc(`${roomPath}/rounds/r1/teamAnswers/red/answers/q1`).get()).data()!;
          assert.deepEqual(recordedAnswer(graded, type), { answer: "London", step: 1 });
          assert.deepEqual(Object.keys(graded), ["attempts"]);
          assert.equal(graded.attempts.length, 2);
        } else {
          await transitionPresentation(admin, roomId, "host", firstStep, { ...firstStep, question: null }, { closeRound: "r1" });
          const graded = (await admin.doc(`${roomPath}/rounds/r1/teamAnswers/red/answers/q1`).get()).data()!;
          assert.deepEqual(graded, { answer: "Paris", user: "a" });
        }
        await assert.rejects(save("b", { answer: "After closure" }, 1), /Round/);
        const input = (await admin.doc(answerPath).get()).data()!;
        assert.deepEqual(Object.keys(input).sort(), type === "multi-step" ? ["answer", "attempts", "locked", "user"] : ["answer", "locked", "user"]);
      } finally {
        unsubscribe();
      }
    }
    {
      const roomId = "rules-image", path = `rooms/${roomId}`;
      const [a, b, outsider, hostClient] = apps;
      const foreground = { round: "foreground", question: "q1", promptPage: 0, answerPage: 0, withAnswer: false };
      await admin.doc(path).set({ state: "playing", presenting: foreground });
      for (const { uid } of apps) await admin.doc(`${path}/members/${uid}`).set({ role: uid === "host" ? "host" : "player", team: uid === "host" ? null : uid === "outsider" ? "blue" : "red" });
      await admin.doc(`${path}/teams/red`).set({ name: "Red" });
      await admin.doc(`${path}/rounds/foreground`).set({ type: "text", state: "active" });
      await admin.doc(`${path}/rounds/foreground/questions/q1`).set({ text: "Foreground question" });
      await admin.doc(`${path}/rounds/image`).set({ type: "image", state: "active" });
      for (const id of ["q1", "q2"]) await admin.doc(`${path}/rounds/image/questions/${id}`).set({ text: id });
      const answerPath = `${path}/teams/red/rounds/image/answers`;
      const save = (client: typeof a, questionId: string, imageId: string) => saveImageMatch({ db: client.db, roomSlug: roomId, teamId: "red", roundId: "image", questionIds: ["q1", "q2"], imageIds: ["i1", "i2"], uid: client.uid },
        { type: "assign", questionId, imageId });
      await save(a, "q1", "i1");
      assert.equal((await getDocFromServer(doc(b.db, `${answerPath}/q1`))).data()?.answer, "i1");
      await save(b, "q2", "i1");
      assert.equal((await getDocFromServer(doc(a.db, `${answerPath}/q1`))).data()?.answer, "");
      assert.equal((await getDocFromServer(doc(a.db, `${answerPath}/q2`))).data()?.answer, "i1");
      await denied(getDocFromServer(doc(outsider.db, `${answerPath}/q2`)));
      await denied(getDocFromServer(doc(hostClient.db, `${answerPath}/q2`)));
      await denied(updateDoc(doc(hostClient.db, `${path}/rounds/image`), { state: "closed" }));
      const [closing, saving] = await Promise.allSettled([
        transitionPresentation(admin, roomId, "host", foreground, foreground, { closeRound: "image" }),
        save(a, "q1", "i2"),
      ]);
      assert.equal(closing.status, "fulfilled");
      if (saving.status === "rejected") assert.match(String(saving.reason), /closed|permission|transaction/i);
      assert.deepEqual((await admin.doc(path).get()).data()?.presenting, foreground);
      for (const id of ["q1", "q2"]) {
        const live = (await admin.doc(`${answerPath}/${id}`).get()).data();
        const frozen = (await admin.doc(`${path}/rounds/image/teamAnswers/red/answers/${id}`).get()).data();
        if (live) assert.equal(frozen?.answer, live.answer, "Atomic closure grades every accepted image match");
      }
      await assert.rejects(save(b, "q2", "i2"), /closed/);
      await denied(setDoc(doc(a.db, `${answerPath}/q2`), { answer: "i2", locked: false, user: "a" }));
      await denied(updateDoc(doc(b.db, `${answerPath}/q2`), { locked: true }));
    }
    {
      const roomId = "rules-color", path = `rooms/${roomId}`;
      const [a, b, outsider, hostClient] = apps;
      const presentation = { round: "r1", question: "q1", promptPage: 0, answerPage: 0, withAnswer: false };
      await admin.doc(path).set({ state: "playing", presenting: presentation });
      for (const { uid } of apps) await admin.doc(`${path}/members/${uid}`).set({ role: uid === "host" ? "host" : "player", team: uid === "outsider" ? "blue" : "red" });
      await admin.doc(`${path}/teams/red`).set({ name: "Red" });
      await admin.doc(`${path}/rounds/r1`).set({ type: "color", state: "active" });
      await admin.doc(`${path}/rounds/r1/questions/q1`).set({ initialColor: "#123456" });
      await admin.doc(`${path}/rounds/r1/answers/q1`).set({ answer: "#FFFFFF" });
      await saveTeamAnswer(admin, roomId, "r1", "q1", "a", parseAnswerSave({ teamId: "red", answer: "#AABBCC" }));
      const answerPath = `${path}/teams/red/rounds/r1/answers/q1`;
      assert.equal((await getDocFromServer(doc(hostClient.db, answerPath))).data()?.answer, "#AABBCC");
      await denied(getDocFromServer(doc(outsider.db, answerPath)));
      await denied(getDocFromServer(doc(a.db, `${path}/rounds/r1/answers/q1`)));
      await denied(setDoc(doc(a.db, answerPath), { answer: "#FFFFFF" }));
      await saveTeamAnswer(admin, roomId, "r1", "q1", "a", parseAnswerSave({ teamId: "red", locked: true }));
      assert.equal((await getDocFromServer(doc(b.db, answerPath))).data()?.locked, true);
      await assert.rejects(saveTeamAnswer(admin, roomId, "r1", "q1", "b", parseAnswerSave({ teamId: "red", answer: "#FFFFFF" })), /Unlock/);
      await denied(updateDoc(doc(b.db, answerPath), { locked: false }));
      await assert.rejects(saveTeamAnswer(admin, roomId, "r1", "q1", "outsider", parseAnswerSave({ teamId: "red", locked: false })), /Team changed/);
      await saveTeamAnswer(admin, roomId, "r1", "q1", "b", parseAnswerSave({ teamId: "red", locked: false }));
      const unlocked = (await getDocFromServer(doc(a.db, answerPath))).data()!;
      assert.equal(unlocked.locked, false);
      assert.equal(unlocked.answer, "#AABBCC");
      await saveTeamAnswer(admin, roomId, "r1", "q1", "b", parseAnswerSave({ teamId: "red", locked: true }));
      await assert.rejects(saveTeamAnswer(admin, roomId, "r1", "q1", "a", parseAnswerSave({ teamId: "red", answer: "#FFFFFF" })), /Unlock/);
      assert.equal((await getDocFromServer(doc(a.db, answerPath))).data()?.locked, true);
      await denied(updateDoc(doc(hostClient.db, `${path}/rounds/r1`), { state: "closed" }));
      await transitionPresentation(admin, roomId, "host", presentation, presentation, { closeRound: "r1" });
      await assert.rejects(saveTeamAnswer(admin, roomId, "r1", "q1", "a", parseAnswerSave({ teamId: "red", answer: "#FFFFFF" })), /Round/);
      await assert.rejects(saveTeamAnswer(admin, roomId, "r1", "q1", "b", parseAnswerSave({ teamId: "red", locked: false })), /Round/);
      await denied(getDocFromServer(doc(a.db, `${path}/rounds/r1/answers/q1`)));
      await transitionPresentation(admin, roomId, "host", presentation, { ...presentation, withAnswer: true });
      assert.equal((await getDocFromServer(doc(a.db, `${path}/rounds/r1/answers/q1`))).data()?.answer, "#FFFFFF");
    }
    {
      const roomId = "rules-text", path = `rooms/${roomId}`;
      const [a, b, outsider, hostClient] = apps;
      const presentation = { round: "r1", question: "q1", promptPage: 0, answerPage: 0, withAnswer: false };
      const answerPath = `${path}/teams/red/rounds/r1/answers/q1`;
      const gradedPath = `${path}/rounds/r1/teamAnswers/red/answers/q1`;
      await admin.doc(path).update({ presenting: presentation });
      await admin.doc(`${path}/rounds/r1`).update({ state: "active", allowWager: true });
      const save = (uid: string, wagered: boolean) => saveTeamAnswer(admin, roomId, "r1", "q1", uid,
        parseAnswerSave({ teamId: "red", wagered }));
      await saveTeamAnswer(admin, roomId, "r1", "q1", "a", parseAnswerSave({ teamId: "red", locked: true }));
      await save("a", true);
      assert.equal((await getDocFromServer(doc(b.db, answerPath))).data()?.wagered, true);
      await save("b", false);
      assert.equal((await getDocFromServer(doc(a.db, answerPath))).data()?.wagered, false);
      await save("a", true);
      await denied(updateDoc(doc(a.db, answerPath), { wagered: false }));
      await denied(updateDoc(doc(outsider.db, answerPath), { wagered: false }));
      await assert.rejects(save("outsider", false), /Team changed/);
      await transitionPresentation(admin, roomId, "host", presentation, { ...presentation, question: null }, { closeRound: "r1" });
      const graded = (await getDocFromServer(doc(hostClient.db, gradedPath))).data()!;
      assert.equal(graded.wagered, true);
      assert.equal(graded.awardedPoints, -2);
      await assert.rejects(save("a", false), /Round/);
      await denied(updateDoc(doc(a.db, gradedPath), { awardedPoints: 2 }));
      await updateDoc(doc(hostClient.db, gradedPath), { awardedPoints: 2 });
      assert.equal((await getDocFromServer(doc(a.db, gradedPath))).data()?.awardedPoints, 2);
    }
    {
      const roomId = "rules-sorting", path = `rooms/${roomId}`;
      const [a, b, outsider, hostClient] = apps;
      const foreground = { round: "foreground", question: "q1", promptPage: 0, answerPage: 0, withAnswer: false };
      const roundPath = `${path}/rounds/sorting`;
      const answerPath = `${path}/teams/red/rounds/sorting`;
      const privatePath = `${roundPath}/answers/order`;
      const frozenPath = `${roundPath}/teamAnswers/red`;
      const correctOrder = ["a", "b", "c", "d"];
      let editNumber = 0;
      const edit = (itemId: string, anchorId: string, placement: SortingEdit["placement"] = "after"): SortingEdit => ({ id: `emulator-edit-${++editNumber}`, itemId, anchorId, placement });
      const save = async (uid: string, teamId: string, operation: SortingEdit) => {
        const ack = await saveSortingEdit(admin, roomId, "sorting", uid, parseSortingEditSave({ teamId, edit: operation }));
        assert.ok("editId" in ack);
        return ack;
      };
      const live = async (teamId = "red") => parseSortingSnapshot((await admin.doc(`${path}/teams/${teamId}/rounds/sorting`).get()).data(), correctOrder);
      const arrange = async (uid: string, teamId: string, desired: string[]) => {
        for (let index = 0; index < desired.length; index++) {
          const current = (await live(teamId)).order;
          if (current[index] !== desired[index]) await save(uid, teamId, edit(desired[index], current[index], "before"));
        }
      };
      await admin.doc(path).set({ state: "playing", presenting: foreground });
      for (const { uid } of apps) await admin.doc(`${path}/members/${uid}`).set({
        role: uid === "host" ? "host" : "player", team: uid === "outsider" ? "blue" : "red",
      });
      await admin.doc(`${path}/teams/red`).set({ name: "Red" });
      await admin.doc(`${path}/teams/blue`).set({ name: "Blue" });
      await admin.doc(`${path}/rounds/foreground`).set({ type: "text", state: "active" });
      await admin.doc(`${path}/rounds/foreground/questions/q1`).set({ stages: [{ text: "Foreground one" }] });
      await admin.doc(`${path}/rounds/foreground-two`).set({ type: "text", state: "scheduled" });
      await admin.doc(`${path}/rounds/foreground-two/questions/q1`).set({ stages: [{ text: "Foreground two" }] });
      await admin.doc(roundPath).set({ type: "sorting", state: "scheduled" });
      for (const id of correctOrder) await admin.doc(`${roundPath}/questions/${id}`).set({ text: id.toUpperCase() });
      await admin.doc(privatePath).set({ correctOrder });
      await transitionPresentation(admin, roomId, "host", foreground, foreground, { activateRound: "sorting" });
      assert.deepEqual((await admin.doc(path).get()).data()?.presenting, foreground);
      const initial = await live();
      assert.equal(initial.revision, 0);
      assert.deepEqual(await live("blue"), initial);
      assert.deepEqual((await getDocFromServer(doc(b.db, answerPath))).data()?.order, initial.order);
      await denied(getDocFromServer(doc(a.db, privatePath)));
      assert.deepEqual((await getDocFromServer(doc(hostClient.db, privatePath))).data()?.correctOrder, correctOrder);
      await denied(updateDoc(doc(hostClient.db, roundPath), { state: "closed" }));
      await denied(setDoc(doc(a.db, answerPath), { order: correctOrder, revision: 100 }));
      await denied(setDoc(doc(a.db, frozenPath), { answer: JSON.stringify(correctOrder), awardedPoints: 999 }));
      await assert.rejects(save("outsider", "red", edit("a", "b")), /Team changed/);
      await assert.rejects(transitionPresentation(admin, roomId, "host", foreground,
        { ...foreground, round: "sorting", question: null, withAnswer: true }));
      await admin.doc(path).update({ presenting: { ...foreground, round: "sorting", question: null, withAnswer: true } });
      await denied(getDocFromServer(doc(a.db, privatePath)));
      await admin.doc(path).update({ presenting: foreground });
      const propagationStarted = performance.now();
      const observed = new Promise<number>((resolve, reject) => {
        const unsubscribe = onSnapshot(doc(b.db, answerPath), (snapshot) => {
          if (snapshot.metadata.fromCache || snapshot.data()?.revision !== 1) return;
          unsubscribe();
          resolve(performance.now() - propagationStarted);
        }, reject);
      });
      const firstEdit = edit(initial.order[0], initial.order.at(-1)!);
      const firstAck = await save("a", "red", firstEdit);
      const saveDuration = performance.now() - propagationStarted;
      assert.deepEqual(firstAck, { editId: firstEdit.id, revision: 1 });
      const snapshotDuration = await observed;
      console.log(JSON.stringify({ event: "sorting.propagation", environment: "local-firestore-emulator", saveMs: Math.round(saveDuration), teammateSnapshotMs: Math.round(snapshotDuration) }));
      assert.deepEqual((await getDocFromServer(doc(b.db, answerPath))).data()?.order, applySortingEdit(initial.order, firstEdit));
      await denied(getDocFromServer(doc(outsider.db, answerPath)));
      await denied(getDocFromServer(doc(a.db, `${answerPath}/edits/${firstEdit.id}`)));
      await denied(setDoc(doc(a.db, `${answerPath}/edits/forged`), { revision: 999 }));

      await arrange("a", "red", correctOrder);
      const beforeConcurrent = (await live()).revision;
      const concurrent = [edit("a", "b"), edit("d", "c", "before")];
      const acknowledgements = await Promise.all([save("a", "red", concurrent[0]), save("b", "red", concurrent[1])]);
      assert.deepEqual(acknowledgements.map((ack) => ack.revision).sort((left, right) => left - right), [beforeConcurrent + 1, beforeConcurrent + 2]);
      assert.deepEqual((await live()).order, ["b", "a", "d", "c"], "Concurrent teammates preserve both edits");
      const duplicate = edit("a", "c");
      const beforeDuplicate = (await live()).revision;
      const duplicates = await Promise.all([save("a", "red", duplicate), save("b", "red", duplicate)]);
      assert.deepEqual(duplicates[0], duplicates[1]);
      assert.equal((await live()).revision, beforeDuplicate + 1, "Concurrent duplicate delivery applies once");
      await save("b", "red", edit("a", "b", "before"));
      const afterNewMove = await live();
      assert.deepEqual(await save("a", "red", duplicate), duplicates[0]);
      assert.deepEqual(await live(), afterNewMove, "Receipt replay cannot overwrite a later teammate move");
      await assert.rejects(save("a", "red", { ...duplicate, anchorId: "d" }), /already been used/);
      await arrange("outsider", "blue", ["b", "a", "d", "c"]);
      await arrange("b", "red", ["a", "c", "b", "d"]);
      const secondForeground = { ...foreground, round: "foreground-two" };
      await transitionPresentation(admin, roomId, "host", foreground, secondForeground, { activateRound: "foreground-two" });
      const reconnectApp = initializeApp({ projectId, apiKey: "fake" }, "sorting-reconnect");
      const reconnect = getFirestore(reconnectApp);
      connectFirestoreEmulator(reconnect, host, Number(port), { mockUserToken: { sub: "a", user_id: "a" } });
      try {
        assert.deepEqual((await getDocFromServer(doc(reconnect, answerPath))).data()?.order, ["a", "c", "b", "d"]);
      } finally {
        await terminate(reconnect);
        await deleteApp(reconnectApp);
      }
      const accepted = await live();
      await transitionPresentation(admin, roomId, "host", secondForeground, secondForeground, { closeRound: "sorting" });
      assert.deepEqual((await admin.doc(path).get()).data()?.presenting, secondForeground);
      const frozen = (await getDocFromServer(doc(a.db, frozenPath))).data()!;
      assert.deepEqual(frozen.order, ["a", "c", "b", "d"]);
      assert.equal(frozen.revision, accepted.revision);
      await assert.rejects(save("a", "red", edit("a", "b")), (error: unknown) => (error as { code: string }).code === "round-closed");
      assert.deepEqual(await save("a", "red", duplicate), duplicates[0], "An accepted edit can be acknowledged after closing");
      await denied(updateDoc(doc(a.db, answerPath), { order: correctOrder, revision: accepted.revision + 1 }));
      await denied(getDocFromServer(doc(a.db, privatePath)));
      await gradeSortingRound(admin, roomId, "sorting", "host");
      assert.deepEqual((await getDocFromServer(doc(a.db, privatePath))).data()?.correctOrder, correctOrder, "Scored correct order is readable without presentation");
      assert.deepEqual((await getDocFromServer(doc(a.db, frozenPath))).data()?.pointsByQuestion, { a: 1, b: 0, c: 0, d: 1 });
      assert.equal((await getDocFromServer(doc(a.db, frozenPath))).data()?.awardedPoints, 2);
      assert.equal((await getDocFromServer(doc(a.db, `${path}/teams/red/scores/sorting`))).data()?.score, 2);
      assert.equal((await getDocFromServer(doc(a.db, `${path}/teams/red`))).data()?.scoreTotal, 2);
      await gradeSortingRound(admin, roomId, "sorting", "host");
      assert.equal((await getDocFromServer(doc(a.db, `${path}/teams/red`))).data()?.scoreTotal, 2);
      await denied(updateDoc(doc(a.db, frozenPath), { awardedPoints: 999 }));
      await transitionPresentation(admin, roomId, "host", secondForeground,
        { ...secondForeground, round: "sorting", question: null, withAnswer: true });
      assert.deepEqual((await getDocFromServer(doc(a.db, privatePath))).data()?.correctOrder, correctOrder);
      await admin.doc(path).update({ presenting: secondForeground });
      await admin.doc(roundPath).update({ state: "active" });
      const lateEdit = edit("a", "d");
      const [closing, saving] = await Promise.allSettled([
        transitionPresentation(admin, roomId, "host", secondForeground, secondForeground, { closeRound: "sorting" }),
        save("a", "red", lateEdit),
      ]);
      assert.equal(closing.status, "fulfilled");
      if (saving.status === "rejected") assert.equal(saving.reason.code, "round-closed");
      const liveSnapshot = await live();
      const frozenSnapshot = (await admin.doc(frozenPath).get()).data()!;
      assert.deepEqual(frozenSnapshot.order, liveSnapshot.order);
      assert.equal(frozenSnapshot.revision, liveSnapshot.revision);
      assert.deepEqual(liveSnapshot.order, saving.status === "fulfilled" ? applySortingEdit(accepted.order, lateEdit) : accepted.order);
      await assert.rejects(save("b", "red", edit("d", "c")), /Round/);
      assert.deepEqual((await admin.doc(path).get()).data()?.presenting, secondForeground);
    }
    const roomPath = "rooms/rules-multi-step";
    await admin.doc(`${roomPath}/rounds/r1`).update({ state: "active", allowAnswerChanges: false });
    await admin.doc(roomPath).update({ presenting: { round: "r1", question: "q1", promptPage: 1, answerPage: 0, withAnswer: false } });
    await admin.doc(`${roomPath}/rounds/r1/questions/q1`).update({ finalizedStep: 0 });
    await assert.rejects(saveTeamAnswer(admin, "rules-multi-step", "r1", "q1", "a",
      { teamId: "red", expectedStep: 1, mutation: { locked: false } }), /permanently locked/);
  } finally {
    await Promise.all(apps.map(async ({ db, app }) => { await terminate(db); await deleteApp(app); }));
    await admin.terminate();
    await deleteAdmin(adminApp);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
