import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Spectral, Source_Serif_4, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// 案台 three-voice type. next/font self-hosts these at build (no runtime CDN). CN glyphs fall back to
// a system Song/Hei face via the var() chains in globals.css until a self-hosted CN webfont is added.
const spectral = Spectral({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-spectral', display: 'swap' });
const sourceSerif = Source_Serif_4({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-source-serif', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jb-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Hotspot Writer',
  description: 'Local-first hotspot content workflow',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const fontVars = `${spectral.variable} ${sourceSerif.variable} ${inter.variable} ${jetbrainsMono.variable}`;
  return (
    <html lang="zh" className={fontVars}>
      <body>{children}</body>
    </html>
  );
}
