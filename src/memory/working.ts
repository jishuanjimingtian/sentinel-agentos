import {
  Message,
  Task,
  ToolResult,
  TokenBudget,
} from '../types';
import * as crypto from 'crypto';

/**
 * WorkingMemory state interface (matches types/index.ts WorkingMemory).
 */
export interface WorkingMemoryState {
  sessionId: string;
  recentMessages: Message[];
  currentTask?: Task;
  recentToolResults: Map<string, ToolResult>;
  openFiles: string[];
  budget: TokenBudget;
}

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
  return `wm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Working Memory — current session's live context.
 *
 * Holds recent messages, current task, tool results cache,
 * open files, and token budget for the active session.
 * On session end, important items are promoted to Episodic Memory.
 * When token budget is exceeded, old messages are compressed.
 */
export class WorkingMemory {
  readonly sessionId: string;
  private _maxTokens: number;
  recentMessages: Message[];
  currentTask?: Task;
  recentToolResults: Map<string, ToolResult>;
  openFiles: string[];
  budget: TokenBudget;

  constructor(maxTokens = 50000) {
    this.sessionId = generateSessionId();
    this._maxTokens = maxTokens;
    this.recentMessages = [];
    this.recentToolResults = new Map();
    this.openFiles = [];
    this.budget = { used: 0, limit: maxTokens };
  }

  /** Maximum configured tokens */
  get maxTokens(): number {
    return this._maxTokens;
  }

  /** Get the current state as a snapshot */
  getState(): WorkingMemoryState {
    return {
      sessionId: this.sessionId,
      recentMessages: [...this.recentMessages],
      currentTask: this.currentTask ? { ...this.currentTask } : undefined,
      recentToolResults: new Map(this.recentToolResults),
      openFiles: [...this.openFiles],
      budget: { ...this.budget },
    };
  }

  /** Add a message to the working memory */
  addMessage(role: 'user' | 'agent' | 'tool', content: string): void {
    const msg: Message = {
      role,
      content,
      timestamp: Date.now(),
    };

    this.recentMessages.push(msg);
    this.budget.used += this.estimateTokens(content);

    // Trim old messages if over budget
    while (this.budget.used > this.budget.limit && this.recentMessages.length > 2) {
      const toRemove = this.recentMessages.shift();
      if (toRemove) {
        this.budget.used -= this.estimateTokens(toRemove.content);
      }
    }
  }

  /** Set or update the current task */
  setTask(task: Task): void {
    this.currentTask = task;
  }

  /** Update a step's status */
  updateStepStatus(stepIndex: number, status: Task['steps'][number]['status']): void {
    if (this.currentTask && stepIndex < this.currentTask.steps.length) {
      this.currentTask.steps[stepIndex]!.status = status;
    }
  }

  /** Track an open file */
  addOpenFile(filePath: string): void {
    if (!this.openFiles.includes(filePath)) {
      this.openFiles.push(filePath);
    }
  }

  /** Remove a file from tracking */
  removeOpenFile(filePath: string): void {
    this.openFiles = this.openFiles.filter((f) => f !== filePath);
  }

  /** Cache a tool call result */
  cacheToolResult(toolName: string, result: unknown): void {
    this.recentToolResults.set(toolName, {
      toolName,
      result,
      timestamp: Date.now(),
    });
  }

  /** Check if a tool result is cached and fresh */
  getCachedResult(toolName: string, maxAgeMs = 30000): ToolResult | undefined {
    const cached = this.recentToolResults.get(toolName);
    if (cached && Date.now() - cached.timestamp < maxAgeMs) {
      return cached;
    }
    return undefined;
  }

  /** Clear working memory (called on session end) */
  clear(): void {
    this.recentMessages = [];
    this.currentTask = undefined;
    this.recentToolResults.clear();
    this.openFiles = [];
    this.budget.used = 0;
  }

  /** Estimate token count (rough: 1 token ≈ 4 chars for English/Chinese) */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 2); // Chinese chars ≈ 1 token each
  }
}
