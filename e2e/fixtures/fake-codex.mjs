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
if (prompt.includes('TOOL RESULT (plan_workspace)')) {
  // The turn after the planner ran: wrap up with plain text so the butler
  // does not loop into another tool call.
  reply = '排好了，今天只安排这一件，做完就休息。';
} else if (prompt.includes('TOOL RESULT (create_workspace)')) {
  reply = '已创建项目「考研」。今天先做一次摸底，再排 4 周计划。';
} else if (prompt.includes('这天用户说特别满')) {
  // Workspace planner path on a day the user said is packed: the prompt's
  // busy-day clause demands exactly one task of no more than 10 minutes.
  reply = JSON.stringify({
    tasks: [
      {
        title: '满日小事：整理一张错题卡',
        subject: '数学',
        durationMin: 10,
        acceptance: '整理一张错题卡并写下错因',
        materialRefs: []
      }
    ]
  });
} else if (prompt.includes('帮我排一下今天的计划')) {
  // Butler path: hand over to the plan_workspace tool with no arguments, so
  // the date and the minute budget are the app's own decision.
  reply = `\`\`\`json
${JSON.stringify({
  text: '好的，我来排今天的计划。',
  toolCalls: [{ name: 'plan_workspace', arguments: {} }]
})}
\`\`\``;
} else if (prompt.includes('只给我排 45 分钟')) {
  // Butler path with the caller pinning the budget: the tool must not even
  // ask the week availability.
  reply = `\`\`\`json
${JSON.stringify({
  text: '好的，按 45 分钟来排。',
  toolCalls: [{ name: 'plan_workspace', arguments: { availableMinutes: 45 } }]
})}
\`\`\``;
} else if (prompt.includes('我想考研')) {
  reply = `\`\`\`json
${JSON.stringify({
  text: '我先创建考研项目。',
  toolCalls: [
    {
      name: 'create_workspace',
      arguments: {
        name: '考研',
        kind: 'exam',
        goal: '2027 考研上岸',
        description: '由阿咲在对话里创建'
      }
    }
  ]
})}
\`\`\``;
} else if (prompt.includes('只输出一个 JSON 对象')) {
  // Workspace planner path: a bare JSON object is accepted by the parser.
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
      text: prompt.includes('TOOL RESULT (create_workspace)')
        ? '假模型思考：项目已经创建，给出下一步。'
        : '假模型思考：先确认用户目标，再创建项目。'
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
