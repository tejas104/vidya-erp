import type { ReactNode } from "react";
import "@vidya/ui-system/tokens.css";
import "./globals.css";

export const metadata = { title: "Vidya Operator Console — Preview" };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
