import { describe, it, expect, vi } from 'vitest';
import { LocalModelProvider } from '../src/llm/index';
import { LLMConfig } from '../src/core/types';

describe('LLM Providers', () => {
  describe('LocalModelProvider', () => {
    it('should create provider with config', () => {
      const config: LLMConfig = {
        provider: 'local',
        model: 'llama3',
        baseUrl: 'http://localhost:11434',
      };
      
      const provider = new LocalModelProvider(config);
      expect(provider).toBeDefined();
    });

    // Note: Actual API calls would be mocked in real tests
    it('should have chat method', () => {
      const config: LLMConfig = {
        provider: 'local',
        model: 'llama3',
      };
      
      const provider = new LocalModelProvider(config);
      expect(typeof provider.chat).toBe('function');
      expect(typeof provider.streamChat).toBe('function');
    });
  });
});

describe('LLM Factory', () => {
  it('should create OpenAI provider', async () => {
    const { createLLMProvider } = await import('../src/llm/index');
    
    const config: LLMConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
    };
    
    const provider = createLLMProvider(config);
    expect(provider).toBeDefined();
  });

  it('should throw error for unknown provider', async () => {
    const { createLLMProvider } = await import('../src/llm/index');
    
    const config = {
      provider: 'unknown' as any,
      model: 'test',
    };
    
    expect(() => createLLMProvider(config)).toThrow('Unknown LLM provider');
  });
});
