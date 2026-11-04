import { greetingFor, homeGreeting } from '../../src/shared/greeting';

function at(hour: number, minute = 0) {
  return new Date(2026, 10, 4, hour, minute, 0);
}

test('greets the user by time of day', () => {
  expect(greetingFor(at(5))).toBe('早上好');
  expect(greetingFor(at(10, 59))).toBe('早上好');
  expect(greetingFor(at(11))).toBe('中午好');
  expect(greetingFor(at(12, 59))).toBe('中午好');
  expect(greetingFor(at(13))).toBe('下午好');
  expect(greetingFor(at(17, 59))).toBe('下午好');
  expect(greetingFor(at(18))).toBe('晚上好');
  expect(greetingFor(at(22, 59))).toBe('晚上好');
  expect(greetingFor(at(23))).toBe('夜深了');
  expect(greetingFor(at(3))).toBe('夜深了');
});

test('builds the home greeting with the user name', () => {
  expect(homeGreeting('xiaolai', at(9))).toBe('早上好，xiaolai。');
  expect(homeGreeting('xiaolai', at(21))).toBe('晚上好，xiaolai。');
});
