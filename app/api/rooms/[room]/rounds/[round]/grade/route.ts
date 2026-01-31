import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getServerAuth, getServerFirestore } from "@/server/database";

const SESSION_COOKIE_NAME = "__session";
const MAX_BATCH_WRITES = 450;

function parseBearerToken(headerValue: string | null): string | undefined {
  if (!headerValue) return undefined;
  const [scheme, token] = headerValue.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return undefined;
  return token.trim();
}

async function authenticateRequest(request: NextRequest): Promise<{ uid: string } | NextResponse> {
  const auth = getServerAuth();
  const bearer = parseBearerToken(request.headers.get("authorization"));
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (bearer) {
    try {
      const decoded = await auth.verifyIdToken(bearer);
      return { uid: decoded.uid };
    } catch (error) {
      console.warn("[round-grade] Bearer verification failed", error);
    }
  }

  if (sessionCookie) {
    try {
      const decoded = await auth.verifySessionCookie(sessionCookie, true);
      return { uid: decoded.uid };
    } catch (error) {
      console.warn("[round-grade] Session cookie verification failed", error);
    }
  }

  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

type TeamAnswers = {
  teamId: string;
  answers: Record<string, string>;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ room: string; round: string }> }
) {
  const authResult = await authenticateRequest(request);
  if (!("uid" in authResult)) {
    return authResult;
  }

  const { room, round } = await context.params;
  const roomSlug = room?.trim();
  const roundId = round?.trim();

  if (!roomSlug || !roundId) {
    return NextResponse.json(
      { message: "Room and round parameters are required." },
      { status: 400 }
    );
  }

  try {
    const db = getServerFirestore();
    const roomRef = db.collection("rooms").doc(roomSlug);
    const memberSnap = await roomRef
      .collection("members")
      .doc(authResult.uid)
      .get();

    if (!memberSnap.exists || memberSnap.data()?.role !== "host") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const roundRef = roomRef.collection("rounds").doc(roundId);
    const roundSnap = await roundRef.get();
    if (!roundSnap.exists) {
      return NextResponse.json({ message: "Round not found." }, { status: 404 });
    }

    const roundData = roundSnap.data() ?? {};
    if (roundData.type !== "image") {
      return NextResponse.json(
        { message: "Auto-grading is only available for image rounds." },
        { status: 400 }
      );
    }
    if (roundData.state !== "closed") {
      return NextResponse.json(
        { message: "Round must be closed before grading." },
        { status: 409 }
      );
    }

    const mappingSnap = await roundRef.collection("answers").get();
    if (mappingSnap.empty) {
      return NextResponse.json(
        { message: "No correct answers found for this round." },
        { status: 409 }
      );
    }

    const correctMap: Record<string, string> = {};
    mappingSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const answer = typeof data.answer === "string" ? data.answer.trim() : "";
      if (answer) {
        correctMap[docSnap.id] = answer;
      }
    });

    const teamAnswersSnap = await roundRef.collection("teamAnswers").get();
    const teamsToGrade: TeamAnswers[] = [];

    if (teamAnswersSnap.empty) {
      const teamsSnap = await roomRef.collection("teams").get();
      for (const teamDoc of teamsSnap.docs) {
        const answersSnap = await roomRef
          .collection("teams")
          .doc(teamDoc.id)
          .collection("rounds")
          .doc(roundId)
          .collection("answers")
          .get();
        const answers: Record<string, string> = {};
        answersSnap.forEach((ansDoc) => {
          const data = ansDoc.data();
          const answer = typeof data.answer === "string" ? data.answer.trim() : "";
          answers[ansDoc.id] = answer;
        });
        teamsToGrade.push({ teamId: teamDoc.id, answers });
      }
    } else {
      for (const teamDoc of teamAnswersSnap.docs) {
        const answersSnap = await teamDoc.ref.collection("answers").get();
        const answers: Record<string, string> = {};
        answersSnap.forEach((ansDoc) => {
          const data = ansDoc.data();
          const answer = typeof data.answer === "string" ? data.answer.trim() : "";
          answers[ansDoc.id] = answer;
        });
        teamsToGrade.push({ teamId: teamDoc.id, answers });
      }
    }

    let batch = db.batch();
    let writes = 0;
    const flushBatch = async () => {
      if (writes === 0) return;
      await batch.commit();
      batch = db.batch();
      writes = 0;
    };

    for (const team of teamsToGrade) {
      let correctCount = 0;
      for (const [promptId, correctImageId] of Object.entries(correctMap)) {
        const answer = team.answers[promptId] ?? "";
        const correct = answer === correctImageId;
        if (correct) {
          correctCount += 1;
        }
        const answerRef = roundRef
          .collection("teamAnswers")
          .doc(team.teamId)
          .collection("answers")
          .doc(promptId);
        batch.set(
          answerRef,
          {
            correct,
            gradedAt: FieldValue.serverTimestamp(),
            gradedBy: authResult.uid,
          },
          { merge: true }
        );
        writes += 1;
        if (writes >= MAX_BATCH_WRITES) {
          await flushBatch();
        }
      }

      const teamAnswersRef = roundRef.collection("teamAnswers").doc(team.teamId);
      batch.set(
        teamAnswersRef,
        {
          graded: true,
          gradedAt: FieldValue.serverTimestamp(),
          gradedBy: authResult.uid,
        },
        { merge: true }
      );
      writes += 1;

      const scoreRef = roomRef
        .collection("teams")
        .doc(team.teamId)
        .collection("scores")
        .doc(roundId);
      batch.set(scoreRef, { score: correctCount }, { merge: true });
      writes += 1;

      if (writes >= MAX_BATCH_WRITES) {
        await flushBatch();
      }
    }

    const roundMetaRef = roundRef;
    batch.set(
      roundMetaRef,
      { gradingRequired: false, gradedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    writes += 1;

    await flushBatch();

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("[round-grade]", error);
    return NextResponse.json(
      { message: "Unable to auto-grade this round right now." },
      { status: 500 }
    );
  }
}
