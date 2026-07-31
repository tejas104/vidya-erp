import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InstallPrompt } from "./InstallPrompt";

function fireBeforeInstallPrompt(prompt = vi.fn().mockResolvedValue(undefined)) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: "accepted" }) });
  window.dispatchEvent(event);
  return prompt;
}

beforeEach(() => {
  localStorage.clear();
  // jsdom has no matchMedia; the browser always does (mirrors shell.test.tsx).
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue({ matches: true }), // "mobile" viewport by default
  });
});

describe("InstallPrompt (A2HS)", () => {
  it("shows for a teacher on mobile once the browser signals installability", async () => {
    render(<InstallPrompt roles={["teacher"]} />);
    expect(screen.queryByText(/add vidya to your home screen/i)).not.toBeInTheDocument();
    fireBeforeInstallPrompt();
    expect(await screen.findByText(/add vidya to your home screen/i)).toBeInTheDocument();
  });

  it("never shows for a role outside teacher/student", () => {
    render(<InstallPrompt roles={["admin"]} />);
    fireBeforeInstallPrompt();
    expect(screen.queryByText(/add vidya to your home screen/i)).not.toBeInTheDocument();
  });

  it("never shows outside the mobile viewport", () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({ matches: false });
    render(<InstallPrompt roles={["student"]} />);
    fireBeforeInstallPrompt();
    expect(screen.queryByText(/add vidya to your home screen/i)).not.toBeInTheDocument();
  });

  it("is shown-once: persists on show, not just on dismissal, and never returns", async () => {
    const { unmount } = render(<InstallPrompt roles={["student"]} />);
    fireBeforeInstallPrompt();
    expect(await screen.findByText(/add vidya to your home screen/i)).toBeInTheDocument();
    expect(localStorage.getItem("vidya-a2hs-seen")).toBe("1");

    unmount();
    render(<InstallPrompt roles={["student"]} />);
    fireBeforeInstallPrompt();
    expect(screen.queryByText(/add vidya to your home screen/i)).not.toBeInTheDocument();
  });

  it("Install calls the deferred browser prompt and dismisses", async () => {
    render(<InstallPrompt roles={["teacher"]} />);
    const prompt = fireBeforeInstallPrompt();
    fireEvent.click(await screen.findByRole("button", { name: /^install$/i }));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/add vidya to your home screen/i)).not.toBeInTheDocument());
  });

  it("Not now dismisses without calling the browser prompt", async () => {
    render(<InstallPrompt roles={["teacher"]} />);
    const prompt = fireBeforeInstallPrompt();
    fireEvent.click(await screen.findByRole("button", { name: /not now/i }));
    expect(screen.queryByText(/add vidya to your home screen/i)).not.toBeInTheDocument();
    expect(prompt).not.toHaveBeenCalled();
  });
});
