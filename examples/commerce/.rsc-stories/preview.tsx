import type { Decorator } from 'rsc-stories';
import { inter } from '../src/app/fonts';
import '../src/app/globals.css';

// Mirrors the root layout: the font variable and Tailwind's base styles.
export const decorators: Decorator[] = [
  (Story) => (
    <div className={`${inter.variable} font-sans`}>
      <Story />
    </div>
  ),
];
