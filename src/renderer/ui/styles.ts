/**
 * Shared Apple-style visual tokens.
 *
 * Page surfaces stay neutral (#f5f5f7 / white), interactive controls get the
 * full press/focus motion treatment, and list rows use a quieter radius than
 * primary action buttons.
 */

export const pageBg = 'bg-[#f5f5f7] dark:bg-[#0f0f10]';
export const surface = 'bg-white dark:bg-[#1c1c1e]';
export const surfaceMuted = 'bg-[#f5f5f7] dark:bg-white/[0.06]';

export const borderColor = 'border border-gray-200/70 dark:border-white/10';

export const card = 'bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm p-6 md:p-8';

export const input =
  'bg-[#f5f5f7] dark:bg-[#242426] rounded-xl text-[#1d1d1f] dark:text-[#f5f5f7] border-0 [color-scheme:light] dark:[color-scheme:dark] placeholder:text-gray-500 dark:placeholder:text-[#8e8e93] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 transition-all duration-200 motion-reduce:transition-none';

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30';

export const motion =
  'transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100';

export const pressable = `${motion} hover:opacity-80 ${focusRing}`;

export const buttonPrimary = `rounded-full font-medium bg-[#0071e3] text-white ${pressable}`;
export const buttonSecondary = `rounded-full font-medium bg-white text-black dark:bg-[#242426] dark:text-[#f5f5f7] ${pressable}`;
export const buttonDanger = `rounded-full font-medium bg-[#d70015] text-white ${pressable}`;
export const buttonGhost = `rounded-full font-medium bg-transparent text-[#0071e3] dark:text-[#4da3ff] ${pressable}`;

export const iconButton = `inline-flex items-center justify-center rounded-full text-gray-500 dark:text-[#8e8e93] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-black dark:hover:text-[#f5f5f7] ${motion} ${focusRing}`;

/** Quiet row for navigation, conversation and task lists — not a pill button. */
export const row = 'rounded-xl transition-colors duration-200';

export const chip = 'inline-flex items-center rounded-full';

export const popover =
  'rounded-2xl bg-white dark:bg-[#1c1c1e] shadow-[0_8px_24px_rgba(0,0,0,0.12)]';

export const link = 'text-[#0071e3] hover:underline dark:text-[#4da3ff]';
