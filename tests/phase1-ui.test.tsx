import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../src/renderer/app/App';

describe('phase 1 visual shell', () => {
  it('renders the command bar, compact auth status, and exactly four session bay articles', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Claude Command Deck' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Connect Authentication/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it('opens the settings shell from the command bar', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(within(dialog).getByRole('button', { name: 'Authentication' })).toBeInTheDocument();
    expect(within(dialog).getByText('Schema v1')).toBeInTheDocument();
  });
});
