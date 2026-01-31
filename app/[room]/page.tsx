import RoomGate from "./room-gate";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ room: string }>;
}) {
  const { room } = await params;
  return <RoomGate roomSlug={room} />;
}
