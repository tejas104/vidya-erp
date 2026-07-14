import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
