"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";

import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import RoomJoinPage from "./room-join-page";
import RoomContent from "./room-content";
import RoomPending from "./room-pending";
import RoomEnded from "./room-ended";
import { getClientFirestore } from "@/lib/firebase/client";
import type { RoomRosterTeam } from "./room-layout-types";
import type { TeamMember } from "@/lib/components/team";
import { createMediaTransport } from "@/lib/media";
import type { MediaParticipant, MediaTransport, SubscriptionPolicy } from "@/lib/media/transport";

type RoomGateProps = {
  roomSlug: string;
};

type RoomState = "pending" | "playing" | "ended";
type PresentingState =
  | {
      round?: string | null;
      question?: string | null;
      withAnswer?: boolean;
      playMedia?: boolean;
    }
  | null;

const MEDIA_DISABLED = process.env.NEXT_PUBLIC_MEDIA_DISABLED === "true";

export default function RoomGate({ roomSlug }: RoomGateProps) {
  const { user, loading: authLoading, getToken } = useFirebaseAuth();
  const [checkingMembership, setCheckingMembership] = useState(true);
  const [isMember, setIsMember] = useState(false);
  const [viewerIsHost, setViewerIsHost] = useState(false);
  const [isLoadingRoomData, setIsLoadingRoomData] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [roomTitle, setRoomTitle] = useState<string | null>(null);
  const [teams, setTeams] = useState<RoomRosterTeam[]>([]);
  const [unassignedMembers, setUnassignedMembers] = useState<TeamMember[]>([]);
  const [hostMember, setHostMember] = useState<TeamMember | null>(null);
  const [viewerTeamId, setViewerTeamId] = useState<string | null>(null);
  const [viewerName, setViewerName] = useState<string | null>(null);
  const [handRaisingEnabled, setHandRaisingEnabled] = useState(true);
  const [countdownEndsAt, setCountdownEndsAt] = useState<Date | null>(null);
  const [presenting, setPresenting] = useState<PresentingState>(null);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [mediaParticipants, setMediaParticipants] = useState<MediaParticipant[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const mediaTransportRef = useRef<MediaTransport | null>(null);
  const mediaSessionRef = useRef<{ roomId: string; uid: string } | null>(null);

  useEffect(() => {
    if (user) {
      console.log("[room-gate] current uid", user.uid);
    }
  }, [user]);

  useEffect(() => {
    if (mediaError) {
      console.warn("[room-gate] media error", mediaError);
    }
  }, [mediaError]);

  useEffect(() => {
    if (MEDIA_DISABLED) {
      return;
    }
    const transport = createMediaTransport();
    mediaTransportRef.current = transport;
    const offUpdate = transport.onParticipantUpdate(setMediaParticipants);
    const offError = transport.onError((err) => {
      setMediaError(err.message ?? "Unable to connect media.");
    });

    return () => {
      offUpdate();
      offError();
      transport.leave().catch(() => undefined);
      mediaTransportRef.current = null;
      mediaSessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let hasRoomData = false;
    let hasTeamsData = false;
    let hasMembersData = false;
    let roomListenersStarted = false;
    let roomStateValue: RoomState = "pending";
    let roomTitleValue: string | null = null;
    let teamsValue: RoomRosterTeam[] = [];
    let handRaisingEnabledValue = true;
    let countdownEndsAtValue: Date | null = null;
    let presentingValue: PresentingState = null;
    let membersValue: Array<{
      id: string;
      name: string;
      role?: string;
      teamId?: string | null;
      handRaised?: boolean;
    }> = [];
    const dataUnsubscribers: Array<() => void> = [];
    let membershipUnsubscribe: (() => void) | null = null;

    const resetState = () => {
      setRoomState(null);
      setRoomTitle(null);
      setTeams([]);
      setUnassignedMembers([]);
      setHostMember(null);
      setPresenting(null);
      setHandRaisingEnabled(true);
      setCountdownEndsAt(null);
    };

    const applyRoster = () => {
      if (cancelled) return;
      if (!hasRoomData || !hasTeamsData || !hasMembersData) {
        return;
      }

      const teamMap = new Map<string, RoomRosterTeam>(
        teamsValue.map((team) => [team.id, { ...team, members: [] as TeamMember[] }])
      );
      const unassigned: TeamMember[] = [];
      let host: TeamMember | null = null;
      const nameMap: Record<string, string> = {};

      membersValue.forEach((member) => {
        const normalized: TeamMember = {
          id: member.id,
          name: member.name,
          handRaised: member.handRaised,
        };
        if (normalized.name) {
          nameMap[normalized.id] = normalized.name;
        }
        if (member.role === "host") {
          host = host ?? normalized;
        }

        if (member.teamId && teamMap.has(member.teamId)) {
          teamMap.get(member.teamId)?.members.push(normalized);
        } else if (member.role !== "host") {
          unassigned.push(normalized);
        }
      });

      setRoomState(roomStateValue);
      setRoomTitle(roomTitleValue ?? roomSlug);
      setTeams(Array.from(teamMap.values()));
      setUnassignedMembers(unassigned);
      setHostMember(host);
      setPresenting(presentingValue);
      setMemberNames(nameMap);
      setIsLoadingRoomData(false);
    };

    async function loadRoom() {
      if (authLoading) return;

      if (!roomSlug) {
        setError("Room is missing.");
        setCheckingMembership(false);
        setIsLoadingRoomData(false);
        return;
      }

      if (!user) {
        setError("Unable to start session. Refresh and try again.");
        setCheckingMembership(false);
        setIsLoadingRoomData(false);
        return;
      }

      setCheckingMembership(true);
      setIsLoadingRoomData(true);
      setError(null);

      try {
        const db = getClientFirestore();
        const memberRef = doc(db, "rooms", roomSlug, "members", user.uid);

        const unsubscribeMembership = onSnapshot(
          memberRef,
          (membershipSnapshot) => {
            if (cancelled) return;

            const isMemberDoc = membershipSnapshot.exists();
            setIsMember(isMemberDoc);
            const memberRole = (membershipSnapshot.data()?.role as string | undefined) ?? "";
            setViewerIsHost(memberRole === "host");
            const memberTeam =
              (membershipSnapshot.data()?.team as string | undefined | null) ?? null;
            setViewerTeamId(memberTeam);
            const memberNameRaw =
              (membershipSnapshot.data()?.name as string | undefined) ??
              (membershipSnapshot.data()?.displayName as string | undefined);
            const memberName =
              typeof memberNameRaw === "string" && memberNameRaw.trim().length
                ? memberNameRaw.trim()
                : null;
            setViewerName(memberName);

            if (!isMemberDoc) {
              resetState();
              setIsLoadingRoomData(false);
              dataUnsubscribers.forEach((unsub) => unsub());
              dataUnsubscribers.length = 0;
              roomListenersStarted = false;
              hasRoomData = false;
              hasTeamsData = false;
              hasMembersData = false;
              return;
            }

            if (roomListenersStarted) {
              return;
            }

            roomListenersStarted = true;
            setIsLoadingRoomData(true);

            const roomRef = doc(db, "rooms", roomSlug);

            const unsubscribeRoom = onSnapshot(
              roomRef,
              (roomSnapshot) => {
                hasRoomData = true;
                const roomData = roomSnapshot.data() ?? {};
                const rawRoomState = (roomData.state as string | undefined)?.trim();
                roomStateValue =
                  rawRoomState === "playing" || rawRoomState === "ended" ? rawRoomState : "pending";
                roomTitleValue = (roomData.title as string | undefined) ?? roomSlug;
                handRaisingEnabledValue =
                  typeof roomData.handRaisingEnabled === "boolean"
                    ? roomData.handRaisingEnabled
                    : true;
                countdownEndsAtValue =
                  roomData.countdownEndsAt?.toDate?.() ?? null;
                const presentingData = roomData.presenting as PresentingState;
                if (
                  presentingData &&
                  typeof presentingData === "object" &&
                  ("round" in presentingData || "question" in presentingData)
                ) {
                  presentingValue = {
                    round:
                      typeof presentingData.round === "string"
                        ? presentingData.round
                        : presentingData.round ?? null,
                    question:
                      typeof presentingData.question === "string"
                        ? presentingData.question
                        : presentingData.question ?? null,
                    withAnswer: Boolean(presentingData.withAnswer),
                    playMedia: Boolean((presentingData as { playMedia?: boolean }).playMedia),
                  };
                } else {
                  presentingValue = null;
                }
                applyRoster();
                setHandRaisingEnabled(handRaisingEnabledValue);
                setCountdownEndsAt(countdownEndsAtValue);
              },
              (roomError) => {
                console.error("[room-gate] room snapshot error", roomError);
                setError("Unable to load the room right now. Please try again.");
                setIsLoadingRoomData(false);
              }
            );

            const unsubscribeTeams = onSnapshot(
              collection(roomRef, "teams"),
              (teamsSnapshot) => {
                hasTeamsData = true;
                teamsValue = teamsSnapshot.docs.map((docSnap) => ({
                  id: docSnap.id,
                  name: (docSnap.data().name as string | undefined) ?? `Team ${docSnap.id}`,
                  color: (docSnap.data().color as string | undefined) ?? null,
                  scoreTotal:
                    typeof docSnap.data().scoreTotal === "number"
                      ? (docSnap.data().scoreTotal as number)
                      : 0,
                  members: [],
                }));
                applyRoster();
              },
              (teamsError) => {
                console.error("[room-gate] teams snapshot error", teamsError);
                setError("Unable to load teams right now. Please try again.");
                setIsLoadingRoomData(false);
              }
            );

            const unsubscribeMembers = onSnapshot(
              collection(roomRef, "members"),
              (membersSnapshot) => {
                hasMembersData = true;
                membersValue = membersSnapshot.docs.map((memberSnap) => {
                  const data = memberSnap.data();
                  const rawName =
                    (data.name as string | undefined) ??
                    (data.displayName as string | undefined);
                  const memberName =
                    typeof rawName === "string" && rawName.trim().length
                      ? rawName.trim()
                      : "Unnamed player";
                  const role = data.role as string | undefined;
                  const teamId = (data.team as string | undefined | null) ?? null;
                  const handRaised = Boolean(data.handRaised);

                  return {
                    id: memberSnap.id,
                    name: memberName,
                    role,
                    teamId,
                    handRaised,
                  };
                });
                applyRoster();
              },
              (membersError) => {
                console.error("[room-gate] members snapshot error", membersError);
                setError("Unable to load members right now. Please try again.");
                setIsLoadingRoomData(false);
              }
            );

            dataUnsubscribers.push(unsubscribeRoom, unsubscribeTeams, unsubscribeMembers);
          },
          (membershipError) => {
            console.error("[room-gate] membership snapshot error", membershipError);
            setError("Unable to verify membership right now. Please try again.");
            setIsLoadingRoomData(false);
          }
        );

        membershipUnsubscribe = unsubscribeMembership;
      } catch (membershipError) {
        console.error("[room-gate]", membershipError);
        if (!cancelled) {
          setError("Unable to load the room right now. Please try again.");
        }
      } finally {
        if (!cancelled) {
          setCheckingMembership(false);
          setIsLoadingRoomData(false);
        }
      }
    }

    void loadRoom();

    return () => {
      cancelled = true;
      dataUnsubscribers.forEach((unsubscribe) => unsubscribe());
      if (membershipUnsubscribe) {
        membershipUnsubscribe();
      }
    };
  }, [authLoading, retryCount, roomSlug, user]);

  const memberTeamMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    teams.forEach((team) => {
      team.members.forEach((member) => {
        const id = member.id?.toString();
        if (id) {
          map[id] = team.id;
        }
      });
    });
    unassignedMembers.forEach((member) => {
      const id = member.id?.toString();
      if (id && !(id in map)) {
        map[id] = null;
      }
    });
    if (hostMember?.id) {
      map[hostMember.id.toString()] = null;
    }
    return map;
  }, [teams, unassignedMembers, hostMember?.id]);

  const applyMediaPolicy = useCallback(
    (policy: SubscriptionPolicy, options?: { isHost?: boolean }) => {
      const transport = mediaTransportRef.current;
      if (!transport) return;
      void transport.setSubscriptionPolicy(policy, {
        teamId: viewerTeamId,
        hostId: hostMember?.id?.toString() ?? null,
        isHost: options?.isHost ?? viewerIsHost,
        memberTeamMap,
      });
    },
    [hostMember?.id, memberTeamMap, viewerIsHost, viewerTeamId]
  );

  useEffect(() => {
    if (MEDIA_DISABLED) {
      if (mediaSessionRef.current) {
        mediaSessionRef.current = null;
      }
      return;
    }
    const transport = mediaTransportRef.current;
    if (!transport) return;

    if (!isMember || !roomSlug || !user) {
      if (mediaSessionRef.current) {
        transport.leave().catch(() => undefined);
        mediaSessionRef.current = null;
      }
      return;
    }

    const session = mediaSessionRef.current;
    if (session && session.roomId === roomSlug && session.uid === user.uid) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        await transport.join(roomSlug, user.uid, viewerName ?? user.uid, token);
        if (cancelled) return;
        mediaSessionRef.current = { roomId: roomSlug, uid: user.uid };
        applyMediaPolicy({ audio: "all", video: "all" }, { isHost: viewerIsHost });
      } catch (error) {
        if (cancelled) return;
        console.error("[room-gate] media join failed", error);
        setMediaError("Unable to join audio/video.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyMediaPolicy, getToken, isMember, roomSlug, user, viewerIsHost, viewerName]);

  const mediaById = useMemo(() => {
    return new Map(mediaParticipants.map((participant) => [participant.id, participant]));
  }, [mediaParticipants]);
  const localMedia = useMemo(
    () => mediaParticipants.find((participant) => participant.isLocal),
    [mediaParticipants]
  );

  const attachMedia = useCallback(
    (member: TeamMember): TeamMember => {
      const id = member.id?.toString() ?? "";
      const media =
        mediaById.get(id) ??
        (user?.uid && id === user.uid ? localMedia : undefined);
      if (!media) return member;
      return {
        ...member,
        audioTrack: media.audioTrack,
        videoTrack: media.videoTrack,
        muted: media.isLocal ?? member.muted,
      };
    },
    [localMedia, mediaById, user?.uid]
  );

  const teamsWithMedia = useMemo(() => {
    return teams.map((team) => ({
      ...team,
      members: team.members.map(attachMedia),
    }));
  }, [attachMedia, teams]);

  const unassignedWithMedia = useMemo(() => {
    return unassignedMembers.map(attachMedia);
  }, [attachMedia, unassignedMembers]);

  const hostWithMedia = useMemo(() => {
    return hostMember ? attachMedia(hostMember) : null;
  }, [attachMedia, hostMember]);

  useEffect(() => {
    if (!roomState || roomState === "playing") return;
    applyMediaPolicy({ audio: "all", video: "all" }, { isHost: viewerIsHost });
  }, [applyMediaPolicy, roomState, viewerIsHost]);

  const showLoading = authLoading || checkingMembership || (isMember && isLoadingRoomData);

  const handleStart = async () => {
    if (!viewerIsHost || roomState !== "pending" || isStarting) return;
    try {
      setIsStarting(true);
      const db = getClientFirestore();
      await updateDoc(doc(db, "rooms", roomSlug), { state: "playing" });
    } catch (startError) {
      console.error("[room-start]", startError);
      setError("Unable to start the quiz right now.");
    } finally {
      setIsStarting(false);
    }
  };

  if (showLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-white via-zinc-50 to-zinc-100 p-6 text-center dark:from-black dark:via-zinc-950 dark:to-zinc-900">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
            Loading room…
          </p>
          <p className="text-lg text-zinc-800 dark:text-zinc-100">
            Getting your session ready.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-white via-zinc-50 to-zinc-100 p-6 text-center dark:from-black dark:via-zinc-950 dark:to-zinc-900">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-red-500">
            Error
          </p>
          <p className="text-lg text-zinc-800 dark:text-zinc-100">{error}</p>
          <button
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 dark:bg-emerald-400 dark:text-zinc-950 dark:hover:bg-emerald-300 dark:focus:ring-emerald-300 dark:focus:ring-offset-zinc-900"
            onClick={() => {
              setError(null);
              setCheckingMembership(true);
              setRetryCount((count) => count + 1);
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!isMember) {
    return (
      <RoomJoinPage
        roomSlug={roomSlug}
        onJoined={() => {
          setIsMember(true);
          setCheckingMembership(true);
          setRetryCount((count) => count + 1);
        }}
      />
    );
  }

  if (!roomState) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-white via-zinc-50 to-zinc-100 p-6 text-center dark:from-black dark:via-zinc-950 dark:to-zinc-900">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
            Loading room…
          </p>
          <p className="text-lg text-zinc-800 dark:text-zinc-100">
            Fetching the latest room state.
          </p>
        </div>
      </div>
    );
  }

  if (roomState === "pending") {
    return (
      <RoomPending
        roomTitle={roomTitle ?? roomSlug}
        roomSlug={roomSlug}
        teams={teamsWithMedia}
        unassignedMembers={unassignedWithMedia}
        host={hostWithMedia}
        isHost={viewerIsHost}
        onStart={handleStart}
        isStartDisabled={isStarting}
      />
    );
  }

  if (roomState === "ended") {
    return (
      <RoomEnded
        roomTitle={roomTitle ?? roomSlug}
        roomSlug={roomSlug}
        teams={teamsWithMedia}
        unassignedMembers={unassignedWithMedia}
        host={hostWithMedia}
        isHost={viewerIsHost}
      />
    );
  }

  return (
    <RoomContent
      roomSlug={roomSlug}
      teams={teamsWithMedia}
      hostMember={hostWithMedia}
      isHost={viewerIsHost}
      presenting={presenting}
      viewerTeamId={viewerTeamId}
      memberNames={memberNames}
      viewerName={viewerName}
      handRaisingEnabled={handRaisingEnabled}
      countdownEndsAt={countdownEndsAt}
      onMediaPolicyChange={applyMediaPolicy}
    />
  );
}
