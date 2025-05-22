/**
 * A strongly typed event emitter
 */

export type EventMap = Record<string, any>;

export type EventKey<T extends EventMap> = string & keyof T;
export type EventCallback<T extends EventMap, K extends EventKey<T>> = (payload: T[K]) => void;

export interface TypedEventEmitter<T extends EventMap> {
  on<K extends EventKey<T>>(event: K, callback: EventCallback<T, K>): () => void;
  off<K extends EventKey<T>>(event: K, callback: EventCallback<T, K>): void;
  once<K extends EventKey<T>>(event: K, callback: EventCallback<T, K>): () => void;
  emit<K extends EventKey<T>>(event: K, payload: T[K]): void;
}

/**
 * Implementation of a strongly typed event emitter
 */
export class SimpleEventEmitter<T extends EventMap> implements TypedEventEmitter<T> {
  private listeners: Map<keyof T, Set<EventCallback<T, any>>> = new Map();

  /**
   * Register an event listener
   * @param event The event to listen for
   * @param callback Callback function to be called when the event is emitted
   * @returns A function to unregister the listener
   */
  on<K extends EventKey<T>>(event: K, callback: EventCallback<T, K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    
    this.listeners.get(event)!.add(callback);
    
    // Return a function to remove the listener
    return () => this.off(event, callback);
  }

  /**
   * Unregister an event listener
   * @param event The event to stop listening for
   * @param callback The callback to remove
   */
  off<K extends EventKey<T>>(event: K, callback: EventCallback<T, K>): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Register a one-time event listener
   * @param event The event to listen for once
   * @param callback Callback function to be called when the event is emitted
   * @returns A function to unregister the listener
   */
  once<K extends EventKey<T>>(event: K, callback: EventCallback<T, K>): () => void {
    const onceCallback = ((payload: T[K]) => {
      this.off(event, onceCallback as EventCallback<T, K>);
      callback(payload);
    }) as EventCallback<T, K>;
    
    return this.on(event, onceCallback);
  }

  /**
   * Emit an event with a payload
   * @param event The event to emit
   * @param payload The payload to send with the event
   */
  emit<K extends EventKey<T>>(event: K, payload: T[K]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(payload);
        } catch (error) {
          console.error(`Error in event listener for ${String(event)}:`, error);
        }
      });
    }
  }
}