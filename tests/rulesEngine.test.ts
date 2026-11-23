import { describe, it, expect } from 'vitest';
import { parseRuleText } from '../src/engine/ruleParser';

describe('Rules Engine & Persian Parser (P0)', () => {
  it('parses collision triggers with score additions', () => {
    const rule = parseRuleText('اگر برخورد بازیکن با سکه آنگاه امتیاز +10');
    expect(rule).toBeDefined();
    expect(rule?.triggerType).toBe('on-collision');
    expect(rule?.targetName).toBe('بازیکن');
    expect(rule?.secondaryName).toBe('سکه');
    expect(rule?.actionType).toBe('add-score');
    expect(rule?.paramNumber).toBe(10);
  });

  it('parses health reduction triggers', () => {
    const rule = parseRuleText('اگر برخورد بازیکن با مانع آنگاه جان -20');
    expect(rule).toBeDefined();
    expect(rule?.triggerType).toBe('on-collision');
    expect(rule?.actionType).toBe('add-health');
    expect(rule?.paramNumber).toBe(-20);
  });

  it('parses scroll actions on UI boxes or containers', () => {
    const rule = parseRuleText('اگر اسکرول کادر لیست آنگاه اسکرول مقدار 50');
    expect(rule).toBeDefined();
    expect(rule?.triggerType).toBe('on-scroll');
    expect(rule?.actionType).toBe('scroll-box');
    expect(rule?.paramNumber).toBe(50);
  });

  it('parses jump triggers', () => {
    const rule = parseRuleText('اگر کلید پرش فشرده شد آنگاه پرش بازیکن');
    expect(rule).toBeDefined();
    expect(rule?.triggerType).toBe('key-press');
    expect(rule?.actionType).toBe('jump');
  });
});
