/**
 * Asynchronous event queue for handling events in order
 */

export interface QueueTask {
  execute: () => Promise<void>;
  description?: string;
}

export class AsyncEventQueue {
  private queue: QueueTask[] = [];
  private processing = false;
  private paused = false;

  /**
   * Enqueue a task to be executed
   * @param task The task to enqueue
   */
  enqueue(task: QueueTask): void {
    this.queue.push(task);
    this.processNext();
  }

  /**
   * Enqueue a function as a task
   * @param fn The function to execute
   * @param description Optional description for debugging
   */
  enqueueFunction(fn: () => Promise<void>, description?: string): void {
    this.enqueue({
      execute: fn,
      description
    });
  }

  /**
   * Start processing the queue
   */
  private async processNext(): Promise<void> {
    if (this.processing || this.paused || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    
    try {
      const task = this.queue.shift();
      if (task) {
        await task.execute();
      }
    } catch (error) {
      console.error('Error processing queue task:', error);
    } finally {
      this.processing = false;
      this.processNext();
    }
  }

  /**
   * Pause queue processing
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume queue processing
   */
  resume(): void {
    if (this.paused) {
      this.paused = false;
      this.processNext();
    }
  }

  /**
   * Clear all pending tasks from the queue
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Get the number of pending tasks
   */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Check if the queue is currently processing a task
   */
  get isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Check if the queue is paused
   */
  get isPaused(): boolean {
    return this.paused;
  }
}