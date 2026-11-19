import { useCallback, useEffect, useState } from "react";

const FIRST_RUN_SIGN_IN_COMPLETED_KEY = "puppyone.desktop.firstRunSignInCompleted.v1";

/** Offer sign-in on a fresh empty launch after both workspace and auth restoration settle. */
export function useFirstRunSignIn({ available, restoring, signedIn, hasProjects }: {
  available: boolean;
  restoring: boolean;
  signedIn: boolean;
  hasProjects: boolean;
}) {
  const [completed, setCompleted] = useState(() => {
    try {
      return window.localStorage.getItem(FIRST_RUN_SIGN_IN_COMPLETED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const complete = useCallback(() => {
    setCompleted(true);
    try {
      window.localStorage.setItem(FIRST_RUN_SIGN_IN_COMPLETED_KEY, "true");
    } catch {
      // A storage failure must not prevent continuing in the current window.
    }
  }, []);

  useEffect(() => {
    if (!restoring && !completed && (signedIn || hasProjects)) complete();
  }, [complete, completed, hasProjects, restoring, signedIn]);

  return {
    pending: available && restoring && !completed && !signedIn && !hasProjects,
    required: available && !restoring && !completed && !signedIn && !hasProjects,
    complete,
  };
}
