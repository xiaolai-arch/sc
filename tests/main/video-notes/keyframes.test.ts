import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveFfmpegBinary } from '../../../src/main/video-notes/frames';
import {
  analyzeFrame,
  applyMinSpacing,
  assignFrameTimes,
  buildCandidateArgs,
  buildExportArgs,
  clusterFrames,
  dHashFromRgb,
  dropTransitionClusters,
  extractKeyframes,
  frameBudget,
  hammingDistance,
  isDuplicateFrame,
  laplacianVariance,
  markSceneFlags,
  meanChannelDifferences,
  meanRgbFromRgb,
  parseShowinfoLine,
  parseShowinfoLog,
  popcount32,
  selectKeyframeClusters,
  sharpnessFromRgb,
  thinToBudget,
  uniformIndices,
  type DHash,
  type KeyframeCandidate,
  type ShowinfoRecord
} from '../../../src/main/video-notes/keyframes';

const HASH_A: DHash = { hi: 0x00000000, lo: 0x00000000 };
const HASH_B: DHash = { hi: 0xffffffff, lo: 0xffffffff };
const HASH_C: DHash = { hi: 0x0f0f0f0f, lo: 0xf0f0f0f0 };
const HASH_D: DHash = { hi: 0x33333333, lo: 0x55555555 };

function candidate(
  t: number,
  overrides: Partial<KeyframeCandidate> = {}
): KeyframeCandidate {
  return {
    t,
    scene: false,
    dhash: HASH_A,
    meanRgb: [0.5, 0.5, 0.5],
    sharpness: 0,
    ...overrides
  };
}

function solidFrame(width: number, height: number, value: number): Uint8Array {
  const frame = new Uint8Array(width * height * 3);
  frame.fill(value);
  return frame;
}

/** Alternating vertical stripes; shifting by one stripe inverts dHash bits. */
function stripeFrame(
  width: number,
  height: number,
  stripeWidth: number,
  offset: number
): Uint8Array {
  const frame = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const band = Math.floor((x + offset) / stripeWidth) % 2;
      const value = band === 0 ? 0 : 255;
      const index = (y * width + x) * 3;
      frame[index] = value;
      frame[index + 1] = value;
      frame[index + 2] = value;
    }
  }
  return frame;
}

function noiseFrame(width: number, height: number, seed = 1): Uint8Array {
  const frame = new Uint8Array(width * height * 3);
  let state = seed >>> 0;
  for (let i = 0; i < frame.length; i += 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    frame[i] = state & 0xff;
  }
  return frame;
}

// ---------------------------------------------------------------------------
// Frame analysis
// ---------------------------------------------------------------------------

test('identical frames are duplicates', () => {
  const frame = stripeFrame(90, 80, 10, 0);
  const a = analyzeFrame(frame, 90, 80);
  const b = analyzeFrame(Uint8Array.from(frame), 90, 80);

  expect(hammingDistance(a.dhash, b.dhash)).toBe(0);
  expect(
    Math.max(...meanChannelDifferences(a.meanRgb, b.meanRgb))
  ).toBeLessThanOrEqual(0.08);
  expect(isDuplicateFrame(a, b)).toBe(true);
});

test('a shifted hard pattern is not a duplicate', () => {
  const left = analyzeFrame(stripeFrame(90, 80, 10, 0), 90, 80);
  const right = analyzeFrame(stripeFrame(90, 80, 10, 10), 90, 80);

  expect(hammingDistance(left.dhash, right.dhash)).toBeGreaterThan(6);
  expect(isDuplicateFrame(left, right)).toBe(false);
});

test('both tests must agree before a frame is dropped', () => {
  const dim = analyzeFrame(solidFrame(64, 64, 100), 64, 64);
  const bright = analyzeFrame(solidFrame(64, 64, 160), 64, 64);

  // Flat frames hash identically, but the mean colour differs enough.
  expect(hammingDistance(dim.dhash, bright.dhash)).toBe(0);
  const diffs = meanChannelDifferences(dim.meanRgb, bright.meanRgb);
  expect(Math.max(...diffs)).toBeGreaterThan(0.08);
  expect(isDuplicateFrame(dim, bright)).toBe(false);
});

test('mean RGB is normalized and channel differences are per channel', () => {
  const frame = solidFrame(32, 32, 255);
  const mean = meanRgbFromRgb(frame, 32, 32);
  expect(mean[0]).toBeCloseTo(1, 5);
  expect(mean[1]).toBeCloseTo(1, 5);
  expect(mean[2]).toBeCloseTo(1, 5);

  const diffs = meanChannelDifferences(mean, [0.5, 0.6, 0.7]);
  expect(diffs[0]).toBeCloseTo(0.5, 5);
  expect(diffs[1]).toBeCloseTo(0.4, 5);
  expect(diffs[2]).toBeCloseTo(0.3, 5);
});

test('sharpness is ~0 for flat frames and high for noise', () => {
  const flat = sharpnessFromRgb(solidFrame(64, 64, 128), 64, 64);
  const noisy = sharpnessFromRgb(noiseFrame(64, 64), 64, 64);

  expect(flat).toBe(0);
  expect(noisy).toBeGreaterThan(100);
});

test('laplacian variance is zero for a constant gray image', () => {
  const gray = new Uint8Array(10 * 10).fill(200);
  expect(laplacianVariance(gray, 10, 10)).toBe(0);
});

test('popcount32 counts set bits', () => {
  expect(popcount32(0)).toBe(0);
  expect(popcount32(0xffffffff)).toBe(32);
  expect(popcount32(0b1011)).toBe(3);
});

test('dHash is deterministic and 64 bits wide', () => {
  const frame = noiseFrame(90, 80, 7);
  const first = dHashFromRgb(frame, 90, 80);
  const second = dHashFromRgb(frame, 90, 80);
  expect(first).toEqual(second);
  expect(popcount32(first.hi)).toBeLessThanOrEqual(32);
  expect(popcount32(first.lo)).toBeLessThanOrEqual(32);
});

// ---------------------------------------------------------------------------
// Showinfo parsing
// ---------------------------------------------------------------------------

const REAL_SHOWINFO =
  '[Parsed_showinfo_2 @ 0000023dcae28840] n:   0 pts:      0 pts_time:0       ' +
  'duration:    512 duration_time:0.0333333 fmt:rgb24 cl:left sar:1/1 s:320x180 i:P ' +
  'iskey:1 type:I checksum:95EADBDC plane_checksum:[95EADBDC] mean:[125] stdev:[123.3]';

test('parses a real showinfo line', () => {
  const record = parseShowinfoLine(REAL_SHOWINFO);
  expect(record).toEqual({
    index: 0,
    ptsTime: 0,
    width: 320,
    height: 180
  });
});

test('tolerates a showinfo line without pts_time', () => {
  const line = REAL_SHOWINFO.replace(/\s+pts_time:0\s+/, ' ').replace('n:   0', 'n:   7');
  const record = parseShowinfoLine(line);
  expect(record).not.toBeNull();
  expect(record?.index).toBe(7);
  expect(record?.ptsTime).toBeNull();
  expect(record?.width).toBe(320);
});

test('ignores showinfo config and side-data lines', () => {
  expect(
    parseShowinfoLine(
      '[Parsed_showinfo_2 @ 0000023dcae28840] config in time_base: 1/15360, frame_rate: 30/1'
    )
  ).toBeNull();
  expect(parseShowinfoLine('[Parsed_showinfo_2 @ 0]   side data - SEI message')).toBeNull();
});

test('parses a whole stderr log in order', () => {
  const log = [
    'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'test.mp4\':',
    REAL_SHOWINFO,
    '[Parsed_showinfo_2 @ 0]   side data - H.26[45] User Data',
    '[Parsed_showinfo_2 @ 0000023dcae28840] n:   1 pts: 184320 pts_time:12       duration: 512 s:320x180'
  ].join('\n');

  const records = parseShowinfoLog(log);
  expect(records.map((record) => record.index)).toEqual([0, 1]);
  expect(records.map((record) => record.ptsTime)).toEqual([0, 12]);
  expect(records.map((record) => record.width)).toEqual([320, 320]);
});

test('parses decimal timestamps independently of locale', () => {
  const line = REAL_SHOWINFO.replace('pts_time:0', 'pts_time:12.5');
  expect(parseShowinfoLine(line)?.ptsTime).toBe(12.5);

  const exponent = REAL_SHOWINFO.replace('pts_time:0', 'pts_time:1.5e-2');
  expect(parseShowinfoLine(exponent)?.ptsTime).toBeCloseTo(0.015, 10);
});

test('assigns missing timestamps by interpolating known neighbors', () => {
  const records: ShowinfoRecord[] = [
    { index: 0, ptsTime: 0, width: 320, height: 180 },
    { index: 1, ptsTime: null, width: 320, height: 180 },
    { index: 2, ptsTime: 24, width: 320, height: 180 }
  ];
  expect(assignFrameTimes(records, 12)).toEqual([0, 12, 24]);
});

test('extrapolates missing timestamps with the inferred step', () => {
  const records: ShowinfoRecord[] = [
    { index: 0, ptsTime: 6, width: 320, height: 180 },
    { index: 1, ptsTime: null, width: 320, height: 180 },
    { index: 2, ptsTime: null, width: 320, height: 180 }
  ];
  expect(assignFrameTimes(records, 4)).toEqual([6, 10, 14]);
});

test('falls back to frame index times when no timestamp is known', () => {
  const records: ShowinfoRecord[] = [
    { index: 0, ptsTime: null, width: 320, height: 180 },
    { index: 1, ptsTime: null, width: 320, height: 180 },
    { index: 2, ptsTime: null, width: 320, height: 180 }
  ];
  expect(assignFrameTimes(records, 12)).toEqual([0, 12, 24]);

  const inferredStep = assignFrameTimes(
    [
      { index: 0, ptsTime: 0, width: 320, height: 180 },
      { index: 1, ptsTime: 5, width: 320, height: 180 },
      { index: 2, ptsTime: null, width: 320, height: 180 }
    ],
    12
  );
  // The only known gap is 5 seconds, so extrapolation uses 5, not the fallback.
  expect(inferredStep).toEqual([0, 5, 10]);
});

test('marks scene candidates by replaying the periodic branch', () => {
  expect(markSceneFlags([0, 12, 24, 30, 42], 12)).toEqual([
    false,
    false,
    false,
    true,
    false
  ]);
});

test('builds one ffmpeg pass with periodic and scene detection', () => {
  const args = buildCandidateArgs({
    videoPath: 'lesson.mp4',
    sampleIntervalSeconds: 12,
    sceneThreshold: 0.3,
    candidateWidth: 320
  });
  const filter = args[args.indexOf('-vf') + 1];
  expect(filter).toContain("select='isnan(prev_selected_t)+gte(t-prev_selected_t,12)+gt(scene,0.3)'");
  expect(filter).toContain('scale=320:-1');
  expect(filter).toContain('showinfo');
  expect(args).toContain('-fps_mode');
  expect(args[args.indexOf('-fps_mode') + 1]).toBe('passthrough');
  expect(args.slice(-5)).toEqual(['-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  expect(args[args.length - 1]).toBe('pipe:1');
});

test('builds a 1280px JPEG export command', () => {
  const args = buildExportArgs({
    videoPath: 'lesson.mp4',
    t: 12.345,
    destination: 'frames/12345.jpg',
    exportWidth: 1280,
    jpegQuality: 3
  });
  expect(args[args.indexOf('-ss') + 1]).toBe('12.345');
  expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
  expect(args[args.indexOf('-vf') + 1]).toBe('scale=1280:-1');
  expect(args[args.indexOf('-q:v') + 1]).toBe('3');
  expect(args[args.length - 1]).toBe('frames/12345.jpg');
});

// ---------------------------------------------------------------------------
// Clustering and selection
// ---------------------------------------------------------------------------

test('clusters duplicate candidates and keeps the sharpest as representative', () => {
  const candidates = [
    candidate(0, { sharpness: 10 }),
    candidate(3, { sharpness: 30 }),
    candidate(6, { sharpness: 20 }),
    candidate(30, { dhash: HASH_B, sharpness: 50 })
  ];

  const clusters = clusterFrames(candidates);
  expect(clusters).toHaveLength(2);
  expect(clusters[0].start).toBe(0);
  expect(clusters[0].end).toBe(6);
  expect(clusters[0].representative.t).toBe(3);
  expect(clusters[0].representative.sharpness).toBe(30);
  expect(clusters[1].representative.t).toBe(30);
});

test('a cluster is marked as scene when any candidate is a scene change', () => {
  const clusters = clusterFrames([
    candidate(0, { sharpness: 10 }),
    candidate(2, { sharpness: 20, scene: true })
  ]);
  expect(clusters[0].scene).toBe(true);
});

test('drops a short page-flip cluster between two close clusters', () => {
  const clusters = clusterFrames([
    candidate(0),
    candidate(4),
    candidate(5, { dhash: HASH_B }),
    candidate(6, { dhash: HASH_C }),
    candidate(10, { dhash: HASH_C })
  ]);

  expect(clusters).toHaveLength(3);
  const kept = dropTransitionClusters(clusters, 2);
  expect(kept.map((cluster) => cluster.start)).toEqual([0, 6]);
});

test('keeps a short cluster when a neighbor is far away', () => {
  const clusters = clusterFrames([
    candidate(0),
    candidate(4),
    candidate(5, { dhash: HASH_B }),
    candidate(20, { dhash: HASH_C }),
    candidate(24, { dhash: HASH_C })
  ]);

  const kept = dropTransitionClusters(clusters, 2);
  expect(kept.map((cluster) => cluster.start)).toEqual([0, 5, 20]);
});

test('enforces 20 second spacing between ordinary frames', () => {
  const clusters = clusterFrames([
    candidate(0),
    candidate(5, { dhash: HASH_B }),
    candidate(25, { dhash: HASH_C })
  ]);

  const kept = applyMinSpacing(clusters, 20);
  expect(kept.map((cluster) => cluster.start)).toEqual([0, 25]);
});

test('scene changes break the minimum spacing rule', () => {
  const clusters = clusterFrames([
    candidate(0),
    candidate(5, { dhash: HASH_B, scene: true }),
    candidate(10, { dhash: HASH_C }),
    candidate(30, { dhash: HASH_D })
  ]);

  const kept = applyMinSpacing(clusters, 20);
  expect(kept.map((cluster) => cluster.start)).toEqual([0, 5, 30]);
});

test('computes the frame budget per ten minutes with an 80 frame cap', () => {
  expect(frameBudget(600)).toBe(12);
  expect(frameBudget(1_200)).toBe(24);
  expect(frameBudget(2_700)).toBe(54);
  expect(frameBudget(7_200)).toBe(80);
  expect(frameBudget(0)).toBe(80);
  expect(frameBudget(600, 12, 5)).toBe(5);
  expect(frameBudget(60)).toBe(1);
});

test('uniform indices include both ends and stay in range', () => {
  expect(uniformIndices(10, 3)).toEqual([0, 5, 9]);
  expect(uniformIndices(5, 10)).toEqual([0, 1, 2, 3, 4]);
  expect(uniformIndices(0, 3)).toEqual([]);
  expect(uniformIndices(10, 0)).toEqual([]);
});

test('thins uniformly when over budget', () => {
  const items = Array.from({ length: 100 }, (_, id) => ({ id, scene: false }));
  const thinned = thinToBudget(items, 12, (item) => item.scene);
  expect(thinned).toHaveLength(12);
  expect(thinned[0].id).toBe(0);
  expect(thinned[thinned.length - 1].id).toBe(99);
});

test('keeps scene frames first when thinning', () => {
  const items = Array.from({ length: 20 }, (_, id) => ({
    id,
    scene: [1, 3, 5, 7, 9].includes(id)
  }));

  const thinned = thinToBudget(items, 8, (item) => item.scene);
  expect(thinned).toHaveLength(8);
  expect(thinned.filter((item) => item.scene)).toHaveLength(5);
  expect(thinned.filter((item) => !item.scene)).toHaveLength(3);
  expect(thinned.map((item) => item.id)).toEqual(
    [...thinned.map((item) => item.id)].sort((a, b) => a - b)
  );
});

test('keeps only scene frames when they alone exceed the budget', () => {
  const items = Array.from({ length: 20 }, (_, id) => ({ id, scene: true }));
  const thinned = thinToBudget(items, 8, (item) => item.scene);
  expect(thinned).toHaveLength(8);
  expect(thinned.every((item) => item.scene)).toBe(true);
});

test('selectKeyframeClusters applies transitions, spacing and budget in order', () => {
  const candidates: KeyframeCandidate[] = [];
  // One distinct slide every 12 seconds for 30 minutes.
  for (let i = 0; i < 150; i += 1) {
    candidates.push(
      candidate(i * 12, {
        dhash: {
          hi: (i * 2_654_435_761) >>> 0,
          lo: (i * 40_503) >>> 0
        }
      })
    );
  }

  const selected = selectKeyframeClusters(candidates, { durationSeconds: 1_800 });
  // 30 minutes -> 36 frames, and spacing must hold.
  expect(selected.length).toBeLessThanOrEqual(36);
  expect(selected.length).toBeGreaterThan(0);
  for (let i = 1; i < selected.length; i += 1) {
    const gap =
      selected[i].representative.t - selected[i - 1].representative.t;
    expect(gap).toBeGreaterThanOrEqual(20);
  }
});

// ---------------------------------------------------------------------------
// End-to-end with a real ffmpeg, when available
// ---------------------------------------------------------------------------

const ffmpegAvailable = (() => {
  try {
    return (
      spawnSync(resolveFfmpegBinary(), ['-version'], {
        stdio: 'ignore',
        timeout: 5_000
      }).status === 0
    );
  } catch {
    return false;
  }
})();

test.skipIf(!ffmpegAvailable)(
  'extracts a keyframe from a synthetic video',
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'keyframes-'));
    try {
      const videoPath = path.join(dir, 'clip.mp4');
      const generated = spawnSync(
        resolveFfmpegBinary(),
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=320x180:rate=15:duration=6',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-y',
          videoPath
        ],
        { timeout: 20_000 }
      );
      expect(generated.status).toBe(0);

      const outDir = path.join(dir, 'frames');
      const frames = await extractKeyframes({
        videoPath,
        durationSeconds: 6,
        outDir
      });

      expect(frames.length).toBeGreaterThanOrEqual(1);
      expect(path.isAbsolute(frames[0].path)).toBe(true);
      expect(frames[0].path.startsWith(outDir)).toBe(true);
      expect(frames[0].path.endsWith('.jpg')).toBe(true);
      expect(frames[0].t).toBeGreaterThanOrEqual(0);
      expect(frames[0].sharpness).toBeGreaterThan(0);
      expect((await stat(frames[0].path)).size).toBeGreaterThan(500);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  30_000
);
