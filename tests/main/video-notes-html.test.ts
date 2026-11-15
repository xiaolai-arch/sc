import { renderIndexHtml } from '../../src/main/video-notes/html';

describe('course index HTML', () => {
  test('links every legacy lesson and escapes metadata', () => {
    const html = renderIndexHtml({
      title: '高数 <入门>',
      generatedAt: '2026-11-08',
      lessons: [
        {
          folder: '01-集合',
          title: '第一讲 <集合>',
          durationSeconds: 1800,
          transcriptChars: 5000,
          noteChars: 800,
          summary: '讲了集合的 "基本" 概念。'
        },
        {
          folder: '02-函数',
          title: '第二讲 函数',
          durationSeconds: 2400,
          transcriptChars: 7000,
          noteChars: 900,
          summary: '函数定义域。'
        }
      ]
    });

    expect(html).toContain('高数 &lt;入门&gt;');
    expect(html).toContain('第一讲 &lt;集合&gt;');
    expect(html).toContain('讲了集合的 &quot;基本&quot; 概念。');
    expect(html).toContain('./01-%E9%9B%86%E5%90%88/notes.html');
    expect(html).toContain('./02-%E5%87%BD%E6%95%B0/notes.html');
    expect(html).toContain('共 <strong>2</strong> 讲');
    expect(html).toContain('1:10:00');
    // Legacy quick lessons still show their transcript size.
    expect(html).toContain('5,000 字转录');
    // The index-specific card CSS must be present, not only the shared CSS.
    expect(html).toContain('.card:hover');
  });

  test('deck lessons link slides, PDF and report instead of notes.html', () => {
    const html = renderIndexHtml({
      title: '课程',
      generatedAt: '2026-11-15',
      lessons: [
        {
          folder: '01-集合',
          title: '第一讲',
          durationSeconds: 1800,
          transcriptChars: 5000,
          noteChars: 800,
          summary: '摘要',
          mode: 'deck',
          slidesFile: 'slides.html',
          pdfFile: 'slides.pdf',
          reportFile: 'report.md'
        }
      ]
    });

    expect(html).toContain('./01-%E9%9B%86%E5%90%88/slides.html');
    expect(html).toContain('./01-%E9%9B%86%E5%90%88/slides.pdf');
    expect(html).toContain('./01-%E9%9B%86%E5%90%88/report.md');
    expect(html).not.toContain('./01-%E9%9B%86%E5%90%88/notes.html');
  });

  test('v3 lessons count screen reads instead of transcript characters', () => {
    const html = renderIndexHtml({
      title: '课程',
      generatedAt: '2026-11-15',
      lessons: [
        {
          folder: '01-集合',
          title: '第一讲',
          durationSeconds: 1800,
          transcriptChars: 0,
          noteChars: 800,
          screenReadCount: 42,
          summary: '摘要',
          mode: 'deck',
          slidesFile: 'slides.html',
          pdfFile: 'slides.pdf',
          reportFile: 'report.md'
        }
      ]
    });

    expect(html).toContain('42 条画面文字');
    expect(html).toContain('画面文字 <strong>42</strong> 条');
    expect(html).not.toContain('字转录');
    // A deck has no notes.html, so the card must not link one.
    expect(html).not.toContain('notes.html');
  });
});
