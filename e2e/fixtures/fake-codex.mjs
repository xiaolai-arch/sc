#!/usr/bin/env node
/**
 * Fake `codex exec` used only by the Playwright Electron e2e suite.
 *
 * CliAgentClient runs `codex exec --skip-git-repo-check -` and feeds the prompt
 * on stdin. This fixture answers deterministically and never touches the
 * network, so tests can exercise the real IPC/butler wiring without keys.
 */
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  prompt += chunk;
}

if (prompt.includes('只输出一个 JSON 对象')) {
  // generateTodayPlan() path: a bare JSON object is accepted by the planner.
  process.stdout.write(
    `${JSON.stringify({
      tasks: [
        {
          title: '假模型任务：精读一篇',
          subject: '英语',
          durationMin: 30,
          acceptance: '整理 5 个表达',
          materialRefs: []
        }
      ]
    })}\n`
  );
} else if (/任务：共 [1-9]\d* 项/.test(prompt)) {
  process.stdout.write('假模型回复：已读取本地任务，先完成今天的第一项。\n');
} else {
  process.stdout.write('假模型回复：还没有看到今天的任务。\n');
}
