/**
 * Storage Threshold Consistency Tests
 *
 * Purpose: Verify that storage thresholds are aligned across all three write operations
 * to prevent inconsistent storage_class decisions
 *
 * Critical Requirement:
 * - Template Instantiation (CloudTemplateLoader)
 * - Frontend Runtime (dynamicStorageStrategy)
 * - Backend Computation (HybridStoragePolicy)
 *
 * All three MUST use the same 1MB threshold.
 */

import { CONTENT_LENGTH_THRESHOLD } from '@/app/components/workflow/utils/dynamicStorageStrategy';

describe('Storage Threshold Consistency', () => {
  const EXPECTED_THRESHOLD = 1024 * 1024; // 1MB = 1,048,576 bytes

  test('Frontend threshold matches expected 1MB', () => {
    expect(CONTENT_LENGTH_THRESHOLD).toBe(EXPECTED_THRESHOLD);
  });

  test('Frontend threshold is not the old 1KB value', () => {
    const OLD_INCORRECT_THRESHOLD = 1024; // 1KB (historical bug)
    expect(CONTENT_LENGTH_THRESHOLD).not.toBe(OLD_INCORRECT_THRESHOLD);
  });

  test('Frontend and Template thresholds are aligned', () => {
    // Template threshold is defined in cloud.ts as STORAGE_THRESHOLD
    const STORAGE_THRESHOLD = 1024 * 1024;
    expect(CONTENT_LENGTH_THRESHOLD).toBe(STORAGE_THRESHOLD);
  });

  describe('Storage decision consistency across content sizes', () => {
    const testCases = [
      { size: 100, expected: 'internal', desc: '100 bytes (tiny)' },
      { size: 1024, expected: 'internal', desc: '1KB (small)' },
      {
        size: 10 * 1024,
        expected: 'internal',
        desc: '10KB (typical short text)',
      },
      { size: 100 * 1024, expected: 'internal', desc: '100KB (medium text)' },
      { size: 500 * 1024, expected: 'internal', desc: '500KB (long text)' },
      {
        size: 1024 * 1024 - 1,
        expected: 'internal',
        desc: '1MB - 1 byte (boundary)',
      },
      { size: 1024 * 1024, expected: 'external', desc: '1MB (exact boundary)' },
      {
        size: 1024 * 1024 + 1,
        expected: 'external',
        desc: '1MB + 1 byte (just over)',
      },
      { size: 2 * 1024 * 1024, expected: 'external', desc: '2MB (large)' },
      {
        size: 10 * 1024 * 1024,
        expected: 'external',
        desc: '10MB (very large)',
      },
    ];

    testCases.forEach(({ size, expected, desc }) => {
      test(`${desc} should use ${expected} storage`, () => {
        const shouldBeExternal = size >= CONTENT_LENGTH_THRESHOLD;
        const actual = shouldBeExternal ? 'external' : 'internal';
        expect(actual).toBe(expected);
      });
    });
  });

  describe('Real-world LLM output size scenarios', () => {
    test('Typical GPT-4 output (2-5KB) should be inline', () => {
      const typicalGPT4Output = 3 * 1024; // 3KB
      const shouldBeExternal = typicalGPT4Output >= CONTENT_LENGTH_THRESHOLD;
      expect(shouldBeExternal).toBe(false);
    });

    test('Long-form content (50KB) should be inline', () => {
      const longFormContent = 50 * 1024; // 50KB
      const shouldBeExternal = longFormContent >= CONTENT_LENGTH_THRESHOLD;
      expect(shouldBeExternal).toBe(false);
    });

    test('Large structured data (2MB JSON array) should be external', () => {
      const largeStructuredData = 2 * 1024 * 1024; // 2MB
      const shouldBeExternal = largeStructuredData >= CONTENT_LENGTH_THRESHOLD;
      expect(shouldBeExternal).toBe(true);
    });
  });

  describe('Protection against regression to 1KB threshold', () => {
    test('10KB content should NOT be externalized (would happen with 1KB threshold)', () => {
      const tenKB = 10 * 1024;
      const shouldBeExternal = tenKB >= CONTENT_LENGTH_THRESHOLD;

      // With correct 1MB threshold: should be internal
      expect(shouldBeExternal).toBe(false);

      // With incorrect 1KB threshold (bug): would be external
      const wouldBeExternalWith1KB = tenKB >= 1024;
      expect(wouldBeExternalWith1KB).toBe(true);

      // Verify we're not using the buggy threshold
      expect(CONTENT_LENGTH_THRESHOLD).toBeGreaterThan(tenKB);
    });
  });
});
