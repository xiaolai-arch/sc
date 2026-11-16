import { useEffect, useMemo, useState } from 'react';
import type { LocalCliModelOption } from '../../shared/local-cli';
import { optionLabel } from '../local-cli-models';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Select } from '../ui/Select';

type ModelPickerDialogProps = {
  open: boolean;
  /** What the conversation uses when no override is set. */
  globalModel: string;
  initialModel: string;
  /** Models the local CLI configuration already knows about. */
  options?: LocalCliModelOption[];
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (model: string) => void;
};

const CUSTOM_VALUE = '__custom__';

export function ModelPickerDialog({
  open,
  globalModel,
  initialModel,
  options = [],
  saving = false,
  error = null,
  onClose,
  onSave
}: ModelPickerDialogProps) {
  const [text, setText] = useState('');
  /** Set when the user explicitly picked "custom", even before typing. */
  const [customMode, setCustomMode] = useState(false);

  useEffect(() => {
    if (open) {
      setText(initialModel);
      setCustomMode(false);
    }
  }, [open, initialModel]);

  const trimmed = text.trim();
  const known = useMemo(
    () => options.some((option) => option.id === trimmed),
    [options, trimmed]
  );
  // An override saved earlier may not appear in today's local config; keep it
  // visible and editable instead of silently resetting it to "inherit".
  const custom = customMode || (trimmed !== '' && !known);
  const selectValue = custom ? CUSTOM_VALUE : trimmed;

  function submit() {
    if (saving) return;
    onSave(text.trim());
  }

  return (
    <Dialog open={open} onClose={onClose} title="本对话模型">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Label htmlFor="conversation-model">模型</Label>
        {options.length > 0 ? (
          <>
            <Select
              id="conversation-model"
              value={selectValue}
              onChange={(event) => {
                const next = event.target.value;
                if (next === CUSTOM_VALUE) {
                  setCustomMode(true);
                  if (known) setText('');
                  return;
                }
                setCustomMode(false);
                setText(next);
              }}
            >
              <option value="">跟随全局（{globalModel}）</option>
              {options.map((option) => (
                <option key={`${option.origin}:${option.id}`} value={option.id}>
                  {optionLabel(option)}
                </option>
              ))}
              <option value={CUSTOM_VALUE}>自定义模型 ID…</option>
            </Select>
            {custom || selectValue === CUSTOM_VALUE ? (
              <Input
                className="mt-2"
                aria-label="自定义模型 ID"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="填写 CLI/API 支持的模型 ID"
              />
            ) : null}
          </>
        ) : (
          <Input
            id="conversation-model"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={`跟随全局（${globalModel}）`}
          />
        )}
        <p className="mt-2 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
          {options.length > 0
            ? '列表来自本机 CLI 已配置的模型；留空跟随全局设置。'
            : '填写 CLI/API 支持的模型 ID；留空跟随全局设置。'}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-[13px] text-[#d70015] dark:text-[#ff7b72]">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? '正在保存…' : '保存'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
