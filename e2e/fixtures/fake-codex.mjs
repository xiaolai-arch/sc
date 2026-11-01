#!/usr/bin/env node
/**
 * Fake `codex exec` used only by the Playwright Electron e2e suite.
 *
 * CliAgentClient runs `codex exec --skip-git-repo-check -` for one-shot calls
 * and `codex exec --json ...` for the streaming butler path. This fixture
 * answers deterministically and never touches the network.
 */
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  prompt += chunk;
}

const jsonMode = process.argv.includes('--json');

let reply;
if (prompt.includes('只输出一个 JSON 对象')) {
  // generateTodayPlan() path: a bare JSON object is accepted by the planner.
  reply = JSON.stringify({
    tasks: [
      {
        title: '假模型任务：精读一篇',
        subject: '英语',
        durationMin: 30,
        acceptance: '整理 5 个表达',
        materialRefs: []
      }
    ]
  });
} else if (/任务：共 [1-9]\d* 项/.test(prompt)) {
  reply = '假模型回复：已读取本地任务，先完成今天的第一项。';
} else {
  reply = '假模型回复：还没有看到今天的任务。';
}

if (jsonMode) {
  const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  emit({ type: 'thread.started', thread_id: 'fake-codex' });
  emit({ type: 'turn.started' });
  emit({
    type: 'item.completed',
    item: {
      id: 'item_0',
      type: 'reasoning',
      text: '假模型思考：先读取当前任务，再给出下一步。'
    }
  });
  emit({
    type: 'item.completed',
    item: { id: 'item_1', type: 'agent_message', text: reply }
  });
  emit({ type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 } });
} else {
  process.stdout.write(`${reply}\n`);
}
