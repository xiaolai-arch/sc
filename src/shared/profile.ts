import { z } from 'zod';
import type { ExamProfile } from './types';

const subjectSchema = z.object({
  name: z.string().min(1, '请填写科目名称'),
  code: z.string().optional(),
  syllabusRef: z.string().optional()
});

const examProfileSchema = z.object({
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '请选择有效的考试日期'),
  targetSchool: z.string().optional(),
  targetMajor: z.string().optional(),
  subjects: z.array(subjectSchema).min(1, '至少选择一门考试科目'),
  dailyMinutes: z
    .number()
    .int('每天可用分钟数需为整数')
    .min(30, '每天可用分钟数需在 30–720 之间')
    .max(720, '每天可用分钟数需在 30–720 之间'),
  currentLevel: z.string().min(1, '请选择当前水平')
});

export function validateExamProfile(input: unknown): ExamProfile {
  const result = examProfileSchema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(message);
  }
  return result.data;
}
