/** Time-of-day greeting shared by the home screen and tests. */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return '早上好';
  if (hour >= 11 && hour < 13) return '中午好';
  if (hour >= 13 && hour < 18) return '下午好';
  if (hour >= 18 && hour < 23) return '晚上好';
  return '夜深了';
}

export function homeGreeting(name: string, date: Date): string {
  return `${greetingFor(date)}，${name}。`;
}
