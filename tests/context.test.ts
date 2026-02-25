import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from '../src/core/context';
import { MemoryConfig } from '../src/core/types';

describe('ContextManager', () => {
  let contextManager: ContextManager;
  const config: MemoryConfig = {
    shortTermWindow: 5,
    compressThreshold: 10,
  };

  beforeEach(() => {
    contextManager = new ContextManager(config);
  });

  describe('addMessage', () => {
    it('should add a message and return it with id and timestamp', async () => {
      const message = await contextManager.addMessage('test-session', {
        sessionId: 'test-session',
        role: 'user',
        content: 'Hello!',
      });

      expect(message.id).toBeDefined();
      expect(message.timestamp).toBeDefined();
      expect(message.content).toBe('Hello!');
      expect(message.role).toBe('user');
    });

    it('should maintain sliding window', async () => {
      const sessionId = 'sliding-test';
      
      // Add 7 messages (window is 5)
      for (let i = 0; i < 7; i++) {
        await contextManager.addMessage(sessionId, {
          sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const stats = contextManager.getStats(sessionId);
      expect(stats.messages).toBe(5);
    });
  });

  describe('getContext', () => {
    it('should return empty array for non-existent session', async () => {
      const context = await contextManager.getContext('non-existent');
      expect(context).toEqual([]);
    });

    it('should return messages for existing session', async () => {
      const sessionId = 'context-test';
      
      await contextManager.addMessage(sessionId, {
        sessionId,
        role: 'user',
        content: 'Hello',
      });
      await contextManager.addMessage(sessionId, {
        sessionId,
        role: 'assistant',
        content: 'Hi there!',
      });

      const context = await contextManager.getContext(sessionId);
      expect(context.length).toBe(2);
      expect(context[0].content).toBe('Hello');
      expect(context[1].content).toBe('Hi there!');
    });
  });

  describe('clearContext', () => {
    it('should clear all messages for a session', async () => {
      const sessionId = 'clear-test';
      
      await contextManager.addMessage(sessionId, {
        sessionId,
        role: 'user',
        content: 'Test',
      });

      contextManager.clearContext(sessionId);
      
      const stats = contextManager.getStats(sessionId);
      expect(stats.messages).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', async () => {
      const sessionId = 'stats-test';
      
      await contextManager.addMessage(sessionId, {
        sessionId,
        role: 'user',
        content: 'Test 1',
      });
      await contextManager.addMessage(sessionId, {
        sessionId,
        role: 'assistant',
        content: 'Response 1',
      });

      const stats = contextManager.getStats(sessionId);
      expect(stats.messages).toBe(2);
      expect(stats.summaries).toBe(0);
    });
  });
});
