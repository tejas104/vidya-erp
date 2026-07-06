import type { Metadata } from "next";
import { Bricolage_Grotesque, Atkinson_Hyperlegible, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/*
 * Fonts are fetched at BUILD time and self-hosted from the app's own origin —
 * zero runtime CDN, which the on-prem deployment requires. The three faces
 * carry the personality: a sturdy characterful display, a body face designed
 * for low-vision legibility (the accessibility floor made visible), and a
 * mono for every figure.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});
const atkinson = Atkinson_Hyperlegible({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-atkinson",
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
    <html lang="en" className={`${bricolage.variable} ${atkinson.variable} ${plexMono.variable}`}>
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
