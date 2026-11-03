/** 左栏 + 右栏逐节点对比: 参考站 vs 本站。 */
import { chromium } from 'playwright';
const CHROME='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-proxy-server']});

async function ref(){
  const p=await (await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'})).newPage();
  await p.goto('https://www.designkit.cn/shoppable-carousel?from=product_kit_web',{waitUntil:'domcontentloaded',timeout:60000});
  await p.waitForSelector('[class^="social-media-card-"]',{timeout:60000});
  await p.waitForTimeout(5000);
  const o=await p.evaluate(()=>{
    const r=(el)=>{const b=el.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};};
    const sc=document.querySelector('[class^="social-media-sidebarScroll-"]');
    const secs=Array.from(sc.children);
    const card=document.querySelector('[class^="social-media-card-"]');
    const cat=document.querySelector('[class^="social-media-recipeCategories-"]');
    const use=card.querySelector('[class^="social-media-useButton-"]');
    return {
      sections: secs.map(el=>({y:r(el).y,h:r(el).h,gapBefore:getComputedStyle(el).marginTop,title:el.querySelector('h2')?.textContent?.trim()})),
      uploadDrop: r(document.querySelector('[class^="social-media-uploadDropzone-"]')),
      selectBox: r(document.querySelector('.ant-select-selector')),
      noText: r(document.querySelector('[class^="social-media-noTextField-"]')),
      textarea: r(document.querySelector('[class^="social-media-copyTextarea-"]')),
      modeCard: r(document.querySelector('[class^="social-media-option-"]')),
      footer: r(document.querySelector('[class^="social-media-sidebarFooter-"]')),
      genBtn: r(document.querySelector('button[class*="social-media-generate"]')),
      catNav: {rect:r(cat), pad:getComputedStyle(cat).padding, marginTop:getComputedStyle(cat).marginTop},
      card: r(card), useBtn: use?{rect:r(use),bg:getComputedStyle(use).backgroundColor,radius:getComputedStyle(use).borderRadius,fs:getComputedStyle(use).fontSize,opacity:getComputedStyle(use).opacity}:null,
      cardGallery: r(document.querySelector('[class^="social-media-gallery-"]')),
      cardDetails: r(document.querySelector('[class^="social-media-details-"]')),
    };
  });
  await p.close();
  return o;
}
async function local(){
  const p=await (await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'})).newPage();
  await p.goto('http://localhost:5100/shoppable-carousel',{waitUntil:'domcontentloaded',timeout:60000});
  await p.waitForSelector('.sc-template-card',{state:'attached',timeout:60000});
  await p.waitForTimeout(2500);
  const o=await p.evaluate(()=>{
    const r=(el)=>{const b=el.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};};
    const secs=Array.from(document.querySelectorAll('.sc-sections > *'));
    const card=document.querySelector('.sc-template-card');
    const use=card.querySelector('.sc-template-use');
    return {
      sections: secs.map(el=>({y:r(el).y,h:r(el).h,title:el.querySelector('.pk-section-title,.pk-field-label-row .pk-section-title')?.textContent?.trim()})),
      uploadDrop: r(document.querySelector('.sc-sections .pk-dropzone')),
      selectBox: r(document.querySelector('.sc-sections .ant-select-selector, .sc-sections [class*=select]')),
      noText: r(document.querySelector('.sc-toggle-row')),
      textarea: r(document.querySelector('.sc-copy-editor textarea')),
      modeCard: r(document.querySelector('.sc-mode-option')),
      footer: r(document.querySelector('.sc-form-footer')),
      genBtn: r(document.querySelector('.pk-primary-btn')),
      catNav: {rect:r(document.querySelector('.sc-categories'))},
      card: r(card), useBtn: use?{rect:r(use),bg:getComputedStyle(use).backgroundColor,radius:getComputedStyle(use).borderRadius,fs:getComputedStyle(use).fontSize,opacity:getComputedStyle(use).opacity}:null,
      cardGallery: r(document.querySelector('.sc-template-gallery')),
      cardDetails: r(document.querySelector('.sc-template-details')),
    };
  });
  await p.close();
  return o;
}
const [R,L]=await Promise.all([ref(),local()]);
console.log(JSON.stringify({ref:R,local:L},null,1));
await b.close();
