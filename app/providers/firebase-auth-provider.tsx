"use client";

import type { User } from "firebase/auth";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getFirebaseClientApp } from "@/lib/firebase/client";

type FirebaseAuthContextValue = {
  user: User | null;
  loading: boolean;
  getToken: () => Promise<string>;
};

const FirebaseAuthContext = createContext<FirebaseAuthContextValue | undefined>(
  undefined
);

export function FirebaseAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getAuth(getFirebaseClientApp());

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error("[auth] Failed to sign in anonymously", error);
          setLoading(false);
        }
        return;
      }

      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const value = useMemo<FirebaseAuthContextValue>(
    () => ({
      user,
      loading,
      getToken: async () => {
        const auth = getAuth(getFirebaseClientApp());
        const current = auth.currentUser;

        if (!current) {
          throw new Error("User not authenticated");
        }

        return current.getIdToken();
      },
    }),
    [loading, user]
  );

  return (
    <FirebaseAuthContext.Provider value={value}>
      {children}
    </FirebaseAuthContext.Provider>
  );
}

export function useFirebaseAuth(): FirebaseAuthContextValue {
  const context = useContext(FirebaseAuthContext);
  if (!context) {
    throw new Error(
      "useFirebaseAuth must be used within a FirebaseAuthProvider."
    );
  }
  return context;
}
