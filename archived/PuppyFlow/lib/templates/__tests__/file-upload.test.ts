/**
 * File Upload Tests for CloudTemplateLoader
 *
 * Tests the multipart upload flow for file resources in template instantiation
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('CloudTemplateLoader - File Upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadFileToPuppyStorage API call sequence', () => {
    test('should use correct API endpoint and parameters for init', async () => {
      // Mock successful responses
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          upload_id: 'test-upload-id',
          key: 'generated-key',
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ upload_url: 'http://test-url' }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ etag: '"test-etag"' }),
        json: async () => ({}),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      // Import after mocking
      const { CloudTemplateLoader } = require('../cloud');
      const loader = new CloudTemplateLoader({ templatesPath: '/tmp/test' });

      // Test data
      const fileKey = 'test-user/test-block-id/files/test.pdf';
      const fileBuffer = Buffer.from('test content');
      const fileName = 'test.pdf';
      const mimeType = 'application/pdf';
      const userId = 'test-user';

      // Call the private method via reflection
      await (loader as any).uploadFileToPuppyStorage(
        fileKey,
        fileBuffer,
        fileName,
        mimeType,
        userId
      );

      // Verify init call
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/upload/init'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: expect.any(String),
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('"block_id":"test-block-id"'),
        })
      );

      // Verify init request body
      const initCall = mockFetch.mock.calls[0];
      const initBody = JSON.parse(initCall[1]?.body as string);

      expect(initBody).toEqual({
        block_id: 'test-block-id',
        file_name: 'test.pdf',
        content_type: 'application/pdf',
        file_size: fileBuffer.length,
      });
    });

    test('should correctly parse block_id from fileKey', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      // Mock responses
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ upload_id: 'id', key: 'key' }),
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ upload_url: 'url' }),
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ etag: '"etag"' }),
        json: async () => ({}),
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      const { CloudTemplateLoader } = require('../cloud');
      const loader = new CloudTemplateLoader({ templatesPath: '/tmp/test' });

      // Test various fileKey formats
      const testCases = [
        {
          fileKey: 'user123/block-abc/files/doc.pdf',
          expectedBlockId: 'block-abc',
        },
        {
          fileKey: 'local-user/ZcR28v/files/sample-local-pdf.pdf',
          expectedBlockId: 'ZcR28v',
        },
      ];

      for (const testCase of testCases) {
        jest.clearAllMocks();

        // Mock all 4 responses
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ upload_id: 'id', key: 'key' }),
        } as Response);
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ upload_url: 'url' }),
        } as Response);
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ etag: '"etag"' }),
          json: async () => ({}),
        } as Response);
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        } as Response);

        await (loader as any).uploadFileToPuppyStorage(
          testCase.fileKey,
          Buffer.from('test'),
          'test.pdf',
          'application/pdf',
          'test-user'
        );

        const initCall = mockFetch.mock.calls[0];
        const initBody = JSON.parse(initCall[1]?.body as string);

        expect(initBody.block_id).toBe(testCase.expectedBlockId);
      }
    });

    test('should follow complete multipart upload flow', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      const presignedUrl = 'http://presigned-url';

      // Mock all 4 steps
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ upload_id: 'upload-123', key: 'key-456' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ upload_url: presignedUrl }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ etag: '"abc123"' }),
          json: async () => ({}),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        } as Response);

      const { CloudTemplateLoader } = require('../cloud');
      const loader = new CloudTemplateLoader({ templatesPath: '/tmp/test' });

      await (loader as any).uploadFileToPuppyStorage(
        'user/block/files/test.pdf',
        Buffer.from('content'),
        'test.pdf',
        'application/pdf',
        'user'
      );

      // Verify 4 API calls were made
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Verify sequence
      expect(mockFetch.mock.calls[0][0]).toContain('/upload/init');
      expect(mockFetch.mock.calls[1][0]).toContain('/upload/get_upload_url');
      expect(mockFetch.mock.calls[2][0]).toBe(presignedUrl);
      expect(mockFetch.mock.calls[3][0]).toContain('/upload/complete');

      // Verify complete call includes ETag
      const completeCall = mockFetch.mock.calls[3];
      const completeBody = JSON.parse(completeCall[1]?.body as string);
      expect(completeBody.parts).toEqual([{ PartNumber: 1, ETag: 'abc123' }]);
    });

    test('should handle init failure with detailed error', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        text: async () =>
          JSON.stringify({
            detail: [{ loc: ['body', 'block_id'], msg: 'Field required' }],
          }),
      } as unknown as Response);

      const { CloudTemplateLoader } = require('../cloud');
      const loader = new CloudTemplateLoader({ templatesPath: '/tmp/test' });

      await expect(
        (loader as any).uploadFileToPuppyStorage(
          'user/block/files/test.pdf',
          Buffer.from('content'),
          'test.pdf',
          'application/pdf',
          'user'
        )
      ).rejects.toThrow('File upload init failed: 422');
    });
  });

  describe('fileKey parsing edge cases', () => {
    test('should handle fileKey with nested paths', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      // Clear all previous mocks
      jest.clearAllMocks();

      // Mock all 4 responses for this specific test
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ upload_id: 'id', key: 'key' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ upload_url: 'http://test-url' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ etag: '"etag"' }),
          json: async () => ({}),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        } as Response);

      const { CloudTemplateLoader } = require('../cloud');
      const loader = new CloudTemplateLoader({ templatesPath: '/tmp/test' });

      // fileKey: userId/blockId/path/to/file.pdf
      await (loader as any).uploadFileToPuppyStorage(
        'user123/block-xyz/subfolder/doc.pdf',
        Buffer.from('test'),
        'doc.pdf',
        'application/pdf',
        'user123'
      );

      const initCall = mockFetch.mock.calls[0];
      const initBody = JSON.parse(initCall[1]?.body as string);

      // Should still extract second segment as blockId
      expect(initBody.block_id).toBe('block-xyz');
    });
  });
});
