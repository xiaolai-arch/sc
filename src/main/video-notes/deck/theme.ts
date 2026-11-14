/**
 * Theme for the slide deck renderer.
 *
 * The palette follows video-md-ppt: teal primary, orange accent, neutral
 * surfaces. Everything a slide layout needs is a custom property, so the
 * 1280x720 stage keeps a predictable typographic scale. No web fonts: the
 * system CJK stack keeps the file self-contained and offline.
 */

export const themeCss = `
:root{
  color-scheme:light dark;
  --teal:#0f766e;
  --teal-strong:#115e59;
  --teal-soft:rgba(15,118,110,.10);
  --orange:#c2410c;
  --orange-strong:#9a3412;
  --orange-soft:rgba(194,65,12,.10);
  --bg:#f4f7f6;
  --surface:#ffffff;
  --surface-muted:#f0f5f4;
  --text:#14201f;
  --text-muted:#52625f;
  --text-faint:#788a87;
  --line:rgba(15,118,110,.16);
  --line-strong:rgba(15,118,110,.34);
  --mark:#fde68a;
  --mark-text:#3b2f06;
  --shadow:0 24px 64px rgba(13,38,35,.14);

  --font-ui:"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif;
  --font-mono:"Cascadia Code","SF Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;

  --stage-w:1280px;
  --stage-h:720px;
  --pad-x:64px;
  --pad-top:52px;
  --pad-bottom:64px;
  --font-title:60px;
  --font-section:46px;
  --font-subtitle:28px;
  --font-body:25px;
  --font-small:21px;
  --font-caption:15px;
  --font-mono-size:20px;
  --line-tight:1.15;
  --line-body:1.6;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    color-scheme:dark;
    --teal:#2dd4bf;
    --teal-strong:#5eead4;
    --teal-soft:rgba(45,212,191,.14);
    --orange:#fb923c;
    --orange-strong:#fdba74;
    --orange-soft:rgba(251,146,60,.14);
    --bg:#0b1110;
    --surface:#121a18;
    --surface-muted:#182421;
    --text:#e8f1ef;
    --text-muted:#a7b8b4;
    --text-faint:#82938f;
    --line:rgba(94,234,212,.16);
    --line-strong:rgba(94,234,212,.34);
    --mark:rgba(251,191,36,.30);
    --mark-text:#fde68a;
    --shadow:0 24px 64px rgba(0,0,0,.50);
  }
}
@media print{
  /* Printing always uses the light palette, even on a dark system. */
  :root, :root:not([data-theme="light"]){
    color-scheme:light;
    --teal:#0f766e;
    --teal-strong:#115e59;
    --teal-soft:rgba(15,118,110,.10);
    --orange:#c2410c;
    --orange-strong:#9a3412;
    --orange-soft:rgba(194,65,12,.10);
    --bg:#ffffff;
    --surface:#ffffff;
    --surface-muted:#f0f5f4;
    --text:#14201f;
    --text-muted:#52625f;
    --text-faint:#788a87;
    --line:rgba(15,118,110,.16);
    --line-strong:rgba(15,118,110,.34);
    --mark:#fde68a;
    --mark-text:#3b2f06;
    --shadow:none;
  }
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  background:var(--bg);
  color:var(--text);
  font-family:var(--font-ui);
  font-size:var(--font-body);
  line-height:var(--line-body);
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
h1,h2,h3,p,ul,ol,figure,blockquote{margin:0}
ul,ol{padding:0;list-style:none}
a{color:var(--teal);text-decoration:none}
a:hover{text-decoration:underline}
strong{font-weight:700;color:var(--teal-strong)}
mark{background:var(--mark);color:var(--mark-text);padding:0 .18em;border-radius:4px}
code,kbd,samp,pre{font-family:var(--font-mono)}
`;
