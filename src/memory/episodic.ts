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
 * Episodic Memory 鈥?cross-session event timeline.
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

    // #6: Skip self-test noise — filter out sentinel-agentos/echo self-checks
    const NOISE_PATTERNS = [
      /^npx sentinel-agentos/,
      /^sentinel-agentos/,
      /echo\s+(sentinel|[a-z]+-agentos)/i,
      /npx\s+[\w-]+\s+(stats|status|audit|profile)\b/,
    ];
    if (NOISE_PATTERNS.some((p) => p.test(content))) {
      const lowImportance: EpisodicEvent = {
        id: generateEventId(),
        timestamp: Date.now(),
        type,
        importance: 0.05,
        compression: 'one-liner',
        content: content.slice(0, 80),
        tags: ['noise', ...tags],
        relatedEntities,
      };
      this.events.push(lowImportance);
      this.compressIfNeeded();
      this.save();
      return lowImportance;
    }

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
  getContextualEvents(days = 7, max = 8): EpisodicEvent[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    return this.events
      .filter((e) => e.timestamp >= cutoff || e.importance >= 0.7)
      .sort((a, b) => b.importance - a.importance || b.timestamp - a.timestamp)
      .slice(0, max);
  }

  /**
   * Generate a context summary string for injection into session prompt.
   */
  generateContextSummary(maxChars = 800): string {
    const recent = this.getContextualEvents(7, 5);
    if (recent.length === 0) return '';

    const lines: string[] = ['[AgentOS Episodic Memory]', ''];

    for (const event of recent) {
      const date = new Date(event.timestamp).toISOString().split('T')[0];
      const icon = this.typeIcon(event.type);
      const importance = event.importance >= 0.7 ? '鈿狅笍' : '';
      const content = event.compression === 'one-liner'
        ? event.content
        : event.content.slice(0, 150);

      lines.push(`${icon} ${importance} [${date}] ${content}`);
    }

    let result = lines.join('\n');
    if (result.length > maxChars) {
      result = result.slice(0, maxChars - 3) + '...';
    }
    return result;
  }

  /**
   * Generate a searchable markdown snapshot of all events
   * for indexing by OpenClaw's memory_search.
   */
  getSearchableSnapshot(maxEvents = 50): string {
    const all = this.getAll().slice(0, maxEvents);
    if (all.length === 0) return '';

    const lines: string[] = [
      '# AgentOS Episodic Memory Index',
      '',
      `> ${this.count} events total | ${all.length} shown | ${new Date().toISOString().split('T')[0]}`,
      '',
    ];

    for (const event of all) {
      const date = new Date(event.timestamp).toISOString().split('T')[0];
      const icon = this.typeIcon(event.type);
      const content = event.content.length > 300
        ? event.content.slice(0, 300) + '...'
        : event.content;
      const tags = event.tags.length > 0 ? ` [${event.tags.join(', ')}]` : '';
      const imp = event.importance >= 0.7 ? ` 鈽?{Math.round(event.importance * 100)}%` : '';
      lines.push(`${icon} ${date}${imp}${tags}: ${content}`);
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
   * Progressive: full 鈫?summary 鈫?one-liner 鈫?forgotten (deleted).
   */
  private compressIfNeeded(): void {
    const now = Date.now();
    const maxBytes = this.maxSizeKb * 1024;
    let iterations = 0;
    const MAX_ITERATIONS = 100; // safety cap 鈥?prevent infinite loop on pathological data

    while (this.estimatedSize > maxBytes && this.events.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;
      
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
      if (target) {
        const oldLevel = target.compression;
        this.compressEvent(target);
        // If compression didn't change level (e.g., already at forgotten),
        // remove the event entirely to prevent infinite loop
        if (target.compression === oldLevel && target.compression !== 'forgotten') {
          target.compression = 'forgotten';
        }
      }
    }
    
    // Last resort: if still over limit, drop oldest low-importance forgotten events
    if (this.estimatedSize > maxBytes) {
      this.events = this.events.filter(e => e.compression !== 'forgotten');
    }
  }

  /**
   * Compress a single event to the next level.
   *
   * Strategy: low-importance events compress on a faster schedule;
   * the most aggressive step is full鈫抯ummary for tool_call (<0.4) events
   * after just 1 day, because tool_call events are the majority by volume.
   */
  private compressEvent(event: EpisodicEvent): void {
    const ageDays = (Date.now() - event.timestamp) / (24 * 60 * 60 * 1000);

    switch (event.compression) {
      case 'full':
        // tool_call with importance <= 0.4 鈫?summary after 1 day
        if (event.importance <= 0.4 && ageDays > 1) {
          event.compression = 'summary';
          event.content = event.content.slice(0, 250);
        } else if (event.importance < 0.5 && ageDays > 7) {
          event.compression = 'summary';
          event.content = event.content.slice(0, 250);
        }
        break;

      case 'summary':
        if (event.importance <= 0.4 && ageDays > 3) {
          // Compress to one-liner
          event.compression = 'one-liner';
          const firstLine = event.content.split('\n')[0] ?? event.content;
          event.content = firstLine.slice(0, 120);
        } else if (event.importance < 0.5 && ageDays > 14) {
          event.compression = 'one-liner';
          const firstLine = event.content.split('\n')[0] ?? event.content;
          event.content = firstLine.slice(0, 120);
        }
        break;

      case 'one-liner':
        if (event.importance <= 0.4 && ageDays > 7) {
          event.compression = 'forgotten';
        } else if (event.importance < 0.5 && ageDays > 30) {
          event.compression = 'forgotten';
        }
        break;
    }
  }

  private typeIcon(type: EventType): string {
    switch (type) {
      case 'tool_call': return '馃敡';
      case 'tool_failure': return '💀';
      case 'decision': return '馃幆';
      case 'correction': return '鉁忥笍';
      case 'publish': return '馃摝';
      case 'error': return '馃挜';
      case 'milestone': return '馃弫';
      case 'note': return '馃摑';
      case 'user_feedback': return '馃挰';
      default: return '馃搶';
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
