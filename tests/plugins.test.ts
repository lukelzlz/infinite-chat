import { describe, it, expect } from 'vitest';
import { PluginManager, EchoPlugin, HelpPlugin } from '../src/plugins/index';
import { Session } from '../src/core/types';

describe('PluginManager', () => {
  it('should register plugins and sort by priority', () => {
    const manager = new PluginManager();
    const echo = new EchoPlugin();
    const help = new HelpPlugin();
    
    manager.registerPlugin(echo);
    manager.registerPlugin(help);
    
    const plugins = manager.getPlugins();
    expect(plugins.length).toBe(2);
    // Help has priority 99, Echo has 100, so Help should be first
    expect(plugins[0].name).toBe('help');
    expect(plugins[1].name).toBe('echo');
  });

  it('should process message with matching plugin', async () => {
    const manager = new PluginManager();
    manager.registerPlugin(new EchoPlugin());
    
    const mockSession: Session = {
      id: 'test-session',
      platform: 'test',
      userId: 'user1',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    
    const result = await manager.processMessage('/echo Hello World', mockSession);
    expect(result).toBe('Hello World');
  });

  it('should return null when no plugin matches', async () => {
    const manager = new PluginManager();
    manager.registerPlugin(new EchoPlugin());
    
    const mockSession: Session = {
      id: 'test-session',
      platform: 'test',
      userId: 'user1',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    
    const result = await manager.processMessage('just a regular message', mockSession);
    expect(result).toBeNull();
  });
});

describe('EchoPlugin', () => {
  it('should only handle messages starting with /echo', () => {
    const plugin = new EchoPlugin();
    
    expect(plugin.shouldHandle('/echo test')).toBe(true);
    expect(plugin.shouldHandle('echo test')).toBe(false);
    expect(plugin.shouldHandle('/echo')).toBe(false);
  });

  it('should return the text after /echo', async () => {
    const plugin = new EchoPlugin();
    const result = await plugin.handle('/echo Hello World');
    expect(result).toBe('Hello World');
  });
});

describe('HelpPlugin', () => {
  it('should handle /help and /start', () => {
    const plugin = new HelpPlugin();
    
    expect(plugin.shouldHandle('/help')).toBe(true);
    expect(plugin.shouldHandle('/start')).toBe(true);
    expect(plugin.shouldHandle('/other')).toBe(false);
  });

  it('should return help text', async () => {
    const plugin = new HelpPlugin();
    const result = await plugin.handle('/help');
    
    expect(result).toContain('/echo');
    expect(result).toContain('/help');
  });
});
