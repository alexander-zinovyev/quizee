import type { Metadata } from "next";
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}
