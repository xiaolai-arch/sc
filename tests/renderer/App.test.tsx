// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { App } from '../../src/renderer/App';

test('renders the app name', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Study Coach' })).toBeInTheDocument();
});
