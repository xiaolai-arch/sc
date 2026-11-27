import { butlerToolLabel } from '../../src/shared/butler-stream';

test('labels every tool the chat writes knowledge with', () => {
  expect(butlerToolLabel('record_knowledge')).toBe('记录知识');
  expect(butlerToolLabel('write_note')).toBe('写入笔记');
  expect(butlerToolLabel('unknown_tool')).toBe('unknown_tool');
});

test('labels the week-availability tool instead of showing its raw name', () => {
  // item 66 P2-5: the row reads 「记录周可用性」; before this the missing
  // entry fell back to the English name and the row could not expand.
  expect(butlerToolLabel('set_week_availability')).toBe('记录周可用性');
});
