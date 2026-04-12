import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(err.message));
await page.goto('http://localhost:5180');
await page.waitForTimeout(1000);

const body = await page.textContent('body');
const hasTodo = body.includes('To Do') || body.includes('Todo');
const hasProgress = body.includes('In Progress');
const hasDone = body.includes('Done');
console.log('COLUMNS:', JSON.stringify({ todo: hasTodo, progress: hasProgress, done: hasDone }));

const inputs = await page.$$('input');
const textareas = await page.$$('textarea');
const buttons = await page.$$('button');
console.log('ELEMENTS:', JSON.stringify({ inputs: inputs.length, textareas: textareas.length, buttons: buttons.length }));

if (inputs.length > 0) {
  await inputs[0].fill('Test Card');
  if (inputs.length > 1) await inputs[1].fill('Test Desc');
  else if (textareas.length > 0) await textareas[0].fill('Test Desc');
  if (buttons.length > 0) await buttons[0].click();
  await page.waitForTimeout(500);
  const afterBody = await page.textContent('body');
  console.log('CARD_ADDED:', afterBody.includes('Test Card'));
} else {
  console.log('CARD_ADDED: NO_INPUTS');
}

console.log('ERRORS:', errors.length ? errors.join('; ') : 'none');
console.log('BODY:', body.slice(0, 400));
await browser.close();
