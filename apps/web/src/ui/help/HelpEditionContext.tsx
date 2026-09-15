"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { Edition } from "../editionVocabulary";

const HelpEditionContext = createContext<Edition>("college");

export function HelpEditionProvider({ edition, children }: { edition: Edition; children: ReactNode }) {
  return <HelpEditionContext.Provider value={edition}>{children}</HelpEditionContext.Provider>;
}

export function useHelpEdition(): Edition {
  return useContext(HelpEditionContext);
}
