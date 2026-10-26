import type { ReactNode } from 'react';
import { inter } from './fonts';
import './globals.css';

export const metadata = { title: 'Goods & Co — RSC Stories commerce example' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <main className="mx-auto max-w-5xl space-y-8 p-6">{children}</main>
      </body>
    </html>
  );
}
