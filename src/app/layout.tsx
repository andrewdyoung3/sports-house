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
    default: 'SportHouse',
    template: '%s | SportHouse',
  },
  description: 'Your teams. Your sports. All in one place. Personalized schedules, live scores, AI matchup previews, and breaking news.',
  keywords: ['sports', 'NFL', 'NBA', 'MLB', 'NHL', 'Premier League', 'scores', 'schedule'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        {/*
         * Fixed atmospheric bokeh layer — sits behind all content.
         * Large blurred orbs create the depth; small sharp dots add the
         * camera-bokeh sparkle; thin rings suggest 3-D geometry.
         * All elements are pointer-events-none and aria-hidden.
         */}
        <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden select-none" aria-hidden>
          {/* Large drifting orbs — kept subtle so obsidian base dominates */}
          <div style={{ position:'absolute', top:'5%',  left:'8%',  width:'500px', height:'500px', borderRadius:'50%', background:'radial-gradient(circle, rgba(99,36,200,0.07) 0%, transparent 70%)', filter:'blur(80px)', animation:'drift 20s ease-in-out infinite' }} />
          <div style={{ position:'absolute', top:'50%', right:'6%', width:'420px', height:'420px', borderRadius:'50%', background:'radial-gradient(circle, rgba(160,30,200,0.06) 0%, transparent 70%)', filter:'blur(70px)', animation:'drift 14s ease-in-out infinite reverse' }} />
          <div style={{ position:'absolute', bottom:'8%', left:'22%', width:'360px', height:'360px', borderRadius:'50%', background:'radial-gradient(circle, rgba(220,120,40,0.04) 0%, transparent 70%)', filter:'blur(60px)', animation:'drift-slow 26s ease-in-out infinite 4s' }} />
          <div style={{ position:'absolute', top:'28%', left:'50%', width:'280px', height:'280px', borderRadius:'50%', background:'radial-gradient(circle, rgba(30,80,220,0.05) 0%, transparent 70%)', filter:'blur(56px)', animation:'drift 18s ease-in-out infinite 8s reverse' }} />

          {/* Sharp bokeh dots — mimic camera lens out-of-focus highlights */}
          <div style={{ position:'absolute', top:'17%', right:'32%', width:'7px', height:'7px', borderRadius:'50%', background:'rgba(167,139,250,0.70)', filter:'blur(3px)' }} />
          <div style={{ position:'absolute', top:'44%', left:'19%', width:'5px', height:'5px', borderRadius:'50%', background:'rgba(251,146,60,0.60)', filter:'blur(2px)' }} />
          <div style={{ position:'absolute', bottom:'28%', right:'14%', width:'6px', height:'6px', borderRadius:'50%', background:'rgba(99,102,241,0.65)', filter:'blur(3px)' }} />
          <div style={{ position:'absolute', top:'62%', left:'42%', width:'4px', height:'4px', borderRadius:'50%', background:'rgba(236,72,153,0.55)', filter:'blur(2px)' }} />
          <div style={{ position:'absolute', top:'8%',  right:'18%', width:'5px', height:'5px', borderRadius:'50%', background:'rgba(167,139,250,0.50)', filter:'blur(2px)' }} />

          {/* Thin geometry rings */}
          <div style={{ position:'absolute', top:'22%', right:'12%', width:'220px', height:'220px', borderRadius:'50%', border:'1px solid rgba(167,139,250,0.07)', animation:'drift 28s ease-in-out infinite 6s' }} />
          <div style={{ position:'absolute', bottom:'18%', left:'12%', width:'160px', height:'160px', borderRadius:'50%', border:'1px solid rgba(251,146,60,0.06)', animation:'drift-slow 22s ease-in-out infinite 2s reverse' }} />
        </div>

        <Navbar />
        {/* Top padding offsets the fixed navbar */}
        <main className="relative z-10 pt-14 min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
