// Frame-capped requestAnimationFrame loop.
//
// VENDORED (verbatim API) from the user's own MIT-licensed package
//   @tuomashatakka/canvas-loop-framecapper
//   https://github.com/tuomashatakka/canvas-loop-framecapper
//
// Vendored rather than installed because that package publishes to the GitHub
// Packages registry (npm.pkg.github.com), which would require a per-machine
// read:packages token + .npmrc for every contributor and CI run. It's a tiny,
// dependency-free module, so we keep a local copy with identical exports
// (frameLoopManager / useFrameLoop / useFrameLoopManager). Swapping to the
// published package later is a one-line import change.
//
// One global manager drives a single rAF loop shared by every registered
// callback. setFixedFrameRate(fps) caps the executed rate (fps = 0 → uncapped);
// when capped, deltaTime is delivered as a fixed timestep. This is what the
// global "max frame rate" graphics setting drives (see components/SettingsProvider).
import { useEffect, useSyncExternalStore } from 'react';

class FrameLoopManager {
  private _syncCallbacks: Set<(manager: FrameLoopManager) => void> = new Set();
  private _asyncCallbacks: Set<(manager: FrameLoopManager) => void> = new Set();
  private _listeners: Set<() => void> = new Set();

  private _animationFrameId: number | null = null;
  private _lastFrameTime: number = 0;
  private _elapsedTimeAccumulator: number = 0;

  public totalTime: number = 0;
  public deltaTime: number = 0;
  public isPaused: boolean = true;

  private _fixedFrameRate: number = 0;
  private _msPerFrame: number = 0;

  constructor() {
    this._loop = this._loop.bind(this);
  }

  public setFixedFrameRate(fps: number): void {
    this._fixedFrameRate = fps;
    this._msPerFrame = fps > 0 ? 1000 / fps : 0;
    this._notify();
  }

  public getFramerate(): number {
    return this._fixedFrameRate;
  }

  public registerSyncCallback(callback: (manager: FrameLoopManager) => void): void {
    this._syncCallbacks.add(callback);
    this._manageLoop();
  }

  public unregisterSyncCallback(callback: (manager: FrameLoopManager) => void): void {
    this._syncCallbacks.delete(callback);
    this._manageLoop();
  }

  public registerAsyncCallback(callback: (manager: FrameLoopManager) => void): void {
    this._asyncCallbacks.add(callback);
    this._manageLoop();
  }

  public unregisterAsyncCallback(callback: (manager: FrameLoopManager) => void): void {
    this._asyncCallbacks.delete(callback);
    this._manageLoop();
  }

  public resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      this._lastFrameTime = performance.now(); // Prevent large deltaTime jump
      this._notify();
    }
  }

  public pause(): void {
    if (!this.isPaused) {
      this.isPaused = true;
      this._notify();
    }
  }

  public reset(): void {
    this.totalTime = 0;
    this.deltaTime = 0;
    this.isPaused = true; // Resetting also pauses the loop
    this._elapsedTimeAccumulator = 0;
    this._lastFrameTime = performance.now();
    this._notify();
  }

  public subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify(): void {
    this._listeners.forEach((listener) => listener());
  }

  private _manageLoop(): void {
    const hasCallbacks = this._syncCallbacks.size > 0 || this._asyncCallbacks.size > 0;
    if (hasCallbacks && this._animationFrameId === null) {
      this._start();
    } else if (!hasCallbacks && this._animationFrameId !== null) {
      this._stop();
    }
  }

  private _start(): void {
    if (this._animationFrameId === null) {
      this._lastFrameTime = performance.now();
      this._animationFrameId = requestAnimationFrame(this._loop);
    }
  }

  private _stop(): void {
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
  }

  private _loop(currentTime: number): void {
    // Always schedule the next frame
    this._animationFrameId = requestAnimationFrame(this._loop);

    if (this.isPaused) {
      return;
    }

    const currentDeltaMs = currentTime - this._lastFrameTime;
    this._lastFrameTime = currentTime;
    this._elapsedTimeAccumulator += currentDeltaMs;

    if (this._msPerFrame > 0 && this._elapsedTimeAccumulator < this._msPerFrame) {
      return;
    }

    let actualDeltaMs = currentDeltaMs;
    if (this._msPerFrame > 0) {
      actualDeltaMs = this._msPerFrame;
      this._elapsedTimeAccumulator -= this._msPerFrame;
    }

    this.deltaTime = actualDeltaMs / 1000;
    this.totalTime += this.deltaTime;

    // Execute callbacks
    this._syncCallbacks.forEach((cb) => cb(this));
    this._asyncCallbacks.forEach((cb) => Promise.resolve().then(() => cb(this)));
  }
}

export type { FrameLoopManager };

export const frameLoopManager = new FrameLoopManager();

/** Register a callback that runs once per (capped) frame for the component's lifetime. */
export const useFrameLoop = (callback: (manager: FrameLoopManager) => void) => {
  // The vendored original wrapped this in useCallback(callback, [callback]) — a
  // no-op pass-through. We depend on `callback` directly (callers pass a stable one).
  useEffect(() => {
    frameLoopManager.registerAsyncCallback(callback);
    return () => {
      frameLoopManager.unregisterAsyncCallback(callback);
    };
  }, [callback]);
};

/** Subscribe a component to manager state changes; returns the manager for imperative control. */
export const useFrameLoopManager = () => {
  useSyncExternalStore(
    frameLoopManager.subscribe.bind(frameLoopManager),
    () => `${frameLoopManager.isPaused}:${frameLoopManager.getFramerate()}`,
    () => `true:0`,
  );
  return frameLoopManager;
};