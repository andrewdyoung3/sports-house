import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Navbar } from '@/components/layout/navbar';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Sports House',
    template: '%s | Sports House',
  },
  description: 'Your teams. Your sports. All in one place. Personalized schedules, live scores, AI matchup previews, and breaking news.',
  keywords: ['sports', 'NFL', 'NBA', 'MLB', 'NHL', 'Premier League', 'scores', 'schedule'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans bg-zinc-950 text-zinc-50 antialiased`}>
        <Navbar />
        {/* Top padding offsets the fixed navbar */}
        <main className="pt-14 min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
