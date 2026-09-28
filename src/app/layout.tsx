import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ShortForge AI — AI YouTube Shorts Automation Platform',
    template: '%s · ShortForge AI',
  },
  description:
    'Turn one idea into a finished YouTube Short. AI scriptwriting, voiceover, visuals, captions, SEO and video rendering — automated in one workflow.',
  keywords: ['YouTube Shorts', 'AI video', 'short form video', 'faceless channel', 'video automation'],
  authors: [{ name: 'ShortForge AI' }],
  openGraph: {
    title: 'ShortForge AI',
    description: 'Turn One Idea Into a Finished YouTube Short.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#050506',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <a
          href="#main"
          className="sr-only-focusable fixed left-4 top-4 z-[100] rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
