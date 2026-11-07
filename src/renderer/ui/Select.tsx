import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ChangeEventHandler,
  type KeyboardEvent,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { input } from './styles';
import { CheckIcon, ChevronDownIcon } from './icons';

export type SelectSize = 'md' | 'field' | 'sm';

const triggerSizeClasses: Record<SelectSize, string> = {
  md: 'min-h-11 py-3 pl-4 pr-3 text-[14px]',
  field: 'h-10 pl-3 pr-2.5 text-[14px]',
  sm: 'h-9 pl-3 pr-2 text-[13px]'
};

type SelectOption = {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
};

type SelectProps = {
  value?: string | number | readonly string[];
  onChange?: ChangeEventHandler<HTMLSelectElement>;
  disabled?: boolean;
  id?: string;
  className?: string;
  size?: SelectSize;
  fullWidth?: boolean;
  'aria-label'?: string;
  children?: ReactNode;
};

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** Flattens the `<option>` children into the menu model. */
function readOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) {
      return;
    }
    if (child.type !== 'option') return;
    const text = textOf(child.props.children);
    options.push({
      value: child.props.value !== undefined ? String(child.props.value) : text,
      label: child.props.children,
      text,
      disabled: Boolean(child.props.disabled)
    });
  });
  return options;
}

type MenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

/**
 * The app's dropdown: an Apple-style popup menu rendered in a portal so it is
 * never clipped by a card or dialog, while keeping the familiar select
 * semantics (single value, change callback, disabled options).
 */
export function Select({
  value,
  onChange,
  disabled = false,
  id,
  className,
  size = 'md',
  fullWidth = true,
  'aria-label': ariaLabel,
  children
}: SelectProps) {
  const options = readOptions(children);
  const selectedValue = value === undefined ? '' : String(value);
  const selectedIndex = options.findIndex((option) => option.value === selectedValue);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const generatedId = useId();
  const triggerId = id ?? `select-${generatedId}`;
  const listId = `${triggerId}-menu`;
  const optionId = (index: number) => `${triggerId}-option-${index}`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const firstEnabled = (fromStart: boolean): number => {
    if (fromStart) {
      return options.findIndex((option) => !option.disabled);
    }
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (!options[index]!.disabled) return index;
    }
    return -1;
  };

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const estimatedHeight = Math.min(options.length * 38 + 10, 260);
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const openUp = below < estimatedHeight && above > below;
    const available = Math.max(96, openUp ? above : below);
    const width = Math.max(rect.width, 160);
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: openUp ? rect.top - 4 - Math.min(estimatedHeight, available) : rect.bottom + 4,
      width,
      maxHeight: Math.min(260, available)
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
    const onResize = () => updatePosition();
    const onScroll = (event: Event) => {
      const target = event.target;
      if (menuRef.current && target instanceof Node && menuRef.current.contains(target)) {
        return;
      }
      updatePosition();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  function openMenu(fromEnd = false) {
    if (disabled) return;
    const start =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : firstEnabled(!fromEnd);
    setActiveIndex(start);
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
  }

  function choose(option: SelectOption | undefined) {
    if (!option || option.disabled) return;
    onChange?.({
      target: { value: option.value }
    } as unknown as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveActive(delta: number) {
    if (options.length === 0) return;
    let index = activeIndex;
    for (let step = 0; step < options.length; step += 1) {
      index = (index + delta + options.length) % options.length;
      if (!options[index]!.disabled) break;
    }
    setActiveIndex(index);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openMenu();
        else moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openMenu(true);
        else moveActive(-1);
        break;
      case 'Home':
        if (!open) return;
        event.preventDefault();
        setActiveIndex(firstEnabled(true));
        break;
      case 'End':
        if (!open) return;
        event.preventDefault();
        setActiveIndex(firstEnabled(false));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!open) openMenu();
        else choose(options[activeIndex]);
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
        }
        break;
      case 'Tab':
        closeMenu();
        break;
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-40',
          fullWidth && 'w-full',
          input,
          triggerSizeClasses[size],
          className
        )}
      >
        <span
          className={cn(
            'min-w-0 truncate',
            selected ? undefined : 'text-gray-500 dark:text-[#8e8e93]'
          )}
        >
          {selected?.label ?? ''}
        </span>
        <ChevronDownIcon
          className={cn(
            'h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 dark:text-[#8e8e93]',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              style={{
                left: position.left,
                top: position.top,
                width: position.width,
                maxHeight: position.maxHeight
              }}
              className="fixed z-[60] overflow-y-auto rounded-2xl border border-gray-200/70 bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-[#1c1c1e]"
            >
              {options.map((option, index) => (
                <button
                  key={`${option.value}-${index}`}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  data-value={option.value}
                  aria-selected={option.value === selectedValue}
                  disabled={option.disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[13px] leading-5 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
                    index === activeIndex
                      ? 'bg-[#0071e3]/10 text-[#0071e3] dark:bg-[#0a84ff]/20 dark:text-[#4da3ff]'
                      : 'text-[#1d1d1f] hover:bg-black/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]'
                  )}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.value === selectedValue ? (
                    <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                  ) : null}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
