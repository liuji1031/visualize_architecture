/**
 * ResizeObserver Polyfill and Error Suppression Utility
 * 
 * This utility provides a safer implementation of ResizeObserver that:
 * 1. Throttles observations to prevent loop limit exceeded errors
 * 2. Catches and suppresses ResizeObserver-related errors
 * 3. Provides a global installation method to patch the browser's ResizeObserver
 */

// Store the original ResizeObserver if it exists
const OriginalResizeObserver = window.ResizeObserver;

/**
 * A safer implementation of ResizeObserver that throttles callbacks
 * to prevent "ResizeObserver loop limit exceeded" errors
 */
class SafeResizeObserver {
  private observer: ResizeObserver;
  private observationThrottleTimeout: number | null = null;
  private queuedEntries: ResizeObserverEntry[] = [];
  private callbacks = new Map<Element, ResizeObserverCallback>();

  constructor() {
    // Create the actual ResizeObserver with a throttled callback
    this.observer = new OriginalResizeObserver((entries) => {
      // Store the entries to process them in a throttled manner
      this.queuedEntries = [...this.queuedEntries, ...entries];
      
      // Throttle the processing of entries
      if (!this.observationThrottleTimeout) {
        this.observationThrottleTimeout = window.setTimeout(() => {
          this.processQueuedEntries();
          this.observationThrottleTimeout = null;
        }, 16); // ~60fps
      }
    });
  }

  /**
   * Process all queued entries by calling the appropriate callbacks
   */
  private processQueuedEntries() {
    if (this.queuedEntries.length === 0) return;
    
    // Group entries by target element
    const entriesByTarget = new Map<Element, ResizeObserverEntry[]>();
    
    this.queuedEntries.forEach(entry => {
      const target = entry.target;
      if (!entriesByTarget.has(target)) {
        entriesByTarget.set(target, []);
      }
      entriesByTarget.get(target)!.push(entry);
    });
    
    // Call each callback with its relevant entries
    entriesByTarget.forEach((entries, target) => {
      const callback = this.callbacks.get(target);
      if (callback) {
        try {
          callback(entries, this.observer);
        } catch (error) {
          console.warn('Error in ResizeObserver callback:', error);
        }
      }
    });
    
    // Clear the queue
    this.queuedEntries = [];
  }

  /**
   * Observe an element with a callback
   */
  observe(target: Element, callback: ResizeObserverCallback) {
    this.callbacks.set(target, callback);
    try {
      this.observer.observe(target);
    } catch (error) {
      console.warn('Error observing element with ResizeObserver:', error);
    }
  }

  /**
   * Unobserve an element
   */
  unobserve(target: Element) {
    this.callbacks.delete(target);
    try {
      this.observer.unobserve(target);
    } catch (error) {
      console.warn('Error unobserving element with ResizeObserver:', error);
    }
  }

  /**
   * Disconnect the observer
   */
  disconnect() {
    this.callbacks.clear();
    try {
      this.observer.disconnect();
    } catch (error) {
      console.warn('Error disconnecting ResizeObserver:', error);
    }
  }
}

/**
 * Install the ResizeObserver polyfill globally
 */
export function installResizeObserverPolyfill() {
  // Only patch if the original ResizeObserver exists
  if (OriginalResizeObserver) {
    // Create a patched constructor that returns our safer implementation
    const PatchedResizeObserver = function(callback: ResizeObserverCallback) {
      const safeObserver = new SafeResizeObserver();
      
      // Return an object that delegates to our safe implementation
      return {
        observe: (target: Element) => safeObserver.observe(target, callback),
        unobserve: (target: Element) => safeObserver.unobserve(target),
        disconnect: () => safeObserver.disconnect()
      };
    } as unknown as typeof ResizeObserver;
    
    // Copy over any static properties
    Object.keys(OriginalResizeObserver).forEach(key => {
      (PatchedResizeObserver as any)[key] = (OriginalResizeObserver as any)[key];
    });
    
    // Replace the global ResizeObserver
    window.ResizeObserver = PatchedResizeObserver;
    
    console.log('ResizeObserver polyfill installed successfully');
  } else {
    console.warn('ResizeObserver not available in this browser');
  }
}
