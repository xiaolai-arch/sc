import { useEffect, useId, useMemo, useState } from 'react';
import type { KnowledgeBacklink, KnowledgeTopic } from '../../shared/knowledge';
import { STATUS_DOT_CLASS, STATUS_LABELS, STATUS_ORDER } from './knowledge-ui';

type KnowledgeGraphProps = {
  topics: KnowledgeTopic[];
  /**
   * Backlinks indexed by the target topic. `backlinks.get(id)` holds the
   * topics whose notes link to topic `id`, so every entry becomes an edge
   * from `link.topicId` to `id`.
   */
  backlinks?: Map<string, KnowledgeBacklink[]>;
  /** Loads backlinks per target topic; preferred over `backlinks` when set. */
  getBacklinks?: (topicId: string) => Promise<KnowledgeBacklink[]>;
  selectedId: string | null;
  onSelect: (topicId: string) => void;
};

type GraphNode = {
  topic: KnowledgeTopic;
  x: number;
  y: number;
};

type GraphEdge = {
  id: string;
  from: GraphNode;
  to: GraphNode;
};

/** Fixed viewBox keeps the layout deterministic and resolution independent. */
const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 520;
const CENTER_X = VIEW_WIDTH / 2;
const CENTER_Y = VIEW_HEIGHT / 2;

const statusRank = new Map(STATUS_ORDER.map((status, index) => [status, index]));

/** Status first, then name, then id — the same order on every render. */
function orderTopics(topics: KnowledgeTopic[]): KnowledgeTopic[] {
  return [...topics].sort((a, b) => {
    const rank = (statusRank.get(a.status) ?? 99) - (statusRank.get(b.status) ?? 99);
    if (rank !== 0) return rank;
    const byName = a.name.localeCompare(b.name, 'zh');
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
}

/**
 * A single ring (top first) for every topic; a one-topic graph sits in the
 * middle. Larger graphs grow the radius slightly so labels keep some room.
 */
function layoutNodes(topics: KnowledgeTopic[]): GraphNode[] {
  const ordered = orderTopics(topics);
  const count = ordered.length;
  if (count === 0) return [];
  if (count === 1) return [{ topic: ordered[0]!, x: CENTER_X, y: CENTER_Y }];
  const radius =
    count === 2 ? 150 : count <= 4 ? 175 : count <= 8 ? 200 : Math.min(235, 170 + count * 4);
  return ordered.map((topic, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return {
      topic,
      x: CENTER_X + radius * Math.cos(angle),
      y: CENTER_Y + radius * Math.sin(angle)
    };
  });
}

/** Deduplicated, self-loop-free source→target edges between laid-out nodes. */
function buildEdges(
  nodes: GraphNode[],
  backlinks: Map<string, KnowledgeBacklink[]>
): GraphEdge[] {
  const byId = new Map(nodes.map((node) => [node.topic.id, node]));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const target of nodes) {
    for (const link of backlinks.get(target.topic.id) ?? []) {
      if (link.topicId === target.topic.id) continue;
      const from = byId.get(link.topicId);
      if (!from) continue;
      const id = `${from.topic.id}->${target.topic.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ id, from, to: target });
    }
  }
  return edges;
}

/** Pulls line ends out from under the node pills so the arrow stays visible. */
function trimSegment(from: GraphNode, to: GraphNode) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  return {
    x1: from.x + ux * 18,
    y1: from.y + uy * 18,
    x2: to.x - ux * 28,
    y2: to.y - uy * 28
  };
}

function topicKey(topics: KnowledgeTopic[]): string {
  return topics.map((topic) => topic.id).join('\u0000');
}

/**
 * A deterministic topic graph: nodes are real buttons laid over an SVG edge
 * layer, so selection, focus and keyboard activation work without libraries.
 * Backlinks load independently; a failure leaves the nodes and their
 * selectable list intact.
 */
export function KnowledgeGraph({
  topics,
  backlinks,
  getBacklinks,
  selectedId,
  onSelect
}: KnowledgeGraphProps) {
  const markerId = `kg-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [loaded, setLoaded] = useState<Map<string, KnowledgeBacklink[]>>(new Map());
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const key = topicKey(topics);

  useEffect(() => {
    if (!getBacklinks) {
      setLoadState('idle');
      return;
    }
    const ids = key ? key.split('\u0000') : [];
    if (ids.length === 0) {
      setLoaded(new Map());
      setLoadState('ready');
      return;
    }
    let cancelled = false;
    let failed = false;
    setLoadState('loading');
    void Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await getBacklinks(id)] as const;
        } catch {
          failed = true;
          return [id, [] as KnowledgeBacklink[]] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setLoaded(new Map(entries));
      setLoadState(failed ? 'error' : 'ready');
    });
    return () => {
      cancelled = true;
    };
  }, [getBacklinks, key]);

  const effectiveBacklinks = useMemo(
    () => (getBacklinks ? loaded : backlinks ?? new Map<string, KnowledgeBacklink[]>()),
    [getBacklinks, loaded, backlinks]
  );
  const nodes = useMemo(() => layoutNodes(topics), [topics]);
  const edges = useMemo(
    () => buildEdges(nodes, effectiveBacklinks),
    [nodes, effectiveBacklinks]
  );

  if (topics.length === 0) {
    return (
      <section aria-label="知识图谱" className="flex w-full flex-col">
        <p className="py-16 text-center text-[13px] text-gray-500 dark:text-[#8e8e93]">
          还没有知识主题。
        </p>
      </section>
    );
  }

  const statusMessage =
    loadState === 'loading'
      ? '正在加载图谱连线…'
      : loadState === 'error'
        ? '图谱连线加载失败，仅显示主题。'
        : null;
  // With a loader, wait for it before claiming there are no links; otherwise
  // the hint would flash on every open.
  const linksReady = getBacklinks ? loadState === 'ready' : true;
  const showLinkHint = linksReady && topics.length > 1 && edges.length === 0;

  return (
    <section aria-label="知识图谱" className="flex w-full flex-col">
      {statusMessage ? (
        <p role="status" className="pb-2 text-[11px] text-gray-400 dark:text-[#8e8e93]">
          {statusMessage}
        </p>
      ) : null}
      {showLinkHint ? (
        <p className="pb-2 text-[11px] text-gray-400 dark:text-[#8e8e93]">
          还没有连线：在主题笔记里用 [[另一个主题名]] 引用其他主题，就会在这里连起来。
        </p>
      ) : null}

      <div className="flex min-h-[320px] w-full items-center justify-center">
        <div
          role="group"
          aria-label="图谱主题"
          className="relative w-full"
          style={{ aspectRatio: `${VIEW_WIDTH} / ${VIEW_HEIGHT}` }}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            <defs>
              <marker
                id={markerId}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-gray-400 dark:fill-[#8e8e93]" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const segment = trimSegment(edge.from, edge.to);
              return (
                <line
                  key={edge.id}
                  data-edge={edge.id}
                  x1={segment.x1}
                  y1={segment.y1}
                  x2={segment.x2}
                  y2={segment.y2}
                  strokeWidth={1.5}
                  markerEnd={`url(#${markerId})`}
                  className="stroke-gray-300 dark:stroke-[#3a3a3c]"
                />
              );
            })}
          </svg>

          {nodes.map((node) => {
            const active = node.topic.id === selectedId;
            return (
              <button
                key={node.topic.id}
                type="button"
                aria-label={`图谱主题：${node.topic.name}`}
                aria-pressed={active}
                onClick={() => onSelect(node.topic.id)}
                style={{
                  left: `${(node.x / VIEW_WIDTH) * 100}%`,
                  top: `${(node.y / VIEW_HEIGHT) * 100}%`
                }}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 ${
                  active
                    ? 'border-[#0071e3] bg-[#0071e3]/10 font-medium text-[#0071e3] shadow-sm dark:border-[#4da3ff] dark:bg-[#0071e3]/20 dark:text-[#4da3ff]'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-black/[0.04] dark:border-white/10 dark:bg-[#1c1c1e] dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[node.topic.status]}`}
                />
                <span className="max-w-[120px] truncate">{node.topic.name}</span>
                {node.topic.level !== undefined ? (
                  <span className="text-[10px] text-gray-400 dark:text-[#8e8e93]">
                    L{node.topic.level}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <details className="mt-4 rounded-xl border border-gray-200/70 px-3 py-2 dark:border-white/10">
        <summary className="cursor-pointer list-none text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]">
          以列表查看图谱
        </summary>
        <ul aria-label="图谱主题列表" className="mt-2 space-y-1.5">
          {nodes.map((node) => (
            <li
              key={node.topic.id}
              className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-[#a1a1a6]"
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[node.topic.status]}`}
              />
              <span className="truncate">{node.topic.name}</span>
              <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
                {STATUS_LABELS[node.topic.status]}
                {node.topic.level !== undefined ? ` · L${node.topic.level}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
