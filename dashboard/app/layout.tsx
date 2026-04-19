import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Job Search Agent",
  description: "Personal job-search dashboard — scraped feed + LLM-ranked against your resume.",
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      {children}
    </a>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-8">
            <a href="/" className="font-semibold tracking-tight">
              job-search-agent
            </a>
            <nav className="flex items-center gap-6">
              <NavLink href="/">Feed</NavLink>
              <NavLink href="/resume">Resume</NavLink>
              <NavLink href="/pipeline">Pipeline</NavLink>
              <NavLink href="/settings">Settings</NavLink>
            </nav>
          </div>
        </header>
        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
