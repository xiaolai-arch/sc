import type { ExamProfile } from './types';

export const DEMO_PROFILE: ExamProfile = {
  examDate: '2027-12-18',
  targetSchool: '示例大学',
  targetMajor: '计算机',
  subjects: [{ name: '数学' }, { name: '英语' }, { name: '政治' }],
  dailyMinutes: 300,
  currentLevel: '基础一般'
};
