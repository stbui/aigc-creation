/** 验证模板回显 / 换一个 / AI 帮写 三处功能与参考站对齐。 */
import { launchChromium } from './browser.mjs';
const b=await launchChromium({ args: ['--no-proxy-server'] });
const p=await (await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'})).newPage();
await p.goto('http://localhost:5100/shoppable-carousel',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.sc-template-card',{timeout:60000});
await p.waitForTimeout(2000);
const out={};

// 1. 切模板生成, 未选模板 → 回显「暂未选择模板」
await p.click('.sc-mode-option:has-text("模板生成")');
await p.waitForTimeout(400);
out.echoEmpty = await p.evaluate(()=>{
  const el=document.querySelector('.sc-template-echo');
  return el?{text:el.innerText.replace(/\n/g,' | '),rect:el.getBoundingClientRect().toJSON(),bg:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderRadius}:null;
});

// 2. 选模板 → 回显模板名 + 三拍 + 换一个
await p.locator('.sc-template-use').first().click();
await p.waitForTimeout(500);
out.echoPicked = await p.evaluate(()=>{
  const el=document.querySelector('.sc-template-echo');
  return {text:el.innerText.replace(/\n/g,' | '),hasThumb:!!el.querySelector('img'),hasChange:!!el.querySelector('.sc-echo-change')};
});

// 3. 换一个 → 模板变
const before = await p.evaluate(()=>document.querySelector('.sc-echo-title')?.textContent);
await p.click('.sc-echo-change');
await p.waitForTimeout(500);
out.shuffle = {before, after: await p.evaluate(()=>document.querySelector('.sc-echo-title')?.textContent),
  rightSelected: await p.evaluate(()=>document.querySelector('.sc-template-card.is-selected .sc-template-title')?.textContent)};

// 4. 没图点 AI 帮写 → 提示先上传
await p.click('.pk-ai-btn');
await p.waitForTimeout(900);
out.aiNoImage = await p.evaluate(()=>Array.from(document.querySelectorAll('.admin-portal *')).filter(e=>e.children.length===0).map(e=>(e.textContent||'').trim()).filter(Boolean).slice(0,5));
console.log(JSON.stringify(out,null,1));
await p.screenshot({path:'/tmp/designkit-shoppable-carousel/local-echo.png'});
await b.close();
