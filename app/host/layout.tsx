import { FirebaseAuthProvider } from "@/app/providers/firebase-auth-provider";

export default function HostLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseAuthProvider>{children}</FirebaseAuthProvider>;
}
