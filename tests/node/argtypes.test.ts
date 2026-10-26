import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ArgTypeInference } from '../../src/node/server/argtypes';
import { tempProject } from '../helpers/project';

describe('prop type inference (FR-4.3)', () => {
  it('infers controls from component props', async () => {
    const root = await tempProject({
      'tsconfig.json': '{ "compilerOptions": { "jsx": "react-jsx", "strict": true, "moduleResolution": "bundler", "module": "esnext" } }',
      'Card.tsx': `import type { ReactNode } from 'react';
export interface CardProps {
  /** Shown as the heading. */
  title: string;
  /** @default 3 */
  count?: number;
  open: boolean;
  tone: 'info' | 'warning' | 'error' | 'success' | 'neutral';
  size?: 'sm' | 'md';
  accentColor?: string;
  created?: Date;
  tags?: string[];
  children?: ReactNode;
  onSelect?: (id: string) => void;
  flag?: true | false;
}
export async function Card(props: CardProps) { return null; }`,
      'Card.stories.tsx': `import { Card } from './Card'; const meta = { component: Card }; export default meta; export const A = {};`,
      'Plain.stories.tsx': `export default { title: 'x' }; export const A = {};`,
    });
    const inference = new ArgTypeInference(root, createRequire(path.join(root, 'package.json')), path.join(root, 'tsconfig.json'));
    const types = inference.infer(path.join(root, 'Card.stories.tsx'))!;
    expect(types.title).toMatchObject({ control: 'text', required: true, description: 'Shown as the heading.' });
    expect(types.count).toMatchObject({ control: 'number', required: false, defaultValue: '3' });
    expect(types.open!.control).toBe('boolean');
    expect(types.tone).toMatchObject({ control: 'select', options: ['info', 'warning', 'error', 'success', 'neutral'] });
    expect(types.size).toMatchObject({ control: 'radio', options: ['sm', 'md'] });
    expect(types.accentColor!.control).toBe('color');
    expect(types.created!.control).toBe('date');
    expect(types.tags!.control).toBe('object');
    expect(types.children!.control).toBe(false);
    expect(types.onSelect).toMatchObject({ control: false, action: true });
    expect(types.flag!.control).toBe('boolean');
    expect(inference.infer(path.join(root, 'Plain.stories.tsx'))).toBeUndefined();
    const noTs = new ArgTypeInference(root, (() => {
      throw new Error('no typescript');
    }) as unknown as NodeJS.Require);
    expect(noTs.infer(path.join(root, 'Card.stories.tsx'))).toBeUndefined();
  });
});
