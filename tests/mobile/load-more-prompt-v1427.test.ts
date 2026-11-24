import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHOW_LOAD_MORE_PINS } from "../../app/hooks/useViewportLeads";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const PROMPT = "More knock records are available here";
const BUTTON = "Load more pins";

test("the load-more pins prompt is switched off", () => {
  assert.equal(SHOW_LOAD_MORE_PINS, false);
  const hook = read("app/hooks/useViewportLeads.ts");
  assert.match(hook, /export const SHOW_LOAD_MORE_PINS = false;/);
});

test("the knock map never renders the load-more prompt or its button, so the door panel is not covered", () => {
  const page = read("app/mobile/knocking/page.tsx");
  const css = read("app/mobile/mobile.css");
  const detail = read("app/components/LeadDetail.tsx");

  assert.match(page, /import \{ SHOW_LOAD_MORE_PINS, useViewportLeads \} from "@\/app\/hooks\/useViewportLeads";/);
  const promptBlocks = [...page.matchAll(/SHOW_LOAD_MORE_PINS && viewportPins\.partial[\s\S]*?Load more pins[\s\S]*?<\/div>\}/g)];
  assert.equal(promptBlocks.length, 1, "the load-more prompt must stay behind the feature flag");
  assert.match(promptBlocks[0][0], /More knock records are available here/);
  assert.equal((page.match(/More knock records are available here/g) || []).length, 1);
  assert.equal((page.match(/Load more pins/g) || []).length, 1);
  // The only loadMore click is on the hidden button. Nothing auto-triggers it.
  assert.match(page, /onClick=\{viewportPins\.loadMore\}/);
  assert.equal((page.match(/viewportPins\.loadMore/g) || []).length, 1);
  assert.doesNotMatch(page, /loadMore\(\)/);
  assert.doesNotMatch(page, /SHOW_LOAD_MORE_PINS\s*=\s*true/);

  // Field bug: .rm-map-loading is z-index 450 and LeadDetail is z-[80], so a
  // mounted prompt covers the homeowner/lead panel. With the flag off the
  // prompt is not mounted, so it cannot cover the panel.
  assert.match(css, /\.rm-map-loading \{[^}]*z-index:\s*450/);
  assert.equal((detail.match(/z-\[80\]/g) || []).length, 3);
  assert.match(page, /<LeadDetail/);
  assert.match(page, /<HomeownerKnockDetail/);
});

test("normal viewport pin loading keeps the same queries, bounds, and limits", () => {
  const hook = read("app/hooks/useViewportLeads.ts");
  assert.match(hook, /const MAX_RETAINED = 6000;/);
  assert.match(hook, /if\(view\.zoom<15\)\{publish\(\{\.\.\.current\.current\.value,loading:false,error:'',partial:false\}\);return;\}/);
  assert.match(hook, /for\(let page=0;page<2 && active;page\+\+\)\{/);
  assert.match(
    hook,
    /const params=new URLSearchParams\(\{mode:'map',south:String\(view\.south\),north:String\(view\.north\),west:String\(view\.west\),east:String\(view\.east\),zoom:String\(view\.zoom\)\}\);/,
  );
  assert.match(hook, /params\.set\('after',cursor\.id\);params\.set\('afterLat',String\(cursor\.lat\)\);/);
  assert.match(hook, /apiFetch\(`\/api\/mobile-leads\?\$\{params\}`/);
  assert.match(hook, /loadMore:\(\)=>retry\(true\)/);
  // Coming back online still refreshes page one; it does not auto load-more.
  assert.match(hook, /const online=\(\)=>setAttempt\(v=>\(\{id:v\.id\+1,key:`\$\{scope\}:\$\{key\}`,more:false\}\)\);/);
  assert.doesNotMatch(hook, /page\s*<\s*[3-9]/);
  assert.doesNotMatch(hook, /MAX_RETAINED = (?!6000)\d+/);
});
