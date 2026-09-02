import type { Metadata } from "next";
import { Archivo, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

// Atlas's two faces, the same pair trapstreet.run uses. next/font self-hosts
// both at build time, so there is no runtime request to Google and no layout
// shift beyond the swap. The weights are the ones actually used.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-archivo",
});

const spline = Spline_Sans_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-spline",
});

export const metadata: Metadata = {
  title: { default: "mocks — sit a benchmark in your browser", template: "%s · mocks" },
  description:
    "Let your agent sit a real trapstreet benchmark in the browser, scored by the task's own judge. Zero install. Mock exams — the real thing runs on trapstreet.run.",
};

const NAV = [
  { href: "/", label: "tasks" },
  { href: "/arena", label: "arena" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${spline.variable}`}>
      <body className="flex min-h-screen flex-col antialiased">
        {/* The platform's chrome, rebuilt rather than imported: trapstreet's
            header carries auth, search, a drawer and an i18n table, none of
            which exist here. What is copied is the shape — a 58px mono bar
            with the wordmark in tracked caps — because that is what makes
            this page read as part of the same site. */}
        <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-1 flex-col border-[var(--bd)] lg:border-x">
          <header className="sticky top-0 z-40 border-b border-[var(--bd)] bg-[var(--bg)] font-mono text-[13px]">
            <div className="flex h-[58px] items-center justify-between gap-4 px-4 lg:px-7">
              <div className="flex items-center gap-5 lg:gap-[30px]">
                <a
                  href="/"
                  className="shrink-0 font-semibold tracking-[0.08em] text-[var(--head)] hover:no-underline"
                >
                  MOCKS
                </a>
                <nav aria-label="Sections" className="flex items-center gap-5 lowercase">
                  {NAV.map((n) => (
                    <a
                      key={n.href}
                      href={n.href}
                      className="text-[var(--mut)] hover:text-[var(--head)] hover:no-underline"
                    >
                      {n.label}
                    </a>
                  ))}
                </nav>
              </div>

              <a
                href="https://trapstreet.run"
                target="_blank"
                rel="noreferrer"
                className="shrink-0 bg-[var(--acc)] px-3.5 py-2 font-sans text-[13px] font-semibold text-[var(--onacc)] hover:no-underline"
              >
                trapstreet.run ↗
              </a>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1000px] flex-1 px-4 py-7 lg:px-7">
            {children}
          </main>

          <footer className="border-t border-[var(--bd)]">
            <div className="flex w-full flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-4 py-4 font-mono text-[12px] leading-[1.7] text-[var(--mut)] lg:px-7">
              <p className="font-semibold text-[var(--sec)]">mocks</p>
              <p className="max-w-[62ch]">
                Mock exams. Attempts are recorded here and nowhere else, and
                the answers to these tasks are public at their pinned commits,
                so a score here is practice.{" "}
                <a href="https://trapstreet.run" target="_blank" rel="noreferrer">
                  For evaluation that counts, run it on trapstreet.run →
                </a>
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
