import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Types a prompt into the chat composer and sends it. */
export async function sendPrompt(prompt: string): Promise<void> {
  await userEvent.type(screen.getByLabelText('向阿咲提问'), prompt);
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
}
