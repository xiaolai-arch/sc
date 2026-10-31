import { validateExamProfile } from '../../src/shared/profile';

const valid = {
  examDate: '2027-12-18',
  subjects: [{ name: '数学' }, { name: '英语' }],
  dailyMinutes: 300,
  currentLevel: '基础一般'
};

test('accepts a valid profile', () => {
  expect(validateExamProfile(valid)).toEqual(valid);
});

test('reports field paths for invalid input', () => {
  expect(() => validateExamProfile({ ...valid, dailyMinutes: 10 })).toThrow(/dailyMinutes/);
  expect(() => validateExamProfile({ ...valid, subjects: [] })).toThrow(/subjects/);
  expect(() => validateExamProfile({ ...valid, examDate: '2027/12/18' })).toThrow(/examDate/);
});
