// Global styles and decorators for every story, like the app's root layout.
import '../src/app/globals.css';
import type { Decorator } from 'rsc-stories';

export const decorators: Decorator[] = [
  (Story) => (
    <div style={{ maxWidth: 640 }}>
      <Story />
    </div>
  ),
];

export const parameters = {
  backgrounds: {
    values: [
      { name: 'Paper', value: '#ffffff' },
      { name: 'Mist', value: '#f3f4f6' },
      { name: 'Night', value: '#15171b' },
    ],
  },
};
