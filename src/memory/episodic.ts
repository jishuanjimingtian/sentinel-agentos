import {
  EpisodicEvent,
  EventType,
} from '../types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate a unique event ID.
 */
function generateEventId(): string {
  return `ep_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Base importance values by event type.
 */
const BASE_IMPORTANCE: Record<EventType, number> = {
  tool_call: 0.2,
  tool_failure: 0.6,
  decision: 0.8,
  correction: 0.9,
  publish: 0.7,
  error: 0.7,
  milestone: 0.8,
  note: 0.3,
  user_feedback: 0.8,
};

/**
 * Episodic Memory — cross-session event timeline.
 *
 * Stores past events as a timeline with automatic importance scoring
 * and progressive compression. Important events stay detailed forever;
 * low-importance events gradually compress to one-liners and eventually
 * get forgotten.
 */
export class EpisodicMemory {
  private events: EpisodicEvent[] = [];
  private maxSizeKb: number;
  private storagePath?: string;

  constructor(maxSizeKb = 500) {
    this.maxSizeKb = maxSizeKb;
  }

  /** Enable disk persistence */
  enablePersistence(workspaceRoot: string): void {
    this.storagePath = path.join(workspaceRoot, '.agentos', 'episodic.json');
    this.load();
  }

  /**
   * Record a new episodic event.
   *
   * @param type - Event classification
   * @param content - Event description
   * @param tags - Auto-extracted tags
   * @param relatedEntities - Related projects/files/people
   * @param customImportanceBoost - Additional importance boost (0-1)
   */
  record(
    type: EventType,
    content: string,
    tags: string[] = [],
    relatedEntities: string[] = [],
    customImportanceBoost = 0,
  ): EpisodicEvent {
    const baseImportance = BASE_IMPORTANCE[type] ?? 0.3;

    // RecencyBoost: DESIGN.md §5.4 — newer = more important
    // Boost = 1.0 + max(0, 1.0 - ageInDays / 30)
    const recencyBoost = 1.0; // Brand new event = max recency (1.0)

    // FrequencyBoost: same-tag events +0.1 each (max +0.5)
    const frequencyBoost = Math.min(0.5, this.countByTags(tags) * 0.1);

    const importance = Math.min(
      1.0,
      baseImportance * recencyBoost * (1 + frequencyBoost) + customImportanceBoost,
    );

    const event: EpisodicEvent = {
      id: generateEventId(),
      timestamp: Date.now(),
      type,
      importance: Math.round(importance * 100) / 100,
      compression: 'full',
      content,
      tags,
      relatedEntities,
    };

    this.events.push(event);
    this.compressIfNeeded();
    this.save();

    return event;
  }

  /**
   * Query events by filter.
   */
  query(filter: {
    type?: EventType;
    minImportance?: number;
    since?: number;
    until?: number;
    tags?: string[];
    limit?: number;
  } = {}): EpisodicEvent[] {
    let results = this.events;

    if (filter.type) {
      results = results.filter((e) => e.type === filter.type);
    }
    if (filter.minImportance !== undefined) {
      results = results.filter((e) => e.importance >= filter.minImportance!);
    }
    if (filter.since !== undefined) {
      results = results.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter.until !== undefined) {
      results = results.filter((e) => e.timestamp <= filter.until!);
    }
    if (filter.tags && filter.tags.length > 0) {
      results = results.filter((e) =>
        filter.tags!.some((t) => e.tags.includes(t)),
      );
    }

    // Most recent first
    results.sort((a, b) => b.timestamp - a.timestamp);

    const limit = filter.limit ?? 100;
    return results.slice(0, limit);
  }

  /**
   * Get all events (newest first).
   */
  getAll(): EpisodicEvent[] {
    return [...this.events].sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get events that should be injected at session startup.
   *
   * Returns: high-importance events from the last 7 days,
   * plus the latest milestone and corrections.
   */
  getContextualEvents(days = 7, max = 20): EpisodicEvent[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    return this.events
      .filter((e) => e.timestamp >= cutoff || e.importance >= 0.7)
      .sort((a, b) => b.importance - a.importance || b.timestamp - a.timestamp)
      .slice(0, max);
  }

  /**
   * Generate a context summary string for injection into session prompt.
   */
  generateContextSummary(maxChars = 2000): string {
    const recent = this.getContextualEvents();
    if (recent.length === 0) return '';

    const lines: string[] = ['[AgentOS Episodic Memory]', ''];

    for (const event of recent) {
      const date = new Date(event.timestamp).toISOString().split('T')[0];
      const icon = this.typeIcon(event.type);
      const importance = event.importance >= 0.7 ? '⚠️' : '';
      const content = event.compression === 'one-liner'
        ? event.content
        : event.content.slice(0, 200);

      lines.push(`${icon} ${importance} [${date}] ${content}`);
      if (lines.join('\n').length > maxChars) break;
    }

    return lines.join('\n');
  }

  /** Count events matching a set of tags */
  private countByTags(tags: string[]): number {
    return this.events.filter((e) =>
      tags.some((t) => e.tags.includes(t)),
    ).length;
  }

  /** Total number of events */
  get count(): number {
    return this.events.length;
  }

  /** Estimated size in bytes */
  get estimatedSize(): number {
    return JSON.stringify(this.events).length;
  }

  /** Maximum configured size in KB */
  get maxSize(): number {
    return this.maxSizeKb;
  }

  /**
   * Compress events if total size exceeds threshold.
   * Progressive: full → summary → one-liner → forgotten (deleted).
   */
  private compressIfNeeded(): void {
    const now = Date.now();
    const maxBytes = this.maxSizeKb * 1024;

    while (this.estimatedSize > maxBytes && this.events.length > 0) {
      // Find the best candidate for compression:
      // oldest + lowest importance + not already forgotten
      let candidateIndex = -1;
      let candidateScore = Infinity;

      for (let i = 0; i < this.events.length; i++) {
        const e = this.events[i]!;
        if (e.compression === 'forgotten') continue;

        const ageDays = (now - e.timestamp) / (24 * 60 * 60 * 1000);
        const score = e.importance * 100 - ageDays; // lower = better to compress

        if (score < candidateScore && e.importance < 0.7) {
          candidateScore = score;
          candidateIndex = i;
        }
      }

      if (candidateIndex === -1) break; // Nothing left to compress

      const target = this.events[candidateIndex];
      if (target) this.compressEvent(target);
    }
  }

  /**
   * Compress a single event to the next level.
   */
  private compressEvent(event: EpisodicEvent): void {
    const ageDays = (Date.now() - event.timestamp) / (24 * 60 * 60 * 1000);

    switch (event.compression) {
      case 'full':
        if (event.importance < 0.3 && ageDays > 7) {
          // Compress to summary (first 100 chars)
          event.compression = 'summary';
          event.content = event.content.slice(0, 250);
        }
        break;

      case 'summary':
        if (event.importance < 0.2 && ageDays > 30) {
          // Compress to one-liner
          event.compression = 'one-liner';
          const firstLine = event.content.split('\n')[0] ?? event.content;
          event.content = firstLine.slice(0, 120);
        }
        break;

      case 'one-liner':
        if (event.importance < 0.1 && ageDays > 90) {
          event.compression = 'forgotten';
        }
        break;
    }
  }

  private typeIcon(type: EventType): string {
    switch (type) {
      case 'tool_call': return '🔧';
      case 'tool_failure': return '❌';
      case 'decision': return '🎯';
      case 'correction': return '✏️';
      case 'publish': return '📦';
      case 'error': return '💥';
      case 'milestone': return '🏁';
      case 'note': return '📝';
      case 'user_feedback': return '💬';
      default: return '📌';
    }
  }

  /** Persist to disk */
  private save(): void {
    if (!this.storagePath) return;

    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.storagePath, JSON.stringify(this.events, null, 2), 'utf-8');
  }

  /** Load from disk */
  private load(): void {
    try {
      if (fs.existsSync(this.storagePath!)) {
        const data = fs.readFileSync(this.storagePath!, 'utf-8');
        this.events = JSON.parse(data);
      }
    } catch {
      this.events = [];
    }
  }
}
