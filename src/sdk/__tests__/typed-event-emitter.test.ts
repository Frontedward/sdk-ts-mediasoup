import { describe, it, expect, vi } from 'vitest';
import { SimpleEventEmitter } from '../events/typed-event-emitter';

interface TestEvents {
  test: string;
  count: number;
  object: { id: string; value: number };
}

describe('SimpleEventEmitter', () => {
  it('should emit and receive events', () => {
    const emitter = new SimpleEventEmitter<TestEvents>();
    const callback = vi.fn();
    
    emitter.on('test', callback);
    emitter.emit('test', 'hello');
    
    expect(callback).toHaveBeenCalledWith('hello');
  });
  
  it('should support different event types', () => {
    const emitter = new SimpleEventEmitter<TestEvents>();
    const stringCallback = vi.fn();
    const numberCallback = vi.fn();
    const objectCallback = vi.fn();
    
    emitter.on('test', stringCallback);
    emitter.on('count', numberCallback);
    emitter.on('object', objectCallback);
    
    emitter.emit('test', 'hello');
    emitter.emit('count', 42);
    emitter.emit('object', { id: 'abc', value: 123 });
    
    expect(stringCallback).toHaveBeenCalledWith('hello');
    expect(numberCallback).toHaveBeenCalledWith(42);
    expect(objectCallback).toHaveBeenCalledWith({ id: 'abc', value: 123 });
  });
  
  it('should support multiple listeners for the same event', () => {
    const emitter = new SimpleEventEmitter<TestEvents>();
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    
    emitter.on('test', callback1);
    emitter.on('test', callback2);
    
    emitter.emit('test', 'hello');
    
    expect(callback1).toHaveBeenCalledWith('hello');
    expect(callback2).toHaveBeenCalledWith('hello');
  });
  
  it('should remove listeners with off', () => {
    const emitter = new SimpleEventEmitter<TestEvents>();
    const callback = vi.fn();
    
    emitter.on('test', callback);
    emitter.emit('test', 'first');
    expect(callback).toHaveBeenCalledTimes(1);
    
    emitter.off('test', callback);
    emitter.emit('test', 'second');
    expect(callback).toHaveBeenCalledTimes(1); // Still 1, not called again
  });
  
  it('should remove listeners with the returned function', () => {
    const emitter = new SimpleEventEmitter<TestEvents>();
    const callback = vi.fn();
    
    const unsubscribe = emitter.on('test', callback);
    emitter.emit('test', 'first');
    expect(callback).toHaveBeenCalledTimes(1);
    
    unsubscribe();
    emitter.emit('test', 'second');
    expect(callback).toHaveBeenCalledTimes(1); // Still 1, not called again
  });
  
  it('should call a listener only once with once', () => {
    const emitter = new SimpleEventEmitter<TestEvents>();
    const callback = vi.fn();
    
    emitter.once('test', callback);
    
    emitter.emit('test', 'first');
    expect(callback).toHaveBeenCalledTimes(1);
    
    emitter.emit('test', 'second');
    expect(callback).toHaveBeenCalledTimes(1); // Still 1, not called again
  });
});