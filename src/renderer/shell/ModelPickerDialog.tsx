import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';

type ModelPickerDialogProps = {
  open: boolean;
  globalModel: string;
  initialModel: string;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (model: string) => void;
};

export function ModelPickerDialog({
  open,
  globalModel,
  initialModel,
  saving = false,
  error = null,
  onClose,
  onSave
}: ModelPickerDialogProps) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) setText(initialModel);
  }, [open, initialModel]);

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
        <Label htmlFor="conversation-model">模型 ID</Label>
        <Input
          id="conversation-model"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`跟随全局（${globalModel}）`}
        />
        <p className="mt-2 text-sm text-gray-600 dark:text-[#a1a1a6]">
          填写 CLI/API 支持的模型 ID；留空跟随全局设置。
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-[#d70015] dark:text-[#ff7b72]">
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
