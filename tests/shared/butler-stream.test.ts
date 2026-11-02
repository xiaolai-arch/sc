import { butlerToolLabel } from '../../src/shared/butler-stream';

test('labels every tool the chat writes knowledge with', () => {
  expect(butlerToolLabel('record_knowledge')).toBe('记录知识');
  expect(butlerToolLabel('write_note')).toBe('写入笔记');
  expect(butlerToolLabel('unknown_tool')).toBe('unknown_tool');
});
