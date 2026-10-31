import type { TaskStatus } from '../../shared/types';

export type WorkspaceKind = 'exam' | 'study' | 'project' | 'life';

export type Workspace = {
  id: string;
  name: string;
  kind: WorkspaceKind;
  color: string;
  goal: string;
  description: string;
};

export type WorkspaceTask = {
  id: string;
  workspaceId: string;
  title: string;
  subject: string;
  durationMin: number;
  acceptance: string;
  status: TaskStatus;
  actualMin?: number;
};

export type NoteBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'ul'; items: string[] };

export type WorkspaceNote = {
  id: string;
  workspaceId: string;
  title: string;
  subject: string;
  tags: string[];
  updated: string;
  summary: string;
  blocks: NoteBlock[];
  related: string[];
};

export type PracticeQuestion = {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
};

export type PracticeSet = {
  id: string;
  workspaceId: string;
  title: string;
  subject: string;
  questions: PracticeQuestion[];
};

export type MemoryItem = {
  id: string;
  workspaceId: string;
  text: string;
  source: string;
};

export type Reminder = {
  id: string;
  time: string;
  label: string;
};

export const workspaces: Workspace[] = [
  {
    id: 'kaoyan',
    name: '考研',
    kind: 'exam',
    color: '#0071e3',
    goal: '2027 考研：数学一 / 英语一 / 政治',
    description: '每天 300 分钟，先把基础打牢'
  },
  {
    id: 'english',
    name: '英语',
    kind: 'study',
    color: '#34c759',
    goal: '读懂外刊，写作更自然',
    description: '每周 3 次精读 + 每日单词'
  },
  {
    id: 'project',
    name: '项目',
    kind: 'project',
    color: '#ff9f0a',
    goal: '个人网站本月上线 v1',
    description: '需求 → 静态首页 → 部署'
  },
  {
    id: 'life',
    name: '生活',
    kind: 'life',
    color: '#a13ff6',
    goal: '规律作息 + 每周 3 次运动',
    description: '23:30 前睡，记录每日状态'
  }
];

export const demoTasks: WorkspaceTask[] = [
  {
    id: 'k1',
    workspaceId: 'kaoyan',
    title: '极限与连续',
    subject: '数学',
    durationMin: 45,
    acceptance: '完成 10 题，并整理错题',
    status: 'pending'
  },
  {
    id: 'k2',
    workspaceId: 'kaoyan',
    title: '阅读理解',
    subject: '英语',
    durationMin: 30,
    acceptance: '精读 1 篇，标出长难句',
    status: 'pending'
  },
  {
    id: 'k3',
    workspaceId: 'kaoyan',
    title: '马原第一章',
    subject: '政治',
    durationMin: 30,
    acceptance: '过一遍框架，做 10 道题',
    status: 'pending'
  },
  {
    id: 'e1',
    workspaceId: 'english',
    title: '外刊精读',
    subject: '英语',
    durationMin: 30,
    acceptance: '精读 1 篇，摘 5 个表达',
    status: 'pending'
  },
  {
    id: 'e2',
    workspaceId: 'english',
    title: '单词 30 个',
    subject: '词汇',
    durationMin: 15,
    acceptance: '复习 + 新词',
    status: 'done'
  },
  {
    id: 'p1',
    workspaceId: 'project',
    title: '整理需求',
    subject: '项目',
    durationMin: 30,
    acceptance: '列出 v1 三个页面',
    status: 'pending'
  },
  {
    id: 'p2',
    workspaceId: 'project',
    title: '搭首页',
    subject: '开发',
    durationMin: 60,
    acceptance: '完成静态布局',
    status: 'in-progress'
  },
  {
    id: 'l1',
    workspaceId: 'life',
    title: '运动 30 分钟',
    subject: '健康',
    durationMin: 30,
    acceptance: '快走或力量训练',
    status: 'pending'
  },
  {
    id: 'l2',
    workspaceId: 'life',
    title: '23:30 前睡',
    subject: '作息',
    durationMin: 0,
    acceptance: '睡前不刷手机',
    status: 'pending'
  }
];

export const demoNotes: WorkspaceNote[] = [
  {
    id: 'n1',
    workspaceId: 'kaoyan',
    title: '极限的定义与性质',
    subject: '数学',
    tags: ['极限', '定义'],
    updated: '10月30日',
    summary: 'ε-δ 定义、局部有界性、保号性；做题前先确认极限存在。',
    blocks: [
      { kind: 'p', text: '极限是描述“无限接近”的工具。数一基础阶段先把定义、性质和常见等价无穷小串起来。' },
      { kind: 'h2', text: '核心定义' },
      { kind: 'p', text: '对任意 ε > 0，存在 δ > 0，使得当 0 < |x - x0| < δ 时，|f(x) - L| < ε，则称 f 在 x0 处极限为 L。' },
      { kind: 'h2', text: '易错点' },
      { kind: 'ul', items: ['先判断极限是否存在，再套用运算法则。', '等价无穷小替换只适用于乘除，不要直接用在加减。', '洛必达法则使用前确认 0/0 或 ∞/∞，且导数极限存在。'] }
    ],
    related: ['n4']
  },
  {
    id: 'n2',
    workspaceId: 'kaoyan',
    title: '长难句拆分：定语从句',
    subject: '英语',
    tags: ['长难句', '阅读'],
    updated: '10月29日',
    summary: '先找主句主谓，再把 that/which/who 引导的从句括起来。',
    blocks: [
      { kind: 'p', text: '读长难句时不要逐词翻译。先找主句的主语和谓语，再处理从句和插入语。' },
      { kind: 'h2', text: '三步法' },
      { kind: 'ul', items: ['找主句主谓。', '把 that / which / who 引导的从句括起来。', '把修饰成分放回主句，检查逻辑。'] },
      { kind: 'p', text: '例：The book that I bought yesterday is more useful than I expected. 主句是 The book is more useful...，that 从句修饰 book。' }
    ],
    related: ['n6']
  },
  {
    id: 'n3',
    workspaceId: 'kaoyan',
    title: '马原：矛盾论',
    subject: '政治',
    tags: ['马原', '辩证法'],
    updated: '10月28日',
    summary: '矛盾的同一性与斗争性；普遍性与特殊性；主要矛盾与次要矛盾。',
    blocks: [
      { kind: 'h2', text: '两个基本属性' },
      { kind: 'p', text: '同一性指矛盾双方相互依存、相互贯通；斗争性指相互排斥、相互分离。' },
      { kind: 'h2', text: '方法论' },
      { kind: 'ul', items: ['具体问题具体分析。', '抓主要矛盾，同时兼顾次要矛盾。', '在对立中把握统一，在统一中把握对立。'] }
    ],
    related: []
  },
  {
    id: 'n4',
    workspaceId: 'kaoyan',
    title: '错题：洛必达法则的适用条件',
    subject: '数学',
    tags: ['错题', '极限'],
    updated: '10月30日',
    summary: '不是所有 0/0 都能直接用；先确认可导、导函数极限存在。',
    blocks: [
      { kind: 'p', text: '错因：看到 0/0 就直接求导，忽略了“导函数极限存在”这个条件。' },
      { kind: 'h2', text: '正确检查顺序' },
      { kind: 'ul', items: ['确认是 0/0 或 ∞/∞。', '确认分子分母在去心邻域内可导。', '确认导函数比值的极限存在（或为 ∞）。'] }
    ],
    related: ['n1']
  },
  {
    id: 'n5',
    workspaceId: 'english',
    title: '外刊表达：be poised to',
    subject: '英语',
    tags: ['外刊', '表达'],
    updated: '10月30日',
    summary: 'be poised to do = 准备好/即将做；适合写趋势和预测。',
    blocks: [
      { kind: 'p', text: '例句：The industry is poised to enter a new phase of growth.' },
      { kind: 'p', text: '可替换：be about to / be set to；写作里用于引出趋势，比 will 更有画面感。' }
    ],
    related: ['n2']
  },
  {
    id: 'n6',
    workspaceId: 'english',
    title: '写作模板：观点对比',
    subject: '写作',
    tags: ['写作', '模板'],
    updated: '10月27日',
    summary: '引入双方观点 → 各自论据 → 自己的立场；避免模板句堆砌。',
    blocks: [
      { kind: 'h2', text: '结构' },
      { kind: 'ul', items: ['引入：While some argue..., others believe...', '展开：具体例子 + 因果。', '立场：In my view..., because...'] }
    ],
    related: ['n5']
  },
  {
    id: 'n7',
    workspaceId: 'project',
    title: '个人网站 v1 需求',
    subject: '项目',
    tags: ['需求', 'v1'],
    updated: '10月30日',
    summary: '三个页面：首页、项目列表、关于；先静态，再考虑 CMS。',
    blocks: [
      { kind: 'h2', text: 'v1 范围' },
      { kind: 'ul', items: ['首页：一句话定位 + 三个项目卡片。', '项目列表：标题、简介、链接。', '关于：简介 + 联系方式。'] },
      { kind: 'p', text: '先不做后台和登录，内容直接写在 markdown 里。' }
    ],
    related: ['n8']
  },
  {
    id: 'n8',
    workspaceId: 'project',
    title: '技术选型：静态优先',
    subject: '技术',
    tags: ['技术', '决策'],
    updated: '10月29日',
    summary: 'Vite + React + markdown；避免过早引入数据库。',
    blocks: [
      { kind: 'p', text: '目标是本月上线，优先选择熟悉的工具，减少部署复杂度。' },
      { kind: 'ul', items: ['Vite + React + TypeScript。', '内容用 markdown，构建时生成。', '部署到静态托管，后续再加评论/搜索。'] }
    ],
    related: ['n7']
  },
  {
    id: 'n9',
    workspaceId: 'life',
    title: '睡眠记录：10月',
    subject: '习惯',
    tags: ['睡眠', '习惯'],
    updated: '10月31日',
    summary: '连续 3 天 23:30 前睡；早上精神状态明显更好。',
    blocks: [
      { kind: 'p', text: '10月29日 23:10 入睡；10月30日 23:20；10月31日 23:00。' },
      { kind: 'p', text: '睡前把手机放到客厅，第二天起床更轻松。继续保持。' }
    ],
    related: []
  }
];

export const demoPracticeSets: PracticeSet[] = [
  {
    id: 'ps1',
    workspaceId: 'kaoyan',
    title: '极限基础 3 题',
    subject: '数学',
    questions: [
      {
        id: 'q1',
        prompt: '当 x→0 时，sin x / x 的极限是？',
        options: ['0', '1', '∞', '不存在'],
        answer: 1,
        explanation: '这是第一个重要极限，sin x / x → 1。'
      },
      {
        id: 'q2',
        prompt: '下列哪一项通常是 0/0 型未定式？',
        options: ['x / (x + 1) 当 x→0', 'sin x / x 当 x→0', '(e^x - 1) / x 当 x→0', 'x^2 当 x→1'],
        answer: 2,
        explanation: 'x→0 时 e^x - 1 → 0，分母 x → 0，所以是 0/0 型。'
      },
      {
        id: 'q3',
        prompt: '使用洛必达法则前，必须确认什么？',
        options: ['函数是连续的', '分母不为 0', '导函数比值的极限存在', '函数是单调的'],
        answer: 2,
        explanation: '洛必达法则要求导函数比值的极限存在（或为 ∞），否则不能直接下结论。'
      }
    ]
  },
  {
    id: 'ps2',
    workspaceId: 'kaoyan',
    title: '马原易错 3 题',
    subject: '政治',
    questions: [
      {
        id: 'p1',
        prompt: '矛盾的两个基本属性是？',
        options: ['普遍性和特殊性', '同一性和斗争性', '主要方面和次要方面', '内因和外因'],
        answer: 1,
        explanation: '矛盾的基本属性是同一性和斗争性。'
      },
      {
        id: 'p2',
        prompt: '“具体问题具体分析”体现的是？',
        options: ['矛盾的普遍性', '矛盾的特殊性', '矛盾的同一性', '矛盾的斗争性'],
        answer: 1,
        explanation: '具体问题具体分析是矛盾特殊性的方法论要求。'
      },
      {
        id: 'p3',
        prompt: '量变和质变的关系是？',
        options: ['量变必然立即引起质变', '质变与量变无关', '量变是质变的必要准备，质变是量变的必然结果', '只有质变有意义'],
        answer: 2,
        explanation: '量变积累到一定程度引起质变，质变又为新的量变开辟道路。'
      }
    ]
  },
  {
    id: 'ps3',
    workspaceId: 'english',
    title: '长难句 3 题',
    subject: '英语',
    questions: [
      {
        id: 'e1',
        prompt: 'The book that I bought yesterday is more useful than I expected. 主句的主语是？',
        options: ['The book', 'that', 'I', 'yesterday'],
        answer: 0,
        explanation: '主句是 The book is more useful...，that 从句修饰 book。'
      },
      {
        id: 'e2',
        prompt: 'Not until midnight ____ the work.',
        options: ['he finished', 'did he finish', 'he did finish', 'finished he'],
        answer: 1,
        explanation: 'Not until 位于句首，主句用部分倒装：did he finish。'
      },
      {
        id: 'e3',
        prompt: 'Despite the rain, the match continued. “Despite the rain” 在句中作？',
        options: ['主语', '让步状语', '宾语', '定语'],
        answer: 1,
        explanation: 'Despite 引导让步状语，表示“尽管下雨”。'
      }
    ]
  }
];

export const demoMemory: MemoryItem[] = [
  {
    id: 'm1',
    workspaceId: 'kaoyan',
    text: '极限定义还不稳，建议先复习再做新题。',
    source: '10月30日复盘'
  },
  {
    id: 'm2',
    workspaceId: 'kaoyan',
    text: '英语阅读速度偏慢，先练长难句主干。',
    source: '10月29日复盘'
  },
  {
    id: 'm3',
    workspaceId: 'english',
    text: '外刊表达积累有效，继续保持。',
    source: '10月30日记录'
  },
  {
    id: 'm4',
    workspaceId: 'project',
    text: '首页先做静态版，避免过度设计。',
    source: '10月29日记录'
  },
  {
    id: 'm5',
    workspaceId: 'life',
    text: '连续 3 天 23:30 前睡，保持。',
    source: '10月31日记录'
  }
];

export const demoReminders: Reminder[] = [
  { id: 'r1', time: '08:00', label: '早间计划' },
  { id: 'r2', time: '21:30', label: '晚间复盘' },
  { id: 'r3', time: '23:00', label: '免打扰' }
];

export const demoStreak = 3;

export function workspaceName(workspacesList: Workspace[], workspaceId: string | null) {
  if (!workspaceId) return '全部工作区';
  return workspacesList.find((workspace) => workspace.id === workspaceId)?.name ?? '全部工作区';
}

export function workspaceColor(workspacesList: Workspace[], workspaceId: string | null) {
  if (!workspaceId) return '#8e8e93';
  return workspacesList.find((workspace) => workspace.id === workspaceId)?.color ?? '#8e8e93';
}
