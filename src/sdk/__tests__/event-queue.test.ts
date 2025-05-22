import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsyncEventQueue } from '../events/event-queue';

describe('AsyncEventQueue', () => {
  let queue: AsyncEventQueue;
  
  beforeEach(() => {
    queue = new AsyncEventQueue();
  });
  
  it('should process tasks in order', async () => {
    const results: number[] = [];
    
    const task1 = vi.fn().mockImplementation(async () => {
      results.push(1);
    });
    
    const task2 = vi.fn().mockImplementation(async () => {
      results.push(2);
    });
    
    const task3 = vi.fn().mockImplementation(async () => {
      results.push(3);
    });
    
    queue.enqueueFunction(task1);
    queue.enqueueFunction(task2);
    queue.enqueueFunction(task3);
    
    // Wait for all tasks to complete
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(task1).toHaveBeenCalledTimes(1);
    expect(task2).toHaveBeenCalledTimes(1);
    expect(task3).toHaveBeenCalledTimes(1);
    expect(results).toEqual([1, 2, 3]);
  });
  
  it('should handle task failures without breaking the queue', async () => {
    const results: string[] = [];
    
    const task1 = vi.fn().mockImplementation(async () => {
      results.push('task1');
    });
    
    const task2 = vi.fn().mockImplementation(async () => {
      throw new Error('Task 2 failed');
    });
    
    const task3 = vi.fn().mockImplementation(async () => {
      results.push('task3');
    });
    
    queue.enqueueFunction(task1);
    queue.enqueueFunction(task2);
    queue.enqueueFunction(task3);
    
    // Wait for all tasks to complete
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(task1).toHaveBeenCalledTimes(1);
    expect(task2).toHaveBeenCalledTimes(1);
    expect(task3).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['task1', 'task3']);
  });
  
  it('should pause and resume processing', async () => {
    const results: string[] = [];
    
    queue.pause();
    
    queue.enqueueFunction(async () => {
      results.push('task1');
    });
    
    queue.enqueueFunction(async () => {
      results.push('task2');
    });
    
    // Wait a bit to ensure tasks don't execute while paused
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(results).toEqual([]);
    
    queue.resume();
    
    // Wait for tasks to complete after resuming
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(results).toEqual(['task1', 'task2']);
  });
  
  it('should clear all pending tasks', async () => {
    const task1 = vi.fn().mockImplementation(async () => {});
    const task2 = vi.fn().mockImplementation(async () => {});
    
    queue.pause();
    queue.enqueueFunction(task1);
    queue.enqueueFunction(task2);
    
    expect(queue.pendingCount).toBe(2);
    
    queue.clear();
    
    expect(queue.pendingCount).toBe(0);
    
    queue.resume();
    
    // Wait a bit to ensure no tasks execute
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(task1).not.toHaveBeenCalled();
    expect(task2).not.toHaveBeenCalled();
  });
  
  it('should report correct processing state', async () => {
    expect(queue.isProcessing).toBe(false);
    
    let resolveTask: () => void;
    const taskPromise = new Promise<void>(resolve => {
      resolveTask = resolve;
    });
    
    queue.enqueueFunction(async () => {
      await taskPromise;
    });
    
    // Wait a bit for processing to start
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(queue.isProcessing).toBe(true);
    
    resolveTask!();
    
    // Wait for processing to complete
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(queue.isProcessing).toBe(false);
  });
});