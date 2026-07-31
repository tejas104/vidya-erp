import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "@vidya/ui-system/tokens.css";
import "./globals.css";

/*
 * Fonts are fetched at BUILD time and self-hosted from the app's own origin —
 * zero runtime CDN, which the on-prem deployment requires (ADR-0009; the
 * reference's Google-Fonts @import would be CSP-blocked). Inter is the
 * interface face; IBM Plex Mono carries every figure.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vidya — the register",
  description: "Attendance, marks and at-risk analytics, scoped to what you may see.",
};

/** Applies the saved theme before paint so there is no flash of the wrong mode. */
const themeScript = `(function(){try{var t=localStorage.getItem("vidya-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

// Registers the static-asset-only service worker (see public/sw.js). Runs
// after load so it never competes with the first paint; failures are
// swallowed — a missing/broken SW must never block the app from working,
// it is a pure enhancement.
const swScript = `if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){});});}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#4a5bd8" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        {/* iOS ignores the manifest for A2HS; these are its own equivalent. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Vidya" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: swScript }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
