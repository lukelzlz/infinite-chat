import { describe, it, expect } from 'vitest';
import {
  validateUrl,
  escapeCssSelector,
  escapeJsString,
  generateSecureId,
  generateUuid,
  safeJsonParse,
  validateInputLength,
  sanitizeHtml,
  validateApiKey,
  constantTimeCompare,
  validateFilePath,
} from '../src/utils/security';

describe('Security Utils', () => {
  describe('validateUrl', () => {
    it('should accept valid HTTP URLs', () => {
      const result = validateUrl('https://example.com/path');
      expect(result.valid).toBe(true);
      expect(result.normalizedUrl).toBe('https://example.com/path');
    });

    it('should add https:// prefix if missing', () => {
      const result = validateUrl('example.com');
      expect(result.valid).toBe(true);
      expect(result.normalizedUrl).toBe('https://example.com');
    });

    it('should reject private IP addresses (SSRF protection)', () => {
      expect(validateUrl('http://127.0.0.1/admin').valid).toBe(false);
      expect(validateUrl('http://10.0.0.1/admin').valid).toBe(false);
      expect(validateUrl('http://192.168.1.1/admin').valid).toBe(false);
      expect(validateUrl('http://172.16.0.1/admin').valid).toBe(false);
      expect(validateUrl('http://169.254.169.254/metadata').valid).toBe(false);
    });

    it('should reject localhost', () => {
      expect(validateUrl('http://localhost/admin').valid).toBe(false);
    });

    it('should reject dangerous protocols', () => {
      expect(validateUrl('file:///etc/passwd').valid).toBe(false);
      expect(validateUrl('ftp://example.com').valid).toBe(false);
      expect(validateUrl('data:text/html,<script>alert(1)</script>').valid).toBe(false);
    });

    it('should reject URLs with credentials', () => {
      expect(validateUrl('https://user:pass@example.com').valid).toBe(false);
    });

    it('should reject cloud metadata endpoints', () => {
      expect(validateUrl('http://metadata.google.internal').valid).toBe(false);
    });

    it('should allow private IPs when explicitly allowed', () => {
      const result = validateUrl('http://192.168.1.1/admin', { allowPrivateIp: true });
      expect(result.valid).toBe(true);
    });

    it('should respect host whitelist', () => {
      expect(validateUrl('https://evil.com', { allowedHosts: ['example.com'] }).valid).toBe(false);
      expect(validateUrl('https://example.com', { allowedHosts: ['example.com'] }).valid).toBe(true);
    });

    it('should reject overly long URLs', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(3000);
      expect(validateUrl(longUrl).valid).toBe(false);
    });
  });

  describe('escapeCssSelector', () => {
    it('should keep safe selectors unchanged', () => {
      expect(escapeCssSelector('#my-id')).toBe('#my-id');
      expect(escapeCssSelector('.my-class')).toBe('.my-class');
      expect(escapeCssSelector('div > span')).toBe('div > span');
    });

    it('should remove dangerous characters', () => {
      // escapeCssSelector 移除不在白名單中的字符
      // 白名單包括字母、數字、-、_、空格、>、+、~、*、.、#、:、[]、()、引號
      const result = escapeCssSelector("test\x00selector"); // null 字節
      expect(result).not.toContain('\x00');

      // 反斜杠會被移除
      const result2 = escapeCssSelector('test\\selector');
      expect(result2).not.toContain('\\');
    });

    it('should handle empty input', () => {
      expect(escapeCssSelector('')).toBe('');
      expect(escapeCssSelector(null as any)).toBe('');
    });
  });

  describe('escapeJsString', () => {
    it('should escape single quotes', () => {
      expect(escapeJsString("it's")).toBe("it\\'s");
    });

    it('should escape double quotes', () => {
      expect(escapeJsString('say "hello"')).toBe('say \\"hello\\"');
    });

    it('should escape backslashes', () => {
      expect(escapeJsString('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('should escape special characters for XSS prevention', () => {
      const escaped = escapeJsString('<script>alert(1)</script>');
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
    });
  });

  describe('generateSecureId', () => {
    it('should generate ID of specified length', () => {
      expect(generateSecureId(8).length).toBe(8);
      expect(generateSecureId(16).length).toBe(16);
      expect(generateSecureId(32).length).toBe(32);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSecureId(16));
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('generateUuid', () => {
    it('should generate valid UUID format', () => {
      const uuid = generateUuid();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        uuids.add(generateUuid());
      }
      expect(uuids.size).toBe(100);
    });
  });

  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      expect(safeJsonParse('{"name":"test"}', null)).toEqual({ name: 'test' });
    });

    it('should return default value for invalid JSON', () => {
      expect(safeJsonParse('not json', { default: true })).toEqual({ default: true });
    });

    it('should prevent prototype pollution', () => {
      const malicious = '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}';
      const result = safeJsonParse(malicious, {});

      // __proto__ 和 constructor 鍵會被過濾掉
      expect(result.hasOwnProperty('__proto__')).toBe(false);
      // 檢查結果對象沒有被污染
      expect((result as any).polluted).toBeUndefined();
    });
  });

  describe('validateInputLength', () => {
    it('should accept valid input length', () => {
      const result = validateInputLength('hello', 10);
      expect(result.valid).toBe(true);
    });

    it('should reject input exceeding max length', () => {
      const result = validateInputLength('hello world', 5);
      expect(result.valid).toBe(false);
      expect(result.truncated).toBe('hello');
    });

    it('should reject empty input', () => {
      const result = validateInputLength('', 10);
      expect(result.valid).toBe(false);
    });
  });

  describe('sanitizeHtml', () => {
    it('should remove script tags', () => {
      expect(sanitizeHtml('<script>alert(1)</script>Hello')).toBe('Hello');
    });

    it('should remove style tags', () => {
      expect(sanitizeHtml('<style>body{}</style>Hello')).toBe('Hello');
    });

    it('should remove all HTML tags', () => {
      expect(sanitizeHtml('<div><span>Hello</span></div>')).toBe('Hello');
    });

    it('should decode HTML entities', () => {
      expect(sanitizeHtml('&lt;test&gt;')).toBe('<test>');
      expect(sanitizeHtml('&amp;')).toBe('&');
    });

    it('should handle nested tags', () => {
      const html = '<div><script>alert(1)</script><p>text</p></div>';
      expect(sanitizeHtml(html)).toBe('text');
    });

    it('should limit input length to prevent DoS', () => {
      const longHtml = '<script>' + 'a'.repeat(200000) + '</script>';
      const result = sanitizeHtml(longHtml);
      expect(result.length).toBeLessThan(150000);
    });
  });

  describe('validateApiKey', () => {
    it('should accept valid API keys', () => {
      expect(validateApiKey('sk-1234567890abcdef')).toBe(true);
      expect(validateApiKey('1234567890')).toBe(true);
    });

    it('should reject placeholder keys', () => {
      expect(validateApiKey('your-api-key-here')).toBe(false);
      expect(validateApiKey('placeholder')).toBe(false);
      expect(validateApiKey('test')).toBe(false);
    });

    it('should reject short keys', () => {
      expect(validateApiKey('abc')).toBe(false);
    });

    it('should reject empty keys', () => {
      expect(validateApiKey('')).toBe(false);
      expect(validateApiKey(null as any)).toBe(false);
    });
  });

  describe('constantTimeCompare', () => {
    it('should return true for equal strings', () => {
      expect(constantTimeCompare('hello', 'hello')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(constantTimeCompare('hello', 'world')).toBe(false);
    });

    it('should return false for different lengths', () => {
      expect(constantTimeCompare('hello', 'helloworld')).toBe(false);
    });

    it('should handle invalid inputs', () => {
      expect(constantTimeCompare(null as any, 'test')).toBe(false);
      expect(constantTimeCompare('test', undefined as any)).toBe(false);
    });
  });

  describe('validateFilePath', () => {
    it('should accept paths within allowed directories', () => {
      const result = validateFilePath('/app/config/test.yaml', ['/app/config']);
      expect(result.valid).toBe(true);
    });

    it('should reject path traversal attempts', () => {
      expect(validateFilePath('../../../etc/passwd', ['/app']).valid).toBe(false);
      expect(validateFilePath('..\\..\\windows\\system32', ['/app']).valid).toBe(false);
    });

    it('should reject null bytes', () => {
      expect(validateFilePath('/app/config\0.txt', ['/app']).valid).toBe(false);
    });

    it('should reject overly long paths', () => {
      const longPath = '/app/' + 'a'.repeat(5000);
      expect(validateFilePath(longPath, ['/app']).valid).toBe(false);
    });

    it('should reject paths outside allowed directories', () => {
      expect(validateFilePath('/etc/passwd', ['/app/config']).valid).toBe(false);
    });
  });

  describe('IPv6 localhost protection', () => {
    it('should reject IPv6 localhost addresses', () => {
      expect(validateUrl('http://[::1]/admin').valid).toBe(false);
      expect(validateUrl('http://[0:0:0:0:0:0:0:1]/admin').valid).toBe(false);
    });
  });

  describe('Cloud metadata endpoint protection', () => {
    it('should reject AWS metadata endpoint', () => {
      expect(validateUrl('http://169.254.169.254/latest/meta-data/').valid).toBe(false);
    });

    it('should reject GCP metadata endpoint', () => {
      expect(validateUrl('http://metadata.google.internal/computeMetadata/v1/').valid).toBe(false);
    });

    it('should reject Azure metadata endpoint', () => {
      expect(validateUrl('http://169.254.169.254/metadata/instance').valid).toBe(false);
    });
  });

  describe('URL redirect protection', () => {
    it('should normalize URLs correctly', () => {
      const result = validateUrl('  https://example.com/path  ');
      expect(result.valid).toBe(true);
      expect(result.normalizedUrl).toBe('https://example.com/path');
    });

    it('should handle protocol-relative URLs', () => {
      // Without protocol, it should add https://
      const result = validateUrl('example.com/path');
      expect(result.valid).toBe(true);
      expect(result.normalizedUrl).toBe('https://example.com/path');
    });
  });

  describe('Data URI protection', () => {
    it('should reject data URIs', () => {
      expect(validateUrl('data:text/html,<script>alert(1)</script>').valid).toBe(false);
      expect(validateUrl('data:image/svg+xml,<svg onload=alert(1)>').valid).toBe(false);
    });
  });

  describe('Multicast and reserved IP protection', () => {
    it('should reject multicast addresses', () => {
      expect(validateUrl('http://224.0.0.1/test').valid).toBe(false);
    });

    it('should reject reserved addresses', () => {
      expect(validateUrl('http://240.0.0.1/test').valid).toBe(false);
    });

    it('should reject 0.0.0.0', () => {
      expect(validateUrl('http://0.0.0.0/test').valid).toBe(false);
    });
  });
});
