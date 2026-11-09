import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('Web reminder input and next-day calculation use Beijing time in different browser time zones', () => {
  const moduleUrl = new URL('../src/client/beijing-time.ts', import.meta.url).href
  const code = `import { parseBeijingTime, tomorrowNine, sameBeijingDay, beijingDate } from ${JSON.stringify(moduleUrl)};
    const ms = parseBeijingTime('2026-11-05T09:00');
    const next = tomorrowNine(Date.parse('2026-11-04T16:30:00Z'));
    const d = beijingDate(ms);
    console.log(JSON.stringify({ ms, next, hour: d.getUTCHours(), same: sameBeijingDay(ms, Date.parse('2026-11-05T16:30:00Z')),
      invalid: parseBeijingTime('2026-02-30T09:00') ?? null }));`
  for (const zone of ['America/Los_Angeles', 'Asia/Shanghai', 'Europe/London']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: zone }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      ms: Date.parse('2026-11-05T01:00:00Z'), next: Date.parse('2026-11-06T01:00:00Z'),
      hour: 9, same: false, invalid: null,
    })
  }
})
