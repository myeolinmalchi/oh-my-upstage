import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(err.message));
await page.goto('http://localhost:5181');
await page.waitForTimeout(1500);

const body = await page.textContent('body');
console.log('BODY:', body.slice(0, 400));
console.log('HAS_MEMOS:', body.includes('Test Memo') || body.includes('memo'));

const inputs = await page.$$('input');
const textareas = await page.$$('textarea');
const buttons = await page.$$('button');
console.log('ELEMENTS:', JSON.stringify({ inputs: inputs.length, textareas: textareas.length, buttons: buttons.length }));

if (inputs.length > 0) {
  await inputs[0].fill('New Memo');
  if (textareas.length > 0) await textareas[0].fill('Memo content test');
  const submitBtn = await page.$('button[type="submit"]') || buttons[0];
  if (submitBtn) {
    await submitBtn.click();
    await page.waitForTimeout(1000);
    const afterBody = await page.textContent('body');
    console.log('MEMO_ADDED:', afterBody.includes('New Memo'));
  }
}

console.log('ERRORS:', errors.length ? errors.join('; ') : 'none');
await browser.close();
