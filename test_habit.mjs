import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(err.message));
await page.goto('http://localhost:5190');
await page.waitForTimeout(1000);

// 1. Initial render — form should be visible
const body1 = await page.textContent('body');
console.log('1. RENDER:', body1.includes('추가') ? 'PASS (추가 버튼 보임)' : 'FAIL');

// 2. Add habit
const input = await page.$('input[type="text"]');
const addBtn = await page.$('button');
if (input && addBtn) {
  await input.fill('운동하기');
  await addBtn.click();
  await page.waitForTimeout(300);
  const body2 = await page.textContent('body');
  console.log('2. ADD:', body2.includes('운동하기') ? 'PASS' : 'FAIL');

  // 3. Add second habit
  await input.fill('독서하기');
  await addBtn.click();
  await page.waitForTimeout(300);
  const body3 = await page.textContent('body');
  console.log('3. ADD2:', body3.includes('독서하기') ? 'PASS' : 'FAIL');

  // 4. Toggle completion
  const toggleBtns = await page.$$('button:has-text("미완료")');
  if (toggleBtns.length > 0) {
    await toggleBtns[0].click();
    await page.waitForTimeout(300);
    const body4 = await page.textContent('body');
    console.log('4. TOGGLE:', body4.includes('완료') ? 'PASS' : 'FAIL');
  } else {
    console.log('4. TOGGLE: FAIL (no toggle button found)');
  }

  // 5. Streak display
  const body5 = await page.textContent('body');
  console.log('5. STREAK:', body5.includes('스트릭') ? 'PASS' : 'FAIL');

  // 6. Delete habit
  const delBtns = await page.$$('button:has-text("✕")');
  if (delBtns.length > 0) {
    const countBefore = (await page.$$('.habit-item')).length;
    await delBtns[0].click();
    await page.waitForTimeout(300);
    const countAfter = (await page.$$('.habit-item')).length;
    console.log('6. DELETE:', countAfter < countBefore ? 'PASS' : 'FAIL');
  } else {
    console.log('6. DELETE: FAIL (no delete button found)');
  }

  // 7. Persistence — reload and check
  await page.reload();
  await page.waitForTimeout(1000);
  const body7 = await page.textContent('body');
  console.log('7. PERSIST:', body7.includes('독서하기') ? 'PASS' : 'FAIL');
} else {
  console.log('2-7: FAIL (no input or button found)');
}

console.log('ERRORS:', errors.length ? errors.join('; ') : 'none');
await browser.close();
