import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nortiq Revise',
  description: '納品後の修正依頼を、サイト上のクリックで受け付ける',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
