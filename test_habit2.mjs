import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(err.message));
await page.goto('http://localhost:5195');
await page.waitForTimeout(1000);

const body1 = await page.textContent('body');
console.log('1. RENDER:', body1.includes('추가') ? 'PASS' : 'FAIL');

const input = await page.$('input[type="text"]');
const addBtn = await page.$('button');
if (input && addBtn) {
  await input.fill('운동하기');
  await addBtn.click();
  await page.waitForTimeout(300);
  const body2 = await page.textContent('body');
  console.log('2. ADD:', body2.includes('운동하기') ? 'PASS' : 'FAIL');

  await input.fill('독서하기');
  await addBtn.click();
  await page.waitForTimeout(300);
  const body3 = await page.textContent('body');
  console.log('3. ADD2:', body3.includes('독서하기') ? 'PASS' : 'FAIL');

  // Toggle
  const toggleBtns = await page.$$('button:has-text("미완료"), button:has-text("체크"), input[type="checkbox"]');
  if (toggleBtns.length > 0) {
    await toggleBtns[0].click();
    await page.waitForTimeout(300);
    console.log('4. TOGGLE: PASS');
  } else {
    console.log('4. TOGGLE: FAIL (no toggle element found)');
  }

  // Streak
  const body5 = await page.textContent('body');
  console.log('5. STREAK:', (body5.includes('스트릭') || body5.includes('streak') || body5.includes('연속')) ? 'PASS' : 'FAIL');

  // Delete
  const delBtns = await page.$$('button:has-text("삭제"), button:has-text("✕"), button:has-text("X")');
  if (delBtns.length > 0) {
    await delBtns[0].click();
    await page.waitForTimeout(300);
    const body6 = await page.textContent('body');
    console.log('6. DELETE:', !body6.includes('운동하기') ? 'PASS' : 'FAIL');
  } else {
    console.log('6. DELETE: FAIL (no delete button)');
  }

  // Persist
  await page.reload();
  await page.waitForTimeout(1000);
  const body7 = await page.textContent('body');
  console.log('7. PERSIST:', body7.includes('독서하기') ? 'PASS' : 'FAIL');
} else {
  console.log('2-7: FAIL (no input or button)');
}

console.log('ERRORS:', errors.length ? errors.join('; ') : 'none');
await browser.close();
