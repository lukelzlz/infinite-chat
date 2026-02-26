import { Plugin } from './types';
import { Session } from '../core/types';
import { getRAGService } from '../rag';
import fs from 'fs';
import path from 'path';

/**
 * 文件读取插件
 * 
 * 命令：
 * - /file read <文件路径> - 读取文件内容
 * - /file load <文件路径> - 读取文件并添加到知识库
 * - /file ls [目录] - 列出目录内容
 */
export class FileReaderPlugin implements Plugin {
  name = 'file-reader';
  priority = 49;
  description = '文件读取和知识库导入';

  // 允许的文件扩展名
  private allowedExtensions = new Set([
    '.txt', '.md', '.json', '.csv', '.log',
    '.js', '.ts', '.py', '.java', '.go', '.rs',
    '.html', '.css', '.xml', '.yaml', '.yml',
    '.sh', '.bash', '.zsh',
  ]);

  // 最大文件大小 (5MB)
  private maxFileSize = 5 * 1024 * 1024;

  shouldHandle(content: string, session: Session): boolean {
    return content.startsWith('/file');
  }

  async handle(content: string, session: Session): Promise<string | null> {
    const args = content.slice(5).trim().split(/\s+/);
    const command = args[0]?.toLowerCase();

    try {
      switch (command) {
        case 'read':
        case 'cat':
          return await this.handleRead(args);
        case 'load':
        case 'import':
          return await this.handleLoad(args);
        case 'ls':
        case 'list':
        case 'dir':
          return await this.handleList(args);
        default:
          return this.getHelp();
      }
    } catch (error) {
      console.error('[FileReaderPlugin] Error:', error);
      return `❌ 操作失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  private async handleRead(args: string[]): Promise<string> {
    if (args.length < 2) {
      return '用法: /file read <文件路径>\n示例: /file read /home/user/notes.txt';
    }

    const filePath = args.slice(1).join(' ');
    
    // 安全检查
    const safetyCheck = this.checkPathSafety(filePath);
    if (!safetyCheck.safe) {
      return `❌ ${safetyCheck.reason}`;
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const stats = await fs.promises.stat(filePath);
      
      // 截断过长的内容
      const maxDisplay = 4000;
      const truncated = content.length > maxDisplay;
      const displayContent = truncated 
        ? content.slice(0, maxDisplay) + '\n\n... (内容已截断，共 ' + content.length + ' 字符)'
        : content;

      return `📄 文件: ${path.basename(filePath)}
📁 路径: ${filePath}
📊 大小: ${this.formatSize(stats.size)}
📅 修改: ${stats.mtime.toLocaleString('zh-CN')}

--- 内容 ---
${displayContent}`;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return `❌ 文件不存在: ${filePath}`;
      } else if (error.code === 'EACCES') {
        return `❌ 无权限读取: ${filePath}`;
      }
      throw error;
    }
  }

  private async handleLoad(args: string[]): Promise<string> {
    if (args.length < 2) {
      return '用法: /file load <文件路径>\n示例: /file load /home/user/manual.md';
    }

    const filePath = args.slice(1).join(' ');
    
    // 安全检查
    const safetyCheck = this.checkPathSafety(filePath);
    if (!safetyCheck.safe) {
      return `❌ ${safetyCheck.reason}`;
    }

    try {
      const rag = getRAGService();
      const doc = await rag.uploadFile(filePath);

      return `✅ 文件已导入知识库！

📄 文件名: ${doc.filename}
📁 路径: ${filePath}
🆔 文档ID: ${doc.id}
📊 大小: ${doc.metadata.size} 字符
📦 分块数: ${doc.chunks.length}

💡 现在可以直接问我关于这个文件的问题了！`;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return `❌ 文件不存在: ${filePath}`;
      } else if (error.code === 'EACCES') {
        return `❌ 无权限读取: ${filePath}`;
      }
      throw error;
    }
  }

  private async handleList(args: string[]): Promise<string> {
    const dirPath = args.length > 1 ? args.slice(1).join(' ') : '.';
    
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      
      const lines = entries.map(entry => {
        const icon = entry.isDirectory() ? '📁' : this.getFileIcon(entry.name);
        const name = entry.isDirectory() ? `${entry.name}/` : entry.name;
        return `${icon} ${name}`;
      });

      if (lines.length === 0) {
        return `📭 目录为空: ${dirPath}`;
      }

      const header = `📂 目录: ${path.resolve(dirPath)} (${entries.length} 项)\n`;
      return header + lines.join('\n');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return `❌ 目录不存在: ${dirPath}`;
      } else if (error.code === 'EACCES') {
        return `❌ 无权限访问: ${dirPath}`;
      } else if (error.code === 'ENOTDIR') {
        return `❌ 不是目录: ${dirPath}`;
      }
      throw error;
    }
  }

  private checkPathSafety(filePath: string): { safe: boolean; reason?: string } {
    // 检查扩展名
    const ext = path.extname(filePath).toLowerCase();
    if (ext && !this.allowedExtensions.has(ext)) {
      return { 
        safe: false, 
        reason: `不支持的文件类型: ${ext}。支持的类型: ${Array.from(this.allowedExtensions).join(', ')}` 
      };
    }

    // 检查路径遍历攻击
    const resolved = path.resolve(filePath);
    if (resolved.includes('..')) {
      return { safe: false, reason: '路径不能包含 ..' };
    }

    // 检查文件大小（同步检查，如果文件存在）
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > this.maxFileSize) {
        return { 
          safe: false, 
          reason: `文件过大: ${this.formatSize(stats.size)}，最大支持 ${this.formatSize(this.maxFileSize)}` 
        };
      }
    } catch {
      // 文件不存在，由后续处理
    }

    return { safe: true };
  }

  private getFileIcon(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const icons: Record<string, string> = {
      '.txt': '📄',
      '.md': '📝',
      '.json': '📋',
      '.csv': '📊',
      '.log': '📃',
      '.js': '📜',
      '.ts': '📜',
      '.py': '🐍',
      '.java': '☕',
      '.go': '🔷',
      '.rs': '🦀',
      '.html': '🌐',
      '.css': '🎨',
      '.xml': '📋',
      '.yaml': '⚙️',
      '.yml': '⚙️',
      '.sh': '💻',
    };
    return icons[ext] || '📄';
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private getHelp(): string {
    return `📖 文件读取插件

命令列表:
/file read <文件路径> - 读取文件内容
/file load <文件路径> - 读取文件并添加到知识库
/file ls [目录] - 列出目录内容

支持的文件类型:
${Array.from(this.allowedExtensions).join(', ')}

最大文件大小: ${this.formatSize(this.maxFileSize)}

💡 使用 /file load 导入文件后，AI 会自动参考知识库内容回答问题`;
  }
}
