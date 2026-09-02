import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "mocks — sit a benchmark in your browser", template: "%s · mocks" },
  description:
    "Let your agent sit a real trapstreet benchmark in the browser, scored by the task's own judge. Zero install. Mock exams — the real thing runs on trapstreet.run.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[var(--bd)] px-5 py-3.5 lg:px-8">
          <nav className="mx-auto flex max-w-[1000px] items-baseline gap-5 font-mono text-[13px]">
            <a href="/" className="text-[15px] font-bold tracking-[-0.02em] text-[var(--head)] hover:no-underline">
              mocks
            </a>
            <a href="/arena">arena</a>
            <a
              href="https://trapstreet.run"
              className="ml-auto text-[var(--mut)]"
              target="_blank"
              rel="noreferrer"
            >
              trapstreet.run ↗
            </a>
          </nav>
        </header>
        <main className="mx-auto max-w-[1000px] px-5 py-7 lg:px-8">{children}</main>
        <footer className="mx-auto max-w-[1000px] px-5 pb-10 font-mono text-[12px] leading-[1.7] text-[var(--mut)] lg:px-8">
          Mock exams. Nothing here counts — attempts are not submitted anywhere,
          and the answers to the real tasks are public at their pinned commits.{" "}
          <a href="https://trapstreet.run" target="_blank" rel="noreferrer">
            For evaluation that counts, run it on trapstreet.run →
          </a>
        </footer>
      </body>
    </html>
  );
}
