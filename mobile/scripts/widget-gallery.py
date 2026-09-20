"""Build a portable gallery from the native widget validation harness output."""
import base64
import json
import sys
from pathlib import Path

source = Path(sys.argv[1])
target = Path(__file__).resolve().parents[1] / "docs" / "widgets-preview.html"
images = []
for path in sorted(source.glob("*.png")):
    kind, family, mode = path.stem.split("-", 2)
    images.append({"kind": kind, "family": family, "mode": mode,
                   "src": "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()})
if len(images) != 66:
    raise SystemExit(f"Expected 66 renders, found {len(images)}")

page = """<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NW Planner · Native widgets</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#ecf0ef;color:#172e2a;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header,main{max-width:1240px;margin:auto;padding:32px}header{padding-bottom:10px}h1{font-size:32px;letter-spacing:-1px;margin:4px 0 8px}
p{max-width:760px;margin:8px 0;color:#49605b}.eyebrow{font-size:12px;font-weight:700;letter-spacing:1px;color:#006147}
.controls{display:flex;gap:20px;flex-wrap:wrap;margin:24px 0 8px}label{font-size:12px;font-weight:600;display:flex;gap:8px;align-items:center}
select{font:inherit;font-size:14px;border:1px solid #859c95;border-radius:8px;padding:9px 30px 9px 12px;background:white;color:#173a2e}
select:focus-visible{outline:3px solid #006147;outline-offset:3px}#gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;align-items:start}
figure{margin:0;padding:20px;background:#fff;border-radius:18px;border:1px solid #dae4df}figure.wide{grid-column:1/-1}
figure img{display:block;width:100%;height:auto;max-width:364px;margin:16px auto 0}figure.small img{max-width:170px}figure.wide img{max-width:720px}
figcaption{display:flex;justify-content:space-between;gap:8px;font-weight:650}figcaption span{font-weight:400;color:#62786e;font-size:12px}
.note{font-size:12px;color:#526b61}a{color:#006147}@media(max-width:650px){header,main{padding:20px}#gallery{grid-template-columns:1fr}h1{font-size:28px}}
</style>
<header><div class="eyebrow">NW STUDENT PLANNER / iOS</div><h1>Your planner, within reach.</h1>
<p>Native agendas, deadline countdowns, a selectable week, and daily progress. Checkboxes save on the device; opening the app applies and syncs those changes.</p>
<p class="note">These are renders of the actual SwiftUI views with synthetic records. They are not Home Screen screenshots. Use the controls to inspect the layouts.</p>
<div class="controls"><label>Appearance and state <select id="mode"><option value="light">Light</option><option value="dark">Dark</option><option value="pending">Completion saved, waiting to sync</option><option value="private">Titles hidden</option><option value="empty">Nothing scheduled</option><option value="large-text">Larger text</option></select></label>
<label>Size <select id="family"><option value="all">All sizes</option><option value="systemSmall">Small</option><option value="systemMedium">Medium</option><option value="systemLarge" selected>Large</option><option value="systemExtraLarge">Extra large · iPad</option></select></label></div></header>
<main><div id="gallery" aria-live="polite"></div><p class="note">Full titles require permission in Settings → Widgets &amp; Siri. Existing widgets also retain their own Show titles setting. <a href="WIDGETS.md">Implementation and validation guide</a>.</p></main>
<script>const images=__IMAGES__;
const titles={DueToday:'Due Today',UpNext:'Up Next',ThisWeek:'This Week',Progress:'Today’s Progress'};
const families={systemSmall:'Small',systemMedium:'Medium',systemLarge:'Large',systemExtraLarge:'Extra large · iPad'};
function render(){const gallery=document.getElementById('gallery');gallery.replaceChildren();
for(const item of images.filter(i=>i.mode===document.getElementById('mode').value&&(document.getElementById('family').value==='all'||i.family===document.getElementById('family').value))){
const card=document.createElement('figure');if(item.family==='systemSmall')card.className='small';if(item.family==='systemExtraLarge')card.className='wide';
const caption=document.createElement('figcaption');caption.textContent=titles[item.kind];const size=document.createElement('span');size.textContent=families[item.family];caption.append(size);
const img=document.createElement('img');img.src=item.src;img.alt=titles[item.kind]+', '+families[item.family]+', '+item.mode;card.append(caption,img);gallery.append(card);}}
document.getElementById('mode').addEventListener('change',render);document.getElementById('family').addEventListener('change',render);render();</script></html>
"""
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(page.replace("__IMAGES__", json.dumps(images)))
print(target)
