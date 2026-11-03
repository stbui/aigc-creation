import { chromium } from 'playwright';
const CHROME='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const URL='https://www.designkit.cn/shoppable-carousel?from=product_kit_web';
const b=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-proxy-server']});
const p=await (await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'})).newPage();
await p.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('[class^="social-media-card-"]',{timeout:60000});
await p.waitForTimeout(5000);

// 生成设置的 4 个 select 标签与当前值
const selects = await p.evaluate(()=>Array.from(document.querySelectorAll('[class^="social-media-posterSelectField-"]')).map(f=>({label:(f.querySelector('label,[class*=label]')?.textContent||f.innerText||'').trim().slice(0,40), value:(f.querySelector('.ant-select-selection-item')?.textContent||'').trim(), html:f.innerHTML.slice(0,300)})));
console.log('SELECTS', JSON.stringify(selects,null,1));

// 给每个 select 打开看选项
const labels = await p.$$('[class^="social-media-posterSelectField-"]');
const opened=[];
for(let i=0;i<labels.length;i++){
  const sel=labels[i];
  const trigger = await sel.$('.ant-select');
  if(!trigger) continue;
  await trigger.click(); await p.waitForTimeout(400);
  const opts = await p.evaluate(()=>Array.from(document.querySelectorAll('.ant-select-item-option-content')).map(o=>o.textContent.trim()));
  const ddTitle = await p.evaluate(()=>document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-group, .ant-select-dropdown:not(.ant-select-dropdown-hidden)')?.innerText.slice(0,50));
  opened.push({idx:i, options:opts.slice(0,20)});
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
}
console.log('DROPDOWNS', JSON.stringify(opened,null,1));

// 空表单点生成
const gen = await p.$('button[class*="generate"]');
console.log('GEN text/disabled before', await gen.innerText(), await gen.isDisabled());
await gen.click({timeout:3000}).catch(e=>console.log('click err',e.message));
await p.waitForTimeout(1200);
const toast = await p.evaluate(()=>Array.from(document.querySelectorAll('.ant-message-notice-content,.ant-message span,[class*=message]')).map(e=>e.innerText.trim()).filter(Boolean).slice(0,5));
console.log('TOAST', JSON.stringify(toast));
await b.close();
