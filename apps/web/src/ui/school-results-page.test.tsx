import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@vidya/ui-system";
import { SchoolResultsPage } from "./SchoolResultsPage";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, colleges: vi.fn(), session: vi.fn(), resScales: vi.fn(), resCreateScale: vi.fn(), resDeleteScale: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [{ id: "col_school", name: "Sunrise" }] });
  (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "u_admin", displayName: "Admin", roles: ["admin"], grants: [] });
  (api.resScales as ReturnType<typeof vi.fn>).mockResolvedValue({ scales: [] });
  (api.resCreateScale as ReturnType<typeof vi.fn>).mockImplementation(async (input) => ({ id: "scale_1", ...input, locked: false }));
});

function renderPage() { return render(<ToastProvider><SchoolResultsPage /></ToastProvider>); }

describe("school results desk", () => {
  it("shows the school workflow without college SGPA or credits", async () => {
    renderPage();
    expect(await screen.findByText("No grading rule yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Academic terms/ })).toHaveAttribute("href", "/manage/terms");
    expect(screen.getByRole("link", { name: /Report cards/ })).toHaveAttribute("href", "/manage/report-cards");
    expect(screen.queryByText(/SGPA|subject credits/i)).not.toBeInTheDocument();
  });

  it("saves a valid scale and blocks an invalid band", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New grade scale" }));
    fireEvent.change(screen.getByLabelText("Band 7 minimum %"), { target: { value: "5" } });
    expect(screen.getByRole("button", { name: "Save scale" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Band 7 minimum %"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save scale" }));
    await waitFor(() => expect(api.resCreateScale).toHaveBeenCalledWith(expect.objectContaining({ collegeId: "col_school", name: "School grades" })));
  });

  it("shows grading rules without admin controls to a principal", async () => {
    (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "u_principal", displayName: "Principal", roles: ["principal"], grants: [] });
    renderPage();
    expect(await screen.findByText("No grading rule yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New grade scale" })).not.toBeInTheDocument();
  });
});
