import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn() }),
}));

import { AppShell } from "./AppShell";
import type { Session } from "./api";

const session: Session = { userId: "u1", displayName: "Admin", roles: ["admin"], grants: [] };

describe("AppShell — Cmd-K search", () => {
  it("Cmd-K opens the search palette", () => {
    render(<AppShell session={session}>x</AppShell>);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("textbox")).toBeInTheDocument(); // palette input
  });

  it("the header search button also opens the palette", () => {
    render(<AppShell session={session}>x</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
