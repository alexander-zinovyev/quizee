import { FirebaseAuthProvider } from "@/app/providers/firebase-auth-provider";

export default function RoomLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseAuthProvider>{children}</FirebaseAuthProvider>;
}
