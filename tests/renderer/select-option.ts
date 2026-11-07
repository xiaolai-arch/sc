import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Picks an option from the app's custom Select: opens the trigger by its
 * accessible name, then clicks the option whose visible label matches.
 */
export async function pickOption(
  label: string,
  optionName: string | RegExp
): Promise<void> {
  const trigger = await screen.findByRole('combobox', { name: label });
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
}