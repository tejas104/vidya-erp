"use client";
import { useState } from "react";
import { ApiError } from "./api";

export type MutationPhase =
  | { name: "idle" }
  | { name: "saving" }
  | { name: "done" }
  | { name: "error"; message: string };

export function useMutation<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => Promise<TResult>) {
  const [phase, setPhase] = useState<MutationPhase>({ name: "idle" });
  async function run(...args: TArgs): Promise<TResult | undefined> {
    setPhase({ name: "saving" });
    try {
      const result = await fn(...args);
      setPhase({ name: "done" });
      return result;
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "Something went wrong. Try again.";
      setPhase({ name: "error", message });
      return undefined;
    }
  }
  return { run, phase, reset: () => setPhase({ name: "idle" }) };
}
