import { useEffect, useId, useRef, useState } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
import type {
  CreatePracticeQuestionInput,
  CreatePracticeSetInput,
  PracticeSet
} from '../../shared/practice';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

type QuestionDraft = {
  key: number;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
};

type PracticeSetDialogProps = {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onCreate: (input: CreatePracticeSetInput) => Promise<PracticeSet>;
};

function blankQuestion(key: number): QuestionDraft {
  return {
    key,
    prompt: '',
    options: ['', ''],
    answer: 0,
    explanation: ''
  };
}

export function PracticeSetDialog({
  open,
  workspaceId,
  onClose,
  onCreate
}: PracticeSetDialogProps) {
  const formId = useId();
  const nextKey = useRef(0);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [questions, setQuestions] = useState<QuestionDraft[]>(() => [
    blankQuestion(nextKey.current++)
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setTitle('');
    setSubject('');
    setQuestions([blankQuestion(nextKey.current++)]);
    setError(null);
    setSubmitting(false);
  }

  useEffect(() => {
    if (open) reset();
    // Reset only when the dialog is (re)opened; reset is intentionally local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function updateQuestion(key: number, patch: Partial<QuestionDraft>) {
    setQuestions((current) =>
      current.map((question) => (question.key === key ? { ...question, ...patch } : question))
    );
  }

  function updateOption(questionKey: number, optionIndex: number, value: string) {
    setQuestions((current) =>
      current.map((question) => {
        if (question.key !== questionKey) return question;
        const options = question.options.map((option, index) =>
          index === optionIndex ? value : option
        );
        return { ...question, options };
      })
    );
  }

  function addOption(questionKey: number) {
    setQuestions((current) =>
      current.map((question) =>
        question.key === questionKey && question.options.length < MAX_OPTIONS
          ? { ...question, options: [...question.options, ''] }
          : question
      )
    );
  }

  function removeOption(questionKey: number, optionIndex: number) {
    setQuestions((current) =>
      current.map((question) => {
        if (question.key !== questionKey || question.options.length <= MIN_OPTIONS) {
          return question;
        }
        const options = question.options.filter((_, index) => index !== optionIndex);
        return {
          ...question,
          options,
          answer:
            question.answer >= options.length
              ? options.length - 1
              : question.answer > optionIndex
                ? question.answer - 1
                : question.answer
        };
      })
    );
  }

  function addQuestion() {
    setQuestions((current) => [...current, blankQuestion(nextKey.current++)]);
  }

  function removeQuestion(key: number) {
    setQuestions((current) =>
      current.length <= 1 ? current : current.filter((question) => question.key !== key)
    );
  }

  function validate(): string | null {
    if (!workspaceId) return '缺少工作区信息，暂时无法创建练习集。';
    if (!title.trim()) return '请填写标题。';
    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index];
      const questionLabel = `第 ${index + 1} 题`;
      if (!question.prompt.trim()) return `${questionLabel}的题干不能为空。`;
      if (question.options.length < MIN_OPTIONS) {
        return `${questionLabel}至少需要 ${MIN_OPTIONS} 个选项。`;
      }
      if (question.options.some((option) => !option.trim())) {
        return `${questionLabel}的选项不能为空。`;
      }
      if (
        !Number.isInteger(question.answer) ||
        question.answer < 0 ||
        question.answer >= question.options.length
      ) {
        return `${questionLabel}请选择正确答案。`;
      }
    }
    return null;
  }

  async function submit() {
    if (submitting) return;
    const message = validate();
    if (message) {
      setError(message);
      return;
    }

    const input: CreatePracticeSetInput = {
      workspaceId,
      title: title.trim(),
      subject: subject.trim(),
      questions: questions.map(
        (question): CreatePracticeQuestionInput => ({
          prompt: question.prompt.trim(),
          options: question.options.map((option) => option.trim()),
          answer: question.answer,
          explanation: question.explanation.trim()
        })
      )
    };

    setSubmitting(true);
    setError(null);
    try {
      await onCreate(input);
      reset();
      onClose();
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '创建练习集失败，请重试。'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="新建练习集">
      <div className="space-y-4">
        <div>
          <Label htmlFor={`${formId}-title`}>标题</Label>
          <Input
            id={`${formId}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：极限基础 3 题"
          />
        </div>

        <div>
          <Label htmlFor={`${formId}-subject`}>科目</Label>
          <Input
            id={`${formId}-subject`}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="例如：数学"
          />
        </div>

        <div className="space-y-4">
          {questions.map((question, questionIndex) => {
            const questionNumber = questionIndex + 1;
            const fieldId = `${formId}-q${question.key}`;
            return (
              <fieldset
                key={question.key}
                className="rounded-2xl border border-gray-200/70 p-4 dark:border-white/10"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-semibold text-black dark:text-[#f5f5f7]">
                    第 {questionNumber} 题
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={questions.length <= 1}
                    aria-label={`删除第 ${questionNumber} 题`}
                    onClick={() => removeQuestion(question.key)}
                  >
                    删除题目
                  </Button>
                </div>

                <div className="mt-3">
                  <Label htmlFor={`${fieldId}-prompt`}>第 {questionNumber} 题题干</Label>
                  <Textarea
                    id={`${fieldId}-prompt`}
                    value={question.prompt}
                    onChange={(event) =>
                      updateQuestion(question.key, { prompt: event.target.value })
                    }
                    placeholder="输入题目内容"
                  />
                </div>

                <div className="mt-3 space-y-2">
                  {question.options.map((option, optionIndex) => (
                    <div key={optionIndex} className="flex items-center gap-2">
                      <Input
                        id={`${fieldId}-option-${optionIndex}`}
                        aria-label={`第 ${questionNumber} 题选项 ${optionIndex + 1}`}
                        value={option}
                        onChange={(event) =>
                          updateOption(question.key, optionIndex, event.target.value)
                        }
                        placeholder={`选项 ${String.fromCharCode(65 + optionIndex)}`}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={question.options.length <= MIN_OPTIONS}
                        aria-label={`删除第 ${questionNumber} 题第 ${optionIndex + 1} 个选项`}
                        onClick={() => removeOption(question.key, optionIndex)}
                      >
                        删除
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={question.options.length >= MAX_OPTIONS}
                    onClick={() => addOption(question.key)}
                  >
                    添加选项
                  </Button>
                </div>

                <div className="mt-3">
                  <Label htmlFor={`${fieldId}-answer`}>第 {questionNumber} 题正确答案</Label>
                  <Select
                    id={`${fieldId}-answer`}
                    value={question.answer}
                    onChange={(event) =>
                      updateQuestion(question.key, { answer: Number(event.target.value) })
                    }
                  >
                    {question.options.map((option, optionIndex) => (
                      <option key={optionIndex} value={optionIndex}>
                        {String.fromCharCode(65 + optionIndex)}
                        {option.trim() ? ` · ${option.trim()}` : ''}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="mt-3">
                  <Label htmlFor={`${fieldId}-explanation`}>第 {questionNumber} 题解析</Label>
                  <Textarea
                    id={`${fieldId}-explanation`}
                    value={question.explanation}
                    onChange={(event) =>
                      updateQuestion(question.key, { explanation: event.target.value })
                    }
                    placeholder="可选，答错时展示"
                  />
                </div>
              </fieldset>
            );
          })}
        </div>

        <Button size="sm" variant="secondary" onClick={addQuestion}>
          添加题目
        </Button>

        {error ? (
          <p role="alert" className="text-[13px] text-[#d70015] dark:text-[#ff7b72]">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={submitting} onClick={() => void submit()}>
            {submitting ? '正在创建…' : '创建练习集'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
