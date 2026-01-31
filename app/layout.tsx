import type { Metadata } from "next";
import "./globals.css";
import { FirebaseAuthProvider } from "./providers/firebase-auth-provider";

export const metadata: Metadata = {
  title: "Quizee",
  description: "Quizee - app for pubquiz-like quizzes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <FirebaseAuthProvider>{children}</FirebaseAuthProvider>
      </body>
    </html>
  );
}
