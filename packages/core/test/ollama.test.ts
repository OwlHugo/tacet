import { describe, expect, it } from 'vitest';
import { ollamaHost } from '../src/ollama.js';

describe('ollamaHost', () => {
  it('accepts loopback hosts only', () => {
    expect(ollamaHost('127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    expect(ollamaHost('http://localhost:11434')).toBe('http://localhost:11434');
    expect(ollamaHost('0.0.0.0:11434')).toBe('http://127.0.0.1:11434');
    expect(() => ollamaHost('https://ollama.example.com')).toThrow(/only talks to an Ollama running on this machine/);
    expect(() => ollamaHost('http://192.168.0.10:11434')).toThrow();
  });
});
