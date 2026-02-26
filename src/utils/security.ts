/**
 * 安全工具模組
 *
 * 提供輸入驗證、URL 安全檢查、隨機數生成等安全相關功能
 */

import crypto from 'crypto';
import path from 'path';

/**
 * 內網 IP 範圍列表（用於 SSRF 防護）
 */
const PRIVATE_IP_RANGES = [
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^127\./,                         // 127.0.0.0/8 (localhost)
  /^169\.254\./,                    // 169.254.0.0/16 (link-local)
  /^0\.0\.0\.0/,                    // 0.0.0.0/8
  /^224\./,                         // 224.0.0.0/4 (multicast)
  /^240\./,                         // 240.0.0.0/4 (reserved)
];

/**
 * 危險協議列表
 */
const DANGEROUS_PROTOCOLS = ['file:', 'ftp:', 'sftp:', 'ssh:', 'telnet:', 'gopher:', 'data:'];

/**
 * 允許的 URL 協議
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * URL 驗證結果
 */
export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  normalizedUrl?: string;
}

/**
 * 驗證 URL 是否安全（SSRF 防護）
 *
 * @param url - 要驗證的 URL
 * @param options - 驗證選項
 * @returns 驗證結果
 */
export function validateUrl(url: string, options: {
  allowPrivateIp?: boolean;
  allowedHosts?: string[];
  blockedHosts?: string[];
} = {}): UrlValidationResult {
  const { allowPrivateIp = false, allowedHosts = [], blockedHosts = [] } = options;

  // 基本檢查
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL 是空的或格式不正確' };
  }

  // 長度限制
  if (url.length > 2048) {
    return { valid: false, error: 'URL 長度超過限制' };
  }

  // 添加協議前綴（如果沒有）
  let normalizedUrl = url.trim();
  if (!normalizedUrl.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:/)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch (e) {
    return { valid: false, error: '無效的 URL 格式' };
  }

  // 檢查協議
  const protocol = parsedUrl.protocol.toLowerCase();
  if (!ALLOWED_PROTOCOLS.includes(protocol)) {
    return { valid: false, error: `不允許的協議: ${protocol}` };
  }

  // 檢查危險協議（防止協議混淆攻擊）
  for (const dangerous of DANGEROUS_PROTOCOLS) {
    if (url.toLowerCase().startsWith(dangerous)) {
      return { valid: false, error: `不允許的協議: ${dangerous}` };
    }
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // 檢查黑名單主機
  if (blockedHosts.some(blocked => hostname === blocked || hostname.endsWith('.' + blocked))) {
    return { valid: false, error: `主機在黑名單中: ${hostname}` };
  }

  // 檢查白名單（如果設置了）
  if (allowedHosts.length > 0) {
    if (!allowedHosts.some(allowed => hostname === allowed || hostname.endsWith('.' + allowed))) {
      return { valid: false, error: `主機不在白名單中: ${hostname}` };
    }
  }

  // 檢查內網 IP（SSRF 防護）
  if (!allowPrivateIp) {
    // 檢查是否為 IP 地址
    const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
                        /^\[[0-9a-fA-F:]+\]$/.test(hostname);

    if (isIpAddress) {
      const ipToCheck = hostname.replace(/^\[|\]$/g, '');

      // 檢查私有 IP 範圍
      for (const range of PRIVATE_IP_RANGES) {
        if (range.test(ipToCheck)) {
          return { valid: false, error: '不允許訪問私有 IP 地址' };
        }
      }

      // 棢查 IPv6 localhost
      if (ipToCheck === '::1' || ipToCheck === '0:0:0:0:0:0:0:1') {
        return { valid: false, error: '不允許訪問 localhost' };
      }
    }

    // 檢查特殊主機名
    const blockedHostnames = ['localhost', 'localhost.localdomain', 'ip6-localhost',
                               'ip6-loopback', 'metadata.google.internal',
                               'metadata.azure'];
    if (blockedHostnames.includes(hostname)) {
      return { valid: false, error: `不允許訪問: ${hostname}` };
    }
  }

  // 檢查憑證信息（不允許 URL 中包含用戶名密碼）
  if (parsedUrl.username || parsedUrl.password) {
    return { valid: false, error: 'URL 中不允許包含憑證信息' };
  }

  return { valid: true, normalizedUrl };
}

/**
 * 轉義 CSS 選擇器中的特殊字符
 *
 * @param selector - CSS 選擇器
 * @returns 轉義後的選擇器
 */
export function escapeCssSelector(selector: string): string {
  if (!selector || typeof selector !== 'string') {
    return '';
  }

  // 只允許安全的 CSS 選擇器字符
  // 允許：字母、數字、-、_、空格、>、+、~、*、.、#、:、[]、()
  const safePattern = /^[a-zA-Z0-9\-_\s>+~*.#:\[\]()="'']+$/;

  if (!safePattern.test(selector)) {
    // 如果包含不安全字符，嘗試轉義
    return selector.replace(/[^\w\s\-_>#.+~:*[\]()='"']/g, '');
  }

  return selector;
}

/**
 * 轉義字符串用於 JavaScript 字符串字面量
 *
 * @param str - 要轉義的字符串
 * @returns 轉義後的字符串
 */
export function escapeJsString(str: string): string {
  if (!str || typeof str !== 'string') {
    return '';
  }

  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/</g, '\\x3C')
    .replace(/>/g, '\\x3E')
    .replace(/\$/g, '\\x24');
}

/**
 * 生成加密安全的隨機 ID
 *
 * @param length - ID 長度（默認 16）
 * @returns 隨機 ID 字符串
 */
export function generateSecureId(length: number = 16): string {
  const bytes = crypto.randomBytes(Math.ceil(length / 2));
  return bytes.toString('hex').slice(0, length);
}

/**
 * 生成 UUID v4
 *
 * @returns UUID 字符串
 */
export function generateUuid(): string {
  return crypto.randomUUID();
}

/**
 * 安全的 JSON 解析
 *
 * @param str - JSON 字符串
 * @param defaultValue - 解析失敗時的默認值
 * @returns 解析結果或默認值
 */
export function safeJsonParse<T>(str: string, defaultValue: T): T {
  try {
    // 檢查原型污染攻擊
    const parsed = JSON.parse(str, (key, value) => {
      // 阻止 __proto__, constructor, prototype 等危險鍵
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    });
    return parsed;
  } catch (e) {
    return defaultValue;
  }
}

/**
 * 驗證輸入長度
 *
 * @param input - 輸入字符串
 * @param maxLength - 最大長度
 * @param fieldName - 字段名稱（用於錯誤消息）
 * @returns 驗證結果
 */
export function validateInputLength(
  input: string,
  maxLength: number,
  fieldName: string = '輸入'
): { valid: boolean; error?: string; truncated?: string } {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: `${fieldName}無效` };
  }

  if (input.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName}長度超過限制（最大 ${maxLength} 字符）`,
      truncated: input.slice(0, maxLength),
    };
  }

  return { valid: true };
}

/**
 * 清理 HTML 標籤
 *
 * @param html - HTML 字符串
 * @returns 純文本
 */
export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  // 限制輸入長度防止 DoS
  const maxLength = 100000;
  let text = html.length > maxLength ? html.slice(0, maxLength) : html;

  // 使用更安全的方式移除 script 和 style 標籤
  // 避免使用可能導致 ReDoS 的嵌套正則表達式

  // 移除 script 標籤（簡化版本，避免回溯）
  let prevText;
  do {
    prevText = text;
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  } while (text !== prevText);

  // 移除 style 標籤
  do {
    prevText = text;
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  } while (text !== prevText);

  // 移除所有 HTML 標籤
  text = text.replace(/<[^>]*>/g, '');

  // 解碼 HTML 實體
  const entities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };

  for (const [entity, char] of Object.entries(entities)) {
    text = text.replace(new RegExp(entity, 'gi'), char);
  }

  // 解碼數字實體（限制範圍防止濫用）
  text = text.replace(/&#(\d{1,5});/g, (_, code) => {
    const num = parseInt(code, 10);
    // 只允許合理的 Unicode 範圍
    if (num > 0 && num < 0x10FFFF) {
      return String.fromCharCode(num);
    }
    return '';
  });

  text = text.replace(/&#x([0-9a-fA-F]{1,4});/g, (_, code) => {
    const num = parseInt(code, 16);
    if (num > 0 && num < 0x10FFFF) {
      return String.fromCharCode(num);
    }
    return '';
  });

  return text.trim();
}

/**
 * 驗證 API 金鑰格式
 *
 * @param apiKey - API 金鑰
 * @returns 是否有效
 */
export function validateApiKey(apiKey: string): boolean {
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }

  // 檢查是否為空或佔位符
  const placeholders = [
    'your-api-key-here',
    'your_api_key_here',
    'your-api-key',
    'your_api_key',
    'placeholder',
    'xxx',
    'test',
  ];

  const lowerKey = apiKey.toLowerCase();
  if (placeholders.some(p => lowerKey === p)) {
    return false;
  }

  // 檢查最小長度
  if (apiKey.length < 10) {
    return false;
  }

  return true;
}

/**
 * 常量時間字符串比較（防止時序攻擊）
 *
 * @param a - 字符串 A
 * @param b - 字符串 B
 * @returns 是否相等
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const aLen = a.length;
  const bLen = b.length;

  // 使用 crypto.timingSafeEqual 需要 Buffer
  const bufA = Buffer.alloc(aLen, a, 'utf8');
  const bufB = Buffer.alloc(bLen, b, 'utf8');

  if (bufA.length !== bufB.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * 路徑驗證結果
 */
export interface PathValidationResult {
  valid: boolean;
  error?: string;
  normalizedPath?: string;
}

/**
 * 驗證文件路徑是否安全（防止路徑遍歷攻擊）
 *
 * @param filePath - 要驗證的文件路徑
 * @param allowedBaseDirs - 允許的基礎目錄列表
 * @returns 驗證結果
 */
export function validateFilePath(
  filePath: string,
  allowedBaseDirs: string[]
): PathValidationResult {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: '路徑無效' };
  }

  // 檢查路徑長度
  if (filePath.length > 4096) {
    return { valid: false, error: '路徑長度超過限制' };
  }

  // 檢查危險模式
  const dangerousPatterns = [
    /\.\./,           // 目錄遍歷
    /\0/,             // 空字節
    /^\/\//,          // 雙斜槓開頭
    /^[a-zA-Z]:/,     // Windows 絕對路徑
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(filePath)) {
      return { valid: false, error: '路徑包含不允許的字符' };
    }
  }

  // 規範化路徑
  const normalized = path.normalize(filePath);

  // 再次檢查目錄遍歷
  if (normalized.includes('..')) {
    return { valid: false, error: '路徑包含目錄遍歷' };
  }

  // 檢查是否在允許的目錄內
  const resolved = path.resolve(normalized);
  const isInAllowedDir = allowedBaseDirs.some(baseDir => {
    const resolvedBase = path.resolve(baseDir);
    return resolved.startsWith(resolvedBase + path.sep) || resolved === resolvedBase;
  });

  if (!isInAllowedDir) {
    return { valid: false, error: '路徑不在允許的目錄範圍內' };
  }

  return { valid: true, normalizedPath: resolved };
}
